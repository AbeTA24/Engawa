// Los 15 casos de eval, compartidos por la suite guionada (CI) y la suite
// en vivo (LIVE_EVALS=1). En modo guionado se usan extract/narrate tal cual;
// en vivo solo utterance + asOf, y el LLM real hace el resto.

import type { ISODate } from 'goal-engine';
import type { ExtractionResult } from '../src/index.js';

export interface EvalCase {
  name: string;
  utterance: string;
  asOf: ISODate;
  extract: ExtractionResult;
  /** Narración guionada; si falta, el narrador falla y actúa el fallback. */
  narrate?: string;
  /** Cifras esperadas (solo modo guionado), verificadas a mano. */
  expectContains?: string[];
  /** El caso no admite ni un dígito en la respuesta (solo modo guionado). */
  expectNoDigits?: boolean;
}

export const CASES: EvalCase[] = [
  // ── Metas de viaje ──────────────────────────────────────────────────
  {
    // A mano: S/ 3,900.00 entre 13 aportes (ago 2026 → ago 2027) = S/ 300.00 al mes.
    name: 'viaje: plan con división exacta',
    utterance: 'Quiero juntar 3.900 soles para un viaje a Japón antes de agosto de 2027.',
    asOf: '2026-08-01',
    extract: {
      kind: 'extraction',
      extraction: { query: 'plan', goalName: 'Viaje a Japón', targetAmount: '3.900', targetDate: '2027-08-01' },
    },
    narrate: 'Para {{goalName}} necesitás {{requiredContribution}} al mes: {{installments}} aportes hasta el {{completionDate}}.',
    expectContains: ['S/ 300.00', '13', '1 de agosto de 2027'],
  },
  {
    // A mano: S/ 900.00 a S/ 150.00 al mes = 6 aportes; el sexto cae el 2027-01-01.
    name: 'viaje: projection — cuándo llego',
    utterance: 'Estoy poniendo 150 soles por mes para un viaje a Bariloche; la meta son 900 soles. ¿Cuándo llego?',
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
    expectContains: ['1 de enero de 2027', '6', 'S/ 150.00', 'S/ 900.00'],
  },
  {
    // A mano: 12 × S/ 200.00 = S/ 2,400.00 justos → feasible con excedente cero.
    name: 'viaje: feasibility justa',
    utterance: '¿Llego a juntar 2.400 soles para Roma antes de julio de 2027 poniendo 200 soles al mes?',
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
    expectContains: ['S/ 2,400.00', 'S/ 0.00'],
  },

  // ── Cuota inicial ───────────────────────────────────────────────────
  {
    // A mano: S/ 24,000.00 entre 24 aportes (ago 2026 → jul 2028) = S/ 1,000.00 al mes.
    name: 'cuota inicial: plan a dos años (narrador caído → fallback)',
    utterance: 'Necesito 24.000 soles para la cuota inicial de un departamento antes de julio de 2028.',
    asOf: '2026-08-01',
    extract: {
      kind: 'extraction',
      extraction: { query: 'plan', goalName: 'Cuota inicial del depto', targetAmount: '24.000', targetDate: '2028-07-01' },
    },
    expectContains: ['S/ 1,000.00', '24', '1 de julio de 2028'],
  },
  {
    // A mano: restan S/ 15,000.00 entre 11 aportes (ago 2026 → jun 2027).
    // 1500000/11 = 136363,6… → ceil 136364 (S/ 1,363.64);
    // último: 1500000 − 10×136364 = 136360 (S/ 1,363.60). Cierra exacto.
    name: 'cuota inicial: plan con redondeo y ahorro previo',
    utterance: 'Ya tengo 5.000 soles ahorrados y necesito llegar a 20.000 soles para la cuota inicial antes de junio de 2027.',
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
    expectContains: ['S/ 1,363.64', 'S/ 1,363.60'],
  },

  // ── Maestría ────────────────────────────────────────────────────────
  {
    // A mano: S/ 9,600.00 entre 12 aportes (ago 2026 → jul 2027) = S/ 800.00 al mes.
    name: 'maestría: plan exacto',
    utterance: 'La maestría cuesta 9.600 soles y la tengo que pagar en julio de 2027. ¿Cuánto guardo por mes?',
    asOf: '2026-08-01',
    extract: {
      kind: 'extraction',
      extraction: { query: 'plan', goalName: 'Maestría', targetAmount: '9.600', targetDate: '2027-07-01' },
    },
    narrate: 'Guardando {{requiredContribution}} por mes cubrís {{goalName}} justo a tiempo, el {{completionDate}}.',
    expectContains: ['S/ 800.00', '1 de julio de 2027'],
  },
  {
    // A mano: 12 × S/ 500.00 = S/ 6,000.00 frente a S/ 9,600.00 → faltan S/ 3,600.00.
    // La narración adversarial inventa "4000 soles": debe descartarse entera.
    name: 'maestría: feasibility imposible con narración adversarial',
    utterance: '¿Me alcanza para la maestría de 9.600 soles si ahorro 500 soles al mes hasta julio de 2027?',
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
    narrate: 'Te faltan como 4000 soles para llegar a la maestría.',
    expectContains: ['S/ 6,000.00', 'S/ 3,600.00'],
  },

  // ── Ingreso irregular: recálculo tras cada aporte real ──────────────
  {
    // A mano: S/ 1,200.00 entre 12 aportes = S/ 100.00 al mes.
    name: 'ingreso irregular: arranque del plan',
    utterance: 'Cobro por proyectos, sin sueldo fijo. Quiero 1.200 soles para julio de 2027: ¿cuánto pongo por mes?',
    asOf: '2026-08-01',
    extract: {
      kind: 'extraction',
      extraction: { query: 'plan', goalName: 'Viaje a Japón', targetAmount: '1.200', targetDate: '2027-07-01' },
    },
    narrate: 'Arrancamos: {{requiredContribution}} al mes durante {{installments}} meses.',
    expectContains: ['S/ 100.00', '12'],
  },
  {
    // A mano: restan S/ 600.00 entre 11 aportes → ceil = S/ 54.55; último S/ 54.50.
    // La narración adversarial redondea a "55 soles": debe descartarse.
    name: 'ingreso irregular: mes excelente, narración que redondea',
    utterance: 'Me pagaron un proyecto grande y ya puse 600 soles de los 1.200 de mi meta para julio de 2027. ¿Cómo queda el plan?',
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
    narrate: 'Gran mes: ahora con unos 55 soles mensuales llegás.',
    expectContains: ['S/ 54.55', 'S/ 54.50'],
  },
  {
    // A mano: restan S/ 550.00 entre 8 aportes (dic 2026 → jul 2027) = S/ 68.75.
    name: 'ingreso irregular: meses flojos, recálculo',
    utterance: 'Meses flojos: llevo 650 soles de los 1.200 de mi meta para julio de 2027. Recalculame el plan.',
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
    expectContains: ['S/ 68.75', '8'],
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
    extract: { kind: 'clarification', question: '¿Tu meta ronda los 10.000 soles?' },
    expectNoDigits: true,
  },

  // ── Pedidos imposibles ──────────────────────────────────────────────
  {
    // targetDate anterior a asOf → TARGET_IN_PAST. La narración adversarial
    // cuantifica el atraso ("8 meses"): sin respaldo del motor, se descarta.
    name: 'imposible: plazo ya vencido',
    utterance: 'Quiero juntar 5.000 soles para diciembre de 2025.',
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
    utterance: 'Tengo 3.000 soles guardados y mi meta era de 2.500 soles. ¿Cuánto me falta por mes?',
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
    utterance: '¿Cuándo llego a 1.000 soles si por ahora no puedo aportar nada?',
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
