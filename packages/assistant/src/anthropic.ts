// Cliente LLM real sobre el SDK oficial de Anthropic. Es la única pieza del
// repo que habla con la red, y vive en assistant — goal-engine no la conoce.

import Anthropic from '@anthropic-ai/sdk';
import type { ExtractionResult, LlmClient, NarrationContext, RawExtraction } from './llm.js';

const EXTRACTION_SYSTEM = `Sos el extractor de un asistente financiero. Convertís el mensaje del usuario en datos estructurados para un motor de cálculo determinista.

Reglas innegociables:
- Todo importe se transcribe VERBATIM como string, tal cual lo dijo el usuario ("1.200", "300 soles", "50,75"). Jamás conviertas unidades, redondees, sumes ni calcules nada.
- Las fechas se normalizan a ISO "YYYY-MM-DD". Si el usuario dio una fecha relativa que no podés anclar, pedí aclaración.
- Elegí una sola pregunta (query): 'plan' si pregunta cuánto aportar dada una fecha, 'projection' si pregunta cuándo llega dado un aporte, 'feasibility' si da ambos y pregunta si llega.
- Si falta información esencial o el mensaje no trata de una meta de ahorro, usá la herramienta pedir_aclaracion. Tu pregunta de aclaración no debe contener números.`;

const EXTRACTION_TOOL: Anthropic.Beta.BetaToolUnion = {
  name: 'registrar_meta',
  description: 'Registra la meta extraída del mensaje del usuario, con importes transcritos verbatim como strings.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', enum: ['plan', 'projection', 'feasibility'] },
      goalName: { type: 'string', description: 'Etiqueta legible de la meta' },
      targetAmount: { type: 'string', description: 'Monto objetivo, transcripción literal' },
      currentAmount: { type: 'string', description: 'Lo ya ahorrado, transcripción literal; omitir si no lo mencionó' },
      targetDate: { type: 'string', description: 'Fecha límite ISO YYYY-MM-DD' },
      contribution: {
        type: 'object',
        properties: {
          amount: { type: 'string', description: 'Importe del aporte, transcripción literal' },
          frequency: { type: 'string', enum: ['weekly', 'biweekly', 'monthly'] },
          startDate: { type: 'string', description: 'Primer aporte ISO YYYY-MM-DD' },
        },
        required: ['amount', 'frequency'],
      },
    },
    required: ['query', 'goalName', 'targetAmount'],
  },
};

const CLARIFICATION_TOOL: Anthropic.Beta.BetaToolUnion = {
  name: 'pedir_aclaracion',
  description: 'Pide al usuario la información que falta. La pregunta no debe contener números.',
  input_schema: {
    type: 'object',
    properties: { question: { type: 'string' } },
    required: ['question'],
  },
};

const NARRATION_SYSTEM = `Redactás la respuesta de un asistente financiero en español rioplatense, cálida y breve (una o dos frases).

Reglas innegociables:
- PROHIBIDO escribir dígitos o cifras de cualquier tipo. Toda cantidad, fecha o conteo se referencia con el placeholder correspondiente, ej.: {{requiredContribution}}.
- Solo podés usar los placeholders que se te indican; el sistema los reemplaza por los valores reales calculados.
- No inventes datos ni des consejos financieros no pedidos.`;

export class AnthropicLlmClient implements LlmClient {
  private client: Anthropic;
  private model: string;

  constructor(options: { apiKey?: string; model?: string } = {}) {
    this.client = new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
    this.model = options.model ?? 'claude-opus-5';
  }

  async extract(utterance: string, asOf: string): Promise<ExtractionResult> {
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 2048,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: EXTRACTION_SYSTEM,
      tools: [EXTRACTION_TOOL, CLARIFICATION_TOOL],
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: `Hoy es ${asOf}.\n\n${utterance}` }],
    } as Anthropic.Beta.MessageCreateParamsNonStreaming);

    if (response.stop_reason === 'refusal') {
      return { kind: 'clarification', question: '¿Podés contarme de nuevo tu meta de ahorro, con el monto y la fecha que tenés en mente?' };
    }
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      if (block.name === 'registrar_meta') {
        return { kind: 'extraction', extraction: block.input as RawExtraction };
      }
      if (block.name === 'pedir_aclaracion') {
        return { kind: 'clarification', question: (block.input as { question: string }).question };
      }
    }
    return { kind: 'clarification', question: '¿Podés darme más detalles sobre tu meta de ahorro?' };
  }

  async narrate(context: NarrationContext): Promise<string> {
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 1024,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: NARRATION_SYSTEM,
      messages: [
        {
          role: 'user',
          content:
            `Resultado: ${context.resultKind}` +
            (context.feasible === undefined ? '' : `, feasible: ${context.feasible}`) +
            (context.errorCode ? `, error: ${context.errorCode}` : '') +
            `\nMeta: usá {{goalName}} para nombrarla.` +
            `\nPlaceholders disponibles: ${context.placeholders.map((p) => `{{${p}}}`).join(', ')}` +
            `\nEscribí la respuesta al usuario.`,
        },
      ],
    } as Anthropic.Beta.MessageCreateParamsNonStreaming);

    if (response.stop_reason === 'refusal') {
      throw new Error('narration refused');
    }
    const text = response.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
    if (!text) throw new Error('empty narration');
    return text;
  }
}
