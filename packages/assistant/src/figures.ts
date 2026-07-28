// Cifras del motor, transportadas de forma opaca (CLAUDE.md §2): se copian
// tal cual a un mapa de placeholders. Nada las suma, resta ni transforma;
// solo la capa de presentación (format.ts) las vuelve texto al renderizar.

import type { Cents, GoalEngineResponse, ISODate } from 'goal-engine';

export type Figure =
  | { type: 'money'; cents: Cents }
  | { type: 'count'; value: number }
  | { type: 'date'; iso: ISODate }
  | { type: 'text'; value: string };

export function figuresFrom(
  response: GoalEngineResponse,
  goalName: string,
): Record<string, Figure> {
  const base: Record<string, Figure> = { goalName: { type: 'text', value: goalName } };

  switch (response.kind) {
    case 'plan':
      return {
        ...base,
        requiredContribution: { type: 'money', cents: response.requiredContribution },
        installments: { type: 'count', value: response.installments },
        finalInstallment: { type: 'money', cents: response.finalInstallment },
        completionDate: { type: 'date', iso: response.completionDate },
      };
    case 'projection':
      return {
        ...base,
        completionDate: { type: 'date', iso: response.completionDate },
        installments: { type: 'count', value: response.installments },
        finalContribution: { type: 'money', cents: response.finalContribution },
        totalContributed: { type: 'money', cents: response.totalContributed },
      };
    case 'feasibility':
      return {
        ...base,
        projectedAmount: { type: 'money', cents: response.projectedAmount },
        shortfall: { type: 'money', cents: response.shortfall },
        surplus: { type: 'money', cents: response.surplus },
      };
    case 'error':
      return base;
  }
}
