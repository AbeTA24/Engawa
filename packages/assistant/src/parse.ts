// Borde de entrada: convierte la transcripción literal del usuario a Cents.
// Determinista y por manipulación de strings — concatena dígitos, no hay ni
// una multiplicación. Convención española: ',' decimal, '.' separador de miles.

import type { Cents } from 'goal-engine';

/** "1.200,50 €" → 120050 · "300 euros" → 30000 · "0,05" → 5 · inválido → null */
export function parseAmountLiteral(raw: string): Cents | null {
  const cleaned = raw.replace(/[^\d.,]/g, '');
  if (!/\d/.test(cleaned)) return null;

  const parts = cleaned.split(',');
  if (parts.length > 2) return null;

  const euros = parts[0].replace(/\./g, '') || '0';
  const centsPart = parts[1] ?? '';
  if (centsPart.length > 2 || /\./.test(centsPart)) return null;

  return Number(euros + centsPart.padEnd(2, '0'));
}

/** Fecha civil ISO tal como la produjo la extracción; se valida la forma. */
export function parseISODate(raw: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}
