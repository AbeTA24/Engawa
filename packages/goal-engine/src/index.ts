import type {
  Cents,
  ContributionInput,
  EngineError,
  GoalEngineRequest,
  GoalEngineResponse,
  ISODate,
} from './types.js';

export * from './types.js';

// ── Fechas civiles ────────────────────────────────────────────────────
// Aritmética sobre "YYYY-MM-DD" sin reloj ni zona horaria: la comparación
// lexicográfica de ISO-8601 coincide con la cronológica.

function toISO(y: number, m: number, d: number): ISODate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function addMonths(date: ISODate, months: number): ISODate {
  const [y, m, d] = date.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate(); // día 0 del mes siguiente
  return toISO(ny, nm, Math.min(d, lastDay));
}

function addDays(date: ISODate, days: number): ISODate {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return toISO(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Fecha del aporte i (0-indexado) de una serie que arranca en start. */
function installmentDate(start: ISODate, frequency: ContributionInput['frequency'], i: number): ISODate {
  switch (frequency) {
    case 'monthly':
      return addMonths(start, i);
    case 'biweekly':
      return addDays(start, 14 * i);
    case 'weekly':
      return addDays(start, 7 * i);
  }
}

/** Cantidad de aportes con fecha ≤ targetDate. El primero cae en start. */
function countInstallments(start: ISODate, frequency: ContributionInput['frequency'], targetDate: ISODate): number {
  let n = 0;
  while (installmentDate(start, frequency, n) <= targetDate) n++;
  return n;
}

// ── Motor ─────────────────────────────────────────────────────────────

function error(code: EngineError['code'], message: string): EngineError {
  return { kind: 'error', code, message };
}

export function evaluateGoal(request: GoalEngineRequest): GoalEngineResponse {
  const { query, goal, asOf } = request;
  const { targetAmount, currentAmount, targetDate, contribution } = goal;

  if (targetAmount <= 0 || currentAmount < 0 || (contribution && contribution.amount <= 0)) {
    return error('NON_POSITIVE_AMOUNT', 'targetAmount and contribution.amount must be > 0; currentAmount must be >= 0');
  }
  if (currentAmount >= targetAmount) {
    return error('ALREADY_REACHED', `currentAmount ${currentAmount} >= targetAmount ${targetAmount}`);
  }

  const needsDate = query.kind === 'plan' || query.kind === 'feasibility';
  const needsContribution = query.kind === 'projection' || query.kind === 'feasibility';
  if (needsDate && !targetDate) {
    return error('MISSING_TARGET_DATE', `query '${query.kind}' requires goal.targetDate`);
  }
  if (needsContribution && !contribution) {
    return error('MISSING_CONTRIBUTION', `query '${query.kind}' requires goal.contribution`);
  }
  if (targetDate && targetDate < asOf) {
    return error('TARGET_IN_PAST', `targetDate ${targetDate} is before asOf ${asOf}`);
  }

  const remaining: Cents = targetAmount - currentAmount;

  switch (query.kind) {
    case 'plan': {
      // Serie mensual desde asOf (fijado por los tests): cuota redondeada
      // hacia arriba, el último aporte absorbe la diferencia para que la
      // suma cierre exacta con remaining.
      const installments = countInstallments(asOf, 'monthly', targetDate!);
      const requiredContribution = Math.ceil(remaining / installments);
      const finalInstallment = remaining - (installments - 1) * requiredContribution;
      return {
        kind: 'plan',
        requiredContribution,
        installments,
        finalInstallment,
        completionDate: installmentDate(asOf, 'monthly', installments - 1),
      };
    }

    case 'projection': {
      const { amount, frequency, startDate } = contribution!;
      const installments = Math.ceil(remaining / amount);
      const finalContribution = remaining - (installments - 1) * amount;
      return {
        kind: 'projection',
        completionDate: installmentDate(startDate ?? asOf, frequency, installments - 1),
        installments,
        finalContribution,
        totalContributed: remaining, // currentAmount + aportes = targetAmount, exacto
      };
    }

    case 'feasibility': {
      const { amount, frequency, startDate } = contribution!;
      const installments = countInstallments(startDate ?? asOf, frequency, targetDate!);
      const projectedAmount = currentAmount + installments * amount;
      const shortfall = Math.max(0, targetAmount - projectedAmount);
      const surplus = Math.max(0, projectedAmount - targetAmount);
      return {
        kind: 'feasibility',
        feasible: shortfall === 0,
        projectedAmount,
        shortfall,
        surplus,
      };
    }
  }
}
