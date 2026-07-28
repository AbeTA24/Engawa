// Orquestación del assistant (CLAUDE.md §2): extraer → armar el request
// tipado → invocar goal-engine → narrar con placeholders → renderizar cifras
// reales en el borde de presentación. Acá no se calcula nada.

import {
  evaluateGoal,
  type Currency,
  type GoalEngineRequest,
  type ISODate,
} from 'goal-engine';
import type { ExtractionResult, LlmClient, NarrationContext, RawExtraction } from './llm.js';
import { parseAmountLiteral, parseISODate } from './parse.js';
import { figuresFrom } from './figures.js';
import { fallbackTemplate, isSafeTemplate, renderNarration } from './narration.js';

export type { ExtractionResult, LlmClient, NarrationContext, RawExtraction } from './llm.js';
export { AnthropicLlmClient } from './anthropic.js';
export { parseAmountLiteral, parseISODate } from './parse.js';
export { formatCents, formatDate } from './format.js';
export { figuresFrom, type Figure } from './figures.js';
export { fallbackTemplate, isSafeTemplate, renderNarration } from './narration.js';

const GENERIC_CLARIFICATION =
  'Necesito un poco más de información sobre tu meta para poder calcular. ¿Podés darme más detalles?';

type BuildResult =
  | { kind: 'request'; request: GoalEngineRequest }
  | { kind: 'clarification'; question: string };

/** Transcripción literal → request tipado del contrato. Determinista. */
export function buildRequest(
  extraction: RawExtraction,
  asOf: ISODate,
  currency: Currency,
): BuildResult {
  const targetAmount = parseAmountLiteral(extraction.targetAmount);
  if (targetAmount === null) {
    return { kind: 'clarification', question: `No entendí el monto de la meta «${extraction.goalName}». ¿Me lo repetís?` };
  }
  const currentAmount = extraction.currentAmount ? parseAmountLiteral(extraction.currentAmount) : 0;
  if (currentAmount === null) {
    return { kind: 'clarification', question: '¿Cuánto tenés ahorrado hasta ahora para esta meta?' };
  }
  if (extraction.targetDate && !parseISODate(extraction.targetDate)) {
    return { kind: 'clarification', question: '¿Para qué fecha exacta querés alcanzar la meta?' };
  }

  let contribution: GoalEngineRequest['goal']['contribution'];
  if (extraction.contribution) {
    const amount = parseAmountLiteral(extraction.contribution.amount);
    if (amount === null) {
      return { kind: 'clarification', question: 'No entendí el importe del aporte. ¿Me lo repetís?' };
    }
    if (extraction.contribution.startDate && !parseISODate(extraction.contribution.startDate)) {
      return { kind: 'clarification', question: '¿Desde qué fecha empezarías a aportar?' };
    }
    contribution = {
      amount,
      frequency: extraction.contribution.frequency,
      ...(extraction.contribution.startDate ? { startDate: extraction.contribution.startDate } : {}),
    };
  }

  return {
    kind: 'request',
    request: {
      query: { kind: extraction.query },
      goal: {
        name: extraction.goalName,
        targetAmount,
        currentAmount,
        ...(extraction.targetDate ? { targetDate: extraction.targetDate } : {}),
        ...(contribution ? { contribution } : {}),
      },
      asOf,
      currency,
    },
  };
}

export interface AssistantOptions {
  llm: LlmClient;
  engine?: typeof evaluateGoal;
  currency?: Currency;
}

export class Assistant {
  private llm: LlmClient;
  private engine: typeof evaluateGoal;
  private currency: Currency;

  constructor(options: AssistantOptions) {
    this.llm = options.llm;
    this.engine = options.engine ?? evaluateGoal;
    this.currency = options.currency ?? 'PEN';
  }

  async handle(utterance: string, asOf: ISODate): Promise<{ text: string }> {
    const extracted = await this.llm.extract(utterance, asOf);
    if (extracted.kind === 'clarification') {
      // La pregunta viene del LLM: si trae dígitos, se descarta (§3).
      return { text: /\d/.test(extracted.question) ? GENERIC_CLARIFICATION : extracted.question };
    }

    const built = buildRequest(extracted.extraction, asOf, this.currency);
    if (built.kind === 'clarification') {
      return { text: built.question }; // texto de código propio, sin cifras del LLM
    }

    const response = this.engine(built.request);
    const figures = figuresFrom(response, extracted.extraction.goalName);
    const context: NarrationContext = {
      resultKind: response.kind,
      goalName: extracted.extraction.goalName,
      placeholders: Object.keys(figures),
      ...(response.kind === 'feasibility' ? { feasible: response.feasible } : {}),
      ...(response.kind === 'error' ? { errorCode: response.code } : {}),
    };

    let template: string;
    try {
      template = await this.llm.narrate(context);
    } catch {
      template = fallbackTemplate(response);
    }
    if (!isSafeTemplate(template, context.placeholders)) {
      template = fallbackTemplate(response);
    }

    return { text: renderNarration(template, figures, this.currency) };
  }
}
