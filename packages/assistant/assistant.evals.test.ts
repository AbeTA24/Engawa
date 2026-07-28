import { describe, expect, it, vi } from 'vitest';
import { evaluateGoal, type Currency, type GoalEngineResponse, type ISODate } from 'goal-engine';
import {
  Assistant,
  formatCents,
  formatDate,
  type ExtractionResult,
  type LlmClient,
} from './src/index.js';

// ─────────────────────────────────────────────────────────────────────
// Evals de CLAUDE.md §3: ninguna cifra mostrada al usuario puede
// originarse en el LLM. Para cada pedido se espía la llamada al motor,
// se construye el conjunto de tokens numéricos AUTORIZADOS (cada cifra
// del output del motor, ya renderizada por la capa de presentación) y
// se tokeniza la respuesta final: cualquier número sin respaldo del
// motor hace fallar el eval. El LLM va guionado (determinista, sin red);
// varias narraciones son adversariales e intentan colar cifras propias.
// ─────────────────────────────────────────────────────────────────────

const TOKEN_RE = /\d+(?:[.,]\d+)*/g;

function numericTokens(text: string): string[] {
  return text.match(TOKEN_RE) ?? [];
}

/** Tokens numéricos que el motor respalda, tal como los renderiza format.ts. */
function authorizedTokens(responses: GoalEngineResponse[], currency: Currency): Set<string> {
  const allowed = new Set<string>();
  const admit = (rendered: string) => {
    for (const token of numericTokens(rendered)) allowed.add(token);
  };
  for (const response of responses) {
    switch (response.kind) {
      case 'plan':
        admit(formatCents(response.requiredContribution, currency));
        admit(formatCents(response.finalInstallment, currency));
        admit(String(response.installments));
        admit(formatDate(response.completionDate));
        break;
      case 'projection':
        admit(formatDate(response.completionDate));
        admit(String(response.installments));
        admit(formatCents(response.finalContribution, currency));
        admit(formatCents(response.totalContributed, currency));
        break;
      case 'feasibility':
        admit(formatCents(response.projectedAmount, currency));
        admit(formatCents(response.shortfall, currency));
        admit(formatCents(response.surplus, currency));
        break;
      case 'error':
        break; // un error no respalda ninguna cifra
    }
  }
  return allowed;
}

interface EvalCase {
  name: string;
  utterance: string;
  asOf: ISODate;
  extract: ExtractionResult;
  /** Narración guionada; si falta, el narrador falla y actúa el fallback. */
  narrate?: string;
  /** Cifras esperadas, verificadas a mano contra las reglas del motor. */
  expectContains?: string[];
  /** El caso no admite ni un dígito en la respuesta. */
  expectNoDigits?: boolean;
}

function scriptedLlm(evalCase: EvalCase): LlmClient {
  return {
    extract: async () => evalCase.extract,
    narrate: async () => {
      if (evalCase.narrate === undefined) throw new Error('narrador caído');
      return evalCase.narrate;
    },
  };
}

