// Contrato de tipos assistant ↔ goal-engine.
// Copia fiel de la sección 5 de CLAUDE.md; cualquier cambio se acuerda
// primero en ese documento.

/** Dinero: entero en céntimos (10,50 € → 1050). Nunca float. */
export type Cents = number;

/** Fecha civil ISO-8601 sin hora: "2026-07-28". */
export type ISODate = string;

/** Código de moneda ISO 4217: "EUR". */
export type Currency = string;

export interface GoalEngineRequest {
  query: GoalQuery;
  goal: GoalInput;
  asOf: ISODate;
  currency: Currency;
}

/** Una pregunta por llamada. Unión discriminada. */
export type GoalQuery =
  | { kind: 'plan' }
  | { kind: 'projection' }
  | { kind: 'feasibility' };

export interface GoalInput {
  name: string;
  targetAmount: Cents;
  currentAmount: Cents;
  targetDate?: ISODate;
  contribution?: ContributionInput;
}

export interface ContributionInput {
  amount: Cents;
  frequency: 'weekly' | 'biweekly' | 'monthly';
  startDate?: ISODate;
}

export type GoalEngineResponse =
  | PlanResult
  | ProjectionResult
  | FeasibilityResult
  | EngineError;

export interface PlanResult {
  kind: 'plan';
  requiredContribution: Cents;
  installments: number;
  finalInstallment: Cents;
  completionDate: ISODate;
}

export interface ProjectionResult {
  kind: 'projection';
  completionDate: ISODate;
  installments: number;
  finalContribution: Cents;
  totalContributed: Cents;
}

export interface FeasibilityResult {
  kind: 'feasibility';
  feasible: boolean;
  projectedAmount: Cents;
  shortfall: Cents;
  surplus: Cents;
}

export interface EngineError {
  kind: 'error';
  code:
    | 'TARGET_IN_PAST'
    | 'MISSING_TARGET_DATE'
    | 'MISSING_CONTRIBUTION'
    | 'NON_POSITIVE_AMOUNT'
    | 'ALREADY_REACHED';
  message: string;
}
