import { describe, expect, it } from 'vitest';
import { evaluateGoal, type GoalEngineRequest } from './src/index.js';

// Convenciones que estos tests fijan (verificables a mano):
//
// - Todos los importes en céntimos enteros: S/ 1,200.00 → 120000.
// - Aportes mensuales: el primero cae en startDate (o asOf si se omite) y
//   luego el mismo día de cada mes. Cuentan los aportes con fecha ≤ targetDate.
//   Ej.: de 2026-08-01 a 2027-07-01 inclusive hay 12 aportes.
// - Redondeo en 'plan': requiredContribution = ceil(restante / aportes);
//   finalInstallment = restante − (aportes−1) × requiredContribution.
//   La suma de los aportes cierra exacta con el restante: ni un céntimo
//   perdido ni creado.
// - En 'feasibility' los aportes no se recortan: projectedAmount es lo
//   acumulado en targetDate aportando siempre el importe completo.
// - El motor es determinista y sin reloj: "hoy" siempre entra como asOf.

const base = {
  asOf: '2026-08-01',
  currency: 'PEN',
} as const;

const meta = (over: Partial<GoalEngineRequest['goal']>): GoalEngineRequest['goal'] => ({
  name: 'Viaje a Japón',
  targetAmount: 120000, // S/ 1,200.00
  currentAmount: 0,
  targetDate: '2027-07-01',
  ...over,
});

describe('goal-engine: feasibility', () => {
  it('meta alcanzable con holgura', () => {
    // A mano: 12 aportes de S/ 200.00 = S/ 2,400.00 frente a una meta de
    // S/ 1,200.00 → sobra exactamente S/ 1,200.00.
    const result = evaluateGoal({
      ...base,
      query: { kind: 'feasibility' },
      goal: meta({
        contribution: { amount: 20000, frequency: 'monthly' },
      }),
    });

    expect(result).toEqual({
      kind: 'feasibility',
      feasible: true,
      projectedAmount: 240000, // S/ 2,400.00
      shortfall: 0,
      surplus: 120000, // S/ 1,200.00
    });
  });

  it('meta alcanzable justa, sin margen', () => {
    // A mano: 12 aportes de S/ 100.00 = S/ 1,200.00 exactos.
    const result = evaluateGoal({
      ...base,
      query: { kind: 'feasibility' },
      goal: meta({
        contribution: { amount: 10000, frequency: 'monthly' },
      }),
    });

    expect(result).toEqual({
      kind: 'feasibility',
      feasible: true,
      projectedAmount: 120000, // S/ 1,200.00 justos
      shortfall: 0,
      surplus: 0,
    });
  });

  it('meta imposible en el plazo', () => {
    // A mano: 12 aportes de S/ 50.00 = S/ 600.00 → faltan S/ 600.00.
    const result = evaluateGoal({
      ...base,
      query: { kind: 'feasibility' },
      goal: meta({
        contribution: { amount: 5000, frequency: 'monthly' },
      }),
    });

    expect(result).toEqual({
      kind: 'feasibility',
      feasible: false,
      projectedAmount: 60000, // S/ 600.00
      shortfall: 60000, // S/ 600.00
      surplus: 0,
    });
  });
});

describe('goal-engine: ingreso cero', () => {
  it('aporte de 0 → error tipado, nunca una fecha inventada', () => {
    // Con aporte 0 no existe fecha de cumplimiento; el motor debe negarse
    // con un error tipado y el assistant lo explica sin fabricar cifras.
    const result = evaluateGoal({
      ...base,
      query: { kind: 'projection' },
      goal: meta({
        targetDate: undefined,
        contribution: { amount: 0, frequency: 'monthly' },
      }),
    });

    expect(result).toMatchObject({
      kind: 'error',
      code: 'NON_POSITIVE_AMOUNT',
    });
  });
});

describe('goal-engine: ingreso irregular con alta volatilidad', () => {
  // El motor es determinista: no predice volatilidad. Un ingreso irregular
  // se maneja recalculando el plan tras cada aporte real. Esta secuencia
  // simula un mes excelente seguido de tres meses casi nulos.

  it('recalculo inicial: sin ahorro previo', () => {
    // A mano: S/ 1,200.00 entre 12 aportes (ago 2026 → jul 2027) = S/ 100.00 al mes.
    const result = evaluateGoal({
      ...base,
      query: { kind: 'plan' },
      goal: meta({}),
    });

    expect(result).toEqual({
      kind: 'plan',
      requiredContribution: 10000, // S/ 100.00
      installments: 12,
      finalInstallment: 10000,
      completionDate: '2027-07-01',
    });
  });

  it('recalculo tras un mes excelente: aportó S/ 600.00 de golpe', () => {
    // A mano: restan S/ 600.00 entre 11 aportes (sep 2026 → jul 2027).
    // 60000 / 11 = 5454,54… → ceil = 5455 (S/ 54.55).
    // Último aporte: 60000 − 10 × 5455 = 5450 (S/ 54.50).
    // Comprobación: 10 × 5455 + 5450 = 60000 exactos.
    const result = evaluateGoal({
      ...base,
      asOf: '2026-09-01',
      query: { kind: 'plan' },
      goal: meta({ currentAmount: 60000 }),
    });

    expect(result).toEqual({
      kind: 'plan',
      requiredContribution: 5455, // S/ 54.55
      installments: 11,
      finalInstallment: 5450, // S/ 54.50
      completionDate: '2027-07-01',
    });
  });

  it('recalculo tras tres meses malos: solo sumó S/ 50.00 más', () => {
    // A mano: restan S/ 550.00 entre 8 aportes (dic 2026 → jul 2027).
    // 55000 / 8 = 6875 exactos (S/ 68.75).
    const result = evaluateGoal({
      ...base,
      asOf: '2026-12-01',
      query: { kind: 'plan' },
      goal: meta({ currentAmount: 65000 }),
    });

    expect(result).toEqual({
      kind: 'plan',
      requiredContribution: 6875, // S/ 68.75
      installments: 8,
      finalInstallment: 6875,
      completionDate: '2027-07-01',
    });
  });
});

describe('goal-engine: casos frontera', () => {
  it('meta ya cumplida', () => {
    // currentAmount ≥ targetAmount: no hay nada que calcular.
    const result = evaluateGoal({
      ...base,
      query: { kind: 'plan' },
      goal: meta({ currentAmount: 120000 }),
    });

    expect(result).toMatchObject({
      kind: 'error',
      code: 'ALREADY_REACHED',
    });
  });

  it('plazo vencido', () => {
    // targetDate anterior a asOf.
    const result = evaluateGoal({
      ...base,
      query: { kind: 'plan' },
      goal: meta({ targetDate: '2026-07-01' }),
    });

    expect(result).toMatchObject({
      kind: 'error',
      code: 'TARGET_IN_PAST',
    });
  });
});
