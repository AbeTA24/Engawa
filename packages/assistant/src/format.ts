// Borde de presentación (CLAUDE.md §4): único lugar donde los céntimos se
// vuelven texto legible. Por manipulación de strings, sin floats.

import type { Cents, Currency, ISODate } from 'goal-engine';

/** 120050 → "1.200,50 €" · 5 → "0,05 €" */
export function formatCents(cents: Cents, currency: Currency): string {
  const digits = String(cents).padStart(3, '0');
  const euros = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const decimals = digits.slice(-2);
  const symbol = currency === 'EUR' ? '€' : currency;
  return `${euros},${decimals} ${symbol}`;
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
