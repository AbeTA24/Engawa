// Borde de presentación (CLAUDE.md §4): único lugar donde los céntimos se
// vuelven texto legible. Por manipulación de strings, sin floats.
// Convención de soles peruanos: "S/ 1,363.64" — símbolo antes del monto con
// un espacio, coma como separador de miles, punto como decimal.

import type { Cents, Currency, ISODate } from 'goal-engine';

const SYMBOLS: Record<string, string> = { PEN: 'S/' };

/** 136364 → "S/ 1,363.64" · 5 → "S/ 0.05" */
export function formatCents(cents: Cents, currency: Currency): string {
  const digits = String(cents).padStart(3, '0');
  const units = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const decimals = digits.slice(-2);
  return `${SYMBOLS[currency] ?? currency} ${units}.${decimals}`;
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** "2027-07-01" → "1 de julio de 2027" */
export function formatDate(iso: ISODate): string {
  const [y, m, d] = iso.split('-');
  return `${Number(d)} de ${MESES[Number(m) - 1]} de ${y}`;
}
