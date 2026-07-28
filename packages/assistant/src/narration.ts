// Narración: el LLM entrega un template con {{placeholders}} y sin dígitos.
// Si el template trae cualquier dígito o referencia un placeholder inexistente,
// se descarta entero y se usa un template determinista (CLAUDE.md §3: "se
// descarta o se filtra antes de mostrarse"). El render inserta las cifras
// reales desde figures, en el borde de presentación.

import type { Currency, GoalEngineResponse } from 'goal-engine';
import type { Figure } from './figures.js';
import { formatCents, formatDate } from './format.js';

const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g;

/** Seguro = sin dígitos fuera de placeholders y solo placeholders conocidos. */
export function isSafeTemplate(template: string, allowed: string[]): boolean {
  if (template.trim() === '') return false;
  if (/\d/.test(template.replace(PLACEHOLDER_RE, ''))) return false;
  for (const match of template.matchAll(PLACEHOLDER_RE)) {
    if (!allowed.includes(match[1])) return false;
  }
  return true;
}

/** Narración determinista de respaldo, por tipo de resultado. */
export function fallbackTemplate(response: GoalEngineResponse): string {
  switch (response.kind) {
    case 'plan':
      return 'Para «{{goalName}}» necesitás aportar {{requiredContribution}} por período: {{installments}} aportes en total, con un último aporte de {{finalInstallment}}, completando la meta el {{completionDate}}.';
    case 'projection':
      return 'Con ese aporte alcanzás «{{goalName}}» el {{completionDate}}, tras {{installments}} aportes; el último será de {{finalContribution}} y habrás aportado {{totalContributed}} en total.';
    case 'feasibility':
      return response.feasible
        ? 'Tu plan para «{{goalName}}» llega a tiempo: proyectás {{projectedAmount}} a la fecha límite, con un excedente de {{surplus}}.'
        : 'Con el plan actual no llegás a «{{goalName}}» a tiempo: proyectás {{projectedAmount}} y faltarían {{shortfall}}.';
    case 'error':
      switch (response.code) {
        case 'TARGET_IN_PAST':
          return 'La fecha límite de «{{goalName}}» ya pasó. Elegí una nueva fecha y lo recalculamos.';
        case 'ALREADY_REACHED':
          return '¡«{{goalName}}» ya está cumplida! No queda nada por calcular.';
        case 'NON_POSITIVE_AMOUNT':
          return 'Alguno de los importes de «{{goalName}}» no es válido: tienen que ser mayores que cero.';
        case 'MISSING_TARGET_DATE':
          return '¿Para qué fecha querés alcanzar «{{goalName}}»?';
        case 'MISSING_CONTRIBUTION':
          return '¿Cuánto y con qué frecuencia pensás aportar a «{{goalName}}»?';
      }
  }
}

/** Inserta las cifras reales; el formateo ocurre acá, en el borde. */
export function renderNarration(
  template: string,
  figures: Record<string, Figure>,
  currency: Currency,
): string {
  return template.replace(PLACEHOLDER_RE, (whole, key: string) => {
    const figure = figures[key];
    if (!figure) return whole;
    switch (figure.type) {
      case 'money':
        return formatCents(figure.cents, currency);
      case 'count':
        return String(figure.value);
      case 'date':
        return formatDate(figure.iso);
      case 'text':
        return figure.value;
    }
  });
}
