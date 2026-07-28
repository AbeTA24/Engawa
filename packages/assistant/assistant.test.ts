import { describe, expect, it, vi } from 'vitest';
import { evaluateGoal } from 'goal-engine';
import {
  Assistant,
  buildRequest,
  formatCents,
  parseAmountLiteral,
  type ExtractionResult,
  type LlmClient,
  type NarrationContext,
} from './src/index.js';

// LLM guionado: los tests corren sin red y sin SDK, contra el motor real.
function fakeLlm(script: {
  extract: ExtractionResult;
  narrate?: string | Error;
  onNarrate?: (context: NarrationContext) => void;
}): LlmClient {
  return {
    extract: async () => script.extract,
    narrate: async (context) => {
      script.onNarrate?.(context);
      if (script.narrate instanceof Error) throw script.narrate;
      return script.narrate ?? '';
    },
  };
}

const extraccionPlan: ExtractionResult = {
  kind: 'extraction',
  extraction: {
    query: 'plan',
    goalName: 'Viaje a Japón',
    targetAmount: '1.200', // transcripción literal de "1.200 soles"
    targetDate: '2027-07-01',
  },
};

describe('parse: transcripción literal → céntimos (sin aritmética)', () => {
  it.each([
    ['1.200', 120000],
    ['1200,50', 120050],
    ['300 soles', 30000],
    ['0,05', 5],
    ['1.234.567,89', 123456789],
  ])('%s → %d', (raw, cents) => {
    expect(parseAmountLiteral(raw)).toBe(cents);
  });

  it.each([['sin números'], ['1,234'], ['1,2,3']])('%s → null', (raw) => {
    expect(parseAmountLiteral(raw)).toBeNull();
  });
});

describe('format: céntimos → texto solo en el borde de presentación', () => {
  it.each([
    [120000, 'S/ 1,200.00'],
    [5455, 'S/ 54.55'],
    [5, 'S/ 0.05'],
    [240000, 'S/ 2,400.00'],
    [136364, 'S/ 1,363.64'],
  ])('%d → %s', (cents, text) => {
    expect(formatCents(cents, 'PEN')).toBe(text);
  });
});

describe('assistant: flujo completo contra el motor real', () => {
  it('las cifras mostradas salen del motor, vía placeholders', async () => {
    let seenContext: NarrationContext | undefined;
    const assistant = new Assistant({
      llm: fakeLlm({
        extract: extraccionPlan,
        narrate:
          'Para {{goalName}} vas a necesitar {{requiredContribution}} por mes, durante {{installments}} meses, terminando el {{completionDate}}.',
        onNarrate: (context) => (seenContext = context),
      }),
    });

    const { text } = await assistant.handle('Quiero ahorrar 1.200 soles para un viaje a Japón antes de julio de 2027', '2026-08-01');

    // Valores de la tabla de casos del goal-engine: S/ 1,200.00 / 12 aportes.
    expect(text).toContain('S/ 100.00');
    expect(text).toContain('12');
    expect(text).toContain('1 de julio de 2027');
    expect(text).toContain('Viaje a Japón');

    // El LLM narró sin ver una sola cifra: su contexto son solo nombres.
    expect(seenContext).toEqual({
      resultKind: 'plan',
      goalName: 'Viaje a Japón',
      placeholders: ['goalName', 'requiredContribution', 'installments', 'finalInstallment', 'completionDate'],
    });
  });

  it('una narración con cifras inventadas se descarta entera', async () => {
    const assistant = new Assistant({
      llm: fakeLlm({
        extract: extraccionPlan,
        narrate: 'Con unos 95 soles al mes llegás cómodo a tu meta.', // dígitos inventados por el LLM
      }),
    });

    const { text } = await assistant.handle('…', '2026-08-01');

    expect(text).not.toContain('95');
    expect(text).toContain('S/ 100.00'); // el fallback determinista usa la cifra real del motor
  });

  it('una narración con placeholders inexistentes se descarta', async () => {
    const assistant = new Assistant({
      llm: fakeLlm({ extract: extraccionPlan, narrate: 'Vas a llegar con {{montoInventado}} de sobra.' }),
    });

    const { text } = await assistant.handle('…', '2026-08-01');

    expect(text).not.toContain('montoInventado');
    expect(text).toContain('S/ 100.00');
  });

  it('si el LLM narrador falla, el fallback determinista responde igual', async () => {
    const assistant = new Assistant({
      llm: fakeLlm({ extract: extraccionPlan, narrate: new Error('boom') }),
    });

    const { text } = await assistant.handle('…', '2026-08-01');

    expect(text).toContain('S/ 100.00');
    expect(text).toContain('Viaje a Japón');
  });

  it('el request al motor es transcripción literal, sin transformar', async () => {
    const engine = vi.fn(evaluateGoal);
    const assistant = new Assistant({
      llm: fakeLlm({ extract: extraccionPlan, narrate: 'Listo: {{requiredContribution}} al mes.' }),
      engine,
    });

    await assistant.handle('…', '2026-08-01');

    expect(engine).toHaveBeenCalledWith({
      query: { kind: 'plan' },
      goal: { name: 'Viaje a Japón', targetAmount: 120000, currentAmount: 0, targetDate: '2027-07-01' },
      asOf: '2026-08-01',
      currency: 'PEN',
    });
  });

  it('errores del motor se explican sin inventar cifras', async () => {
    const assistant = new Assistant({
      llm: fakeLlm({
        extract: {
          kind: 'extraction',
          extraction: { query: 'plan', goalName: 'Viaje a Japón', targetAmount: '1.200', targetDate: '2026-07-01' },
        },
        narrate: new Error('sin narrador'),
      }),
    });

    const { text } = await assistant.handle('…', '2026-08-01'); // targetDate < asOf → TARGET_IN_PAST

    expect(text).toMatch(/ya pasó/);
    expect(text).not.toMatch(/\d/); // ni una cifra en la explicación del error
  });

  it('una aclaración del LLM con dígitos se reemplaza por la genérica', async () => {
    const assistant = new Assistant({
      llm: fakeLlm({
        extract: { kind: 'clarification', question: '¿Tu meta es de unos 5000 soles?' },
      }),
    });

    const { text } = await assistant.handle('…', '2026-08-01');

    expect(text).not.toContain('5000');
    expect(text).toMatch(/más de información|más detalles/);
  });
});

describe('buildRequest: validación determinista de la extracción', () => {
  it('monto ilegible → aclaración, nunca un request inválido', () => {
    const result = buildRequest(
      { query: 'plan', goalName: 'Meta', targetAmount: 'mil doscientos', targetDate: '2027-07-01' },
      '2026-08-01',
      'PEN',
    );
    expect(result.kind).toBe('clarification');
  });

  it('aporte periódico: importe literal y frecuencia pasan tal cual', () => {
    const result = buildRequest(
      {
        query: 'feasibility',
        goalName: 'Meta',
        targetAmount: '1.200',
        currentAmount: '600',
        targetDate: '2027-07-01',
        contribution: { amount: '54,55', frequency: 'monthly' },
      },
      '2026-09-01',
      'PEN',
    );
    expect(result).toEqual({
      kind: 'request',
      request: {
        query: { kind: 'feasibility' },
        goal: {
          name: 'Meta',
          targetAmount: 120000,
          currentAmount: 60000,
          targetDate: '2027-07-01',
          contribution: { amount: 5455, frequency: 'monthly' },
        },
        asOf: '2026-09-01',
        currency: 'PEN',
      },
    });
  });
});