const CASES: EvalCase[] = [
  // ── Metas de viaje ──────────────────────────────────────────────────
  {
    // A mano: 3.900 € entre 13 aportes (ago 2026 → ago 2027) = 300 €/mes.
    name: 'viaje: plan con división exacta',
    utterance: 'Quiero juntar 3.900 € para un viaje a Japón antes de agosto de 2027.',
    asOf: '2026-08-01',
    extract: {
      kind: 'extraction',
      extraction: { query: 'plan', goalName: 'Viaje a Japón', targetAmount: '3.900', targetDate: '2027-08-01' },
    },
    narrate: 'Para {{goalName}} necesitás {{requiredContribution}} al mes: {{installments}} aportes hasta el {{completionDate}}.',
    expectContains: ['300,00 €', '13', '1 de agosto de 2027'],
  },
  {
    // A mano: 900 € a 150 €/mes = 6 aportes; el sexto cae el 2027-01-01.
    name: 'viaje: projection — cuándo llego',
    utterance: 'Estoy poniendo 150 € por mes para un viaje a Bariloche; la meta son 900 €. ¿Cuándo llego?',
    asOf: '2026-08-01',
    extract: {
      kind: 'extraction',
      extraction: {
        query: 'projection',
        goalName: 'Bariloche',
        targetAmount: '900',
        contribution: { amount: '150', frequency: 'monthly' },
      },
    },
    narrate: 'Alcanzás {{goalName}} el {{completionDate}}, tras {{installments}} aportes; el último será de {{finalContribution}} y habrás puesto {{totalContributed}}.',
    expectContains: ['1 de enero de 2027', '6', '150,00 €', '900,00 €'],
  },
  {
    // A mano: 12 × 200 € = 2.400 € justos → feasible con excedente cero.
    name: 'viaje: feasibility justa',
    utterance: '¿Llego a juntar 2.400 € para Roma antes de julio de 2027 poniendo 200 € al mes?',
    asOf: '2026-08-01',
    extract: {
      kind: 'extraction',
      extraction: {
        query: 'feasibility',
        goalName: 'Roma',
        targetAmount: '2.400',
        targetDate: '2027-07-01',
        contribution: { amount: '200', frequency: 'monthly' },
      },
    },
    narrate: 'Llegás justo a {{goalName}}: proyectás {{projectedAmount}}, con {{surplus}} de sobra.',
    expectContains: ['2.400,00 €', '0,00 €'],
  },

  // ── Cuota inicial ───────────────────────────────────────────────────
  {
    // A mano: 24.000 € entre 24 aportes (ago 2026 → jul 2028) = 1.000 €/mes.
    name: 'cuota inicial: plan a dos años (narrador caído → fallback)',
    utterance: 'Necesito 24.000 € para la cuota inicial de un departamento antes de julio de 2028.',
    asOf: '2026-08-01',
    extract: {
      kind: 'extraction',
      extraction: { query: 'plan', goalName: 'Cuota inicial del depto', targetAmount: '24.000', targetDate: '2028-07-01' },
    },
    expectContains: ['1.000,00 €', '24', '1 de julio de 2028'],
  },
  {
    // A mano: restan 15.000 € entre 11 aportes (ago 2026 → jun 2027).
    // 1500000/11 = 136363,6… → ceil 136364 (1.363,64 €);
    // último: 1500000 − 10×136364 = 136360 (1.363,60 €). Cierra exacto.
    name: 'cuota inicial: plan con redondeo y ahorro previo',
    utterance: 'Ya tengo 5.000 € ahorrados y necesito llegar a 20.000 € para la cuota inicial antes de junio de 2027.',
    asOf: '2026-08-01',
    extract: {
      kind: 'extraction',
      extraction: {
        query: 'plan',
        goalName: 'Cuota inicial',
        targetAmount: '20.000',
        currentAmount: '5.000',
        targetDate: '2027-06-01',
      },
    },
    narrate: 'Con {{requiredContribution}} al mes lo lográs; el último aporte queda en {{finalInstallment}}.',
    expectContains: ['1.363,64 €', '1.363,60 €'],
  },

  // ── Maestría ────────────────────────────────────────────────────────
  {
    // A mano: 9.600 € entre 12 aportes (ago 2026 → jul 2027) = 800 €/mes.
    name: 'maestría: plan exacto',
    utterance: 'La maestría cuesta 9.600 € y la tengo que pagar en julio de 2027. ¿Cuánto guardo por mes?',
    asOf: '2026-08-01',
    extract: {
      kind: 'extraction',
      extraction: { query: 'plan', goalName: 'Maestría', targetAmount: '9.600', targetDate: '2027-07-01' },
    },
    narrate: 'Guardando {{requiredContribution}} por mes cubrís {{goalName}} justo a tiempo, el {{completionDate}}.',
    expectContains: ['800,00 €', '1 de julio de 2027'],
  },
  {
    // A mano: 12 × 500 € = 6.000 € frente a 9.600 € → faltan 3.600 €.
    // La narración adversarial inventa "4000 €": debe descartarse entera.
    name: 'maestría: feasibility imposible con narración adversarial',
    utterance: '¿Me alcanza para la maestría de 9.600 € si ahorro 500 € al mes hasta julio de 2027?',
    asOf: '2026-08-01',
    extract: {
      kind: 'extraction',
      extraction: {
        query: 'feasibility',
        goalName: 'Maestría',
        targetAmount: '9.600',
        targetDate: '2027-07-01',
        contribution: { amount: '500', frequency: 'monthly' },
      },
    },
    narrate: 'Te faltan como 4000 € para llegar a la maestría.',
    expectContains: ['6.000,00 €', '3.600,00 €'],
  },

  // ── Ingreso irregular: recálculo tras cada aporte real ──────────────
  {
    // A mano: 1.200 € entre 12 aportes = 100 €/mes.
    name: 'ingreso irregular: arranque del plan',
    utterance: 'Cobro por proyectos, sin sueldo fijo. Quiero 1.200 € para julio de 2027: ¿cuánto pongo por mes?',
    asOf: '2026-08-01',
    extract: {
      kind: 'extraction',
      extraction: { query: 'plan', goalName: 'Viaje a Japón', targetAmount: '1.200', targetDate: '2027-07-01' },
    },
    narrate: 'Arrancamos: {{requiredContribution}} al mes durante {{installments}} meses.',
    expectContains: ['100,00 €', '12'],
  },
  {
    // A mano: restan 600 € entre 11 aportes → ceil = 54,55 €; último 54,50 €.
    // La narración adversarial redondea a "55 €": debe descartarse.
    name: 'ingreso irregular: mes excelente, narración que redondea',
    utterance: 'Me pagaron un proyecto grande y ya puse 600 €. ¿Cómo queda el plan?',
    asOf: '2026-09-01',
    extract: {
      kind: 'extraction',
      extraction: {
        query: 'plan',
        goalName: 'Viaje a Japón',
        targetAmount: '1.200',
        currentAmount: '600',
        targetDate: '2027-07-01',
      },
    },
    narrate: 'Gran mes: ahora con unos 55 € mensuales llegás.',
    expectContains: ['54,55 €', '54,50 €'],
  },
  {
    // A mano: restan 550 € entre 8 aportes (dic 2026 → jul 2027) = 68,75 €.
    name: 'ingreso irregular: meses flojos, recálculo',
    utterance: 'Estos meses fueron flojos, solo sumé 50 € más. Recalculame el plan.',
    asOf: '2026-12-01',
    extract: {
      kind: 'extraction',
      extraction: {
        query: 'plan',
        goalName: 'Viaje a Japón',
        targetAmount: '1.200',
        currentAmount: '650',
        targetDate: '2027-07-01',
      },
    },
    narrate: 'Tras el bajón, el plan queda en {{requiredContribution}} al mes por {{installments}} meses.',
    expectContains: ['68,75 €', '8'],
  },

  // ── Pedidos ambiguos ────────────────────────────────────────────────
  {
    name: 'ambiguo: sin meta ni monto → aclaración sin cifras',
    utterance: 'Quiero empezar a ahorrar.',
    asOf: '2026-08-01',
    extract: { kind: 'clarification', question: '¿Para qué meta querés ahorrar y cuánto te gustaría juntar?' },
    expectContains: ['¿Para qué meta querés ahorrar'],
    expectNoDigits: true,
  },
  {
    // El LLM intenta sugerir un monto en su aclaración: se reemplaza entera.
    name: 'ambiguo: aclaración adversarial con monto inventado',
    utterance: 'Quiero ahorrar para algo grande, todavía no sé cuánto.',
    asOf: '2026-08-01',
    extract: { kind: 'clarification', question: '¿Tu meta ronda los 10.000 €?' },
    expectNoDigits: true,
  },

  // ── Pedidos imposibles ──────────────────────────────────────────────
  {
    // targetDate anterior a asOf → TARGET_IN_PAST. La narración adversarial
    // cuantifica el atraso ("8 meses"): sin respaldo del motor, se descarta.
    name: 'imposible: plazo ya vencido',
    utterance: 'Quiero juntar 5.000 € para diciembre de 2025.',
    asOf: '2026-08-01',
    extract: {
      kind: 'extraction',
      extraction: { query: 'plan', goalName: 'Meta atrasada', targetAmount: '5.000', targetDate: '2025-12-01' },
    },
    narrate: 'Se te pasó por 8 meses, elegí otra fecha.',
    expectContains: ['ya pasó'],
    expectNoDigits: true,
  },
  {
    // currentAmount ≥ targetAmount → ALREADY_REACHED, sin nada que calcular.
    name: 'imposible: meta ya cumplida',
    utterance: 'Tengo 3.000 € guardados y mi meta era de 2.500 €. ¿Cuánto me falta por mes?',
    asOf: '2026-08-01',
    extract: {
      kind: 'extraction',
      extraction: {
        query: 'plan',
        goalName: 'Fondo de arranque',
        targetAmount: '2.500',
        currentAmount: '3.000',
        targetDate: '2027-07-01',
      },
    },
    expectContains: ['ya está cumplida'],
    expectNoDigits: true,
  },
  {
    // Aporte 0 → NON_POSITIVE_AMOUNT: no existe fecha de llegada. La
    // narración adversarial inventa "3 meses": se descarta entera.
    name: 'imposible: aporte cero con plazo inventado por el LLM',
    utterance: '¿Cuándo llego a 1.000 € si por ahora no puedo aportar nada?',
    asOf: '2026-08-01',
    extract: {
      kind: 'extraction',
      extraction: {
        query: 'projection',
        goalName: 'Colchón de emergencia',
        targetAmount: '1.000',
        contribution: { amount: '0', frequency: 'monthly' },
      },
    },
    narrate: 'En unos 3 meses llegás sin problema.',
    expectContains: ['no es válido'],
    expectNoDigits: true,
  },
];

describe('evals: toda cifra de la respuesta tiene respaldo exacto del motor', () => {
  it.each(CASES)('$name', async (evalCase) => {
    const engine = vi.fn(evaluateGoal);
    const assistant = new Assistant({ llm: scriptedLlm(evalCase), engine });

    const { text } = await assistant.handle(evalCase.utterance, evalCase.asOf);

    // Verificador central: cada token numérico de la respuesta debe existir,
    // idéntico, entre los tokens que el output del motor respalda.
    const responses = engine.mock.results.map((r) => r.value as GoalEngineResponse);
    const allowed = authorizedTokens(responses, 'EUR');
    for (const token of numericTokens(text)) {
      expect(
        allowed.has(token),
        `cifra sin respaldo del motor: "${token}" en la respuesta "${text}"`,
      ).toBe(true);
    }

    for (const expected of evalCase.expectContains ?? []) {
      expect(text).toContain(expected);
    }
    if (evalCase.expectNoDigits) {
      expect(text).not.toMatch(/\d/);
    }
  });
});
