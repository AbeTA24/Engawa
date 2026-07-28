// Detector de fugas de cifras (CLAUDE.md §3): dado el texto final mostrado
// al usuario y los outputs del motor de esa corrida, encuentra toda cifra
// sin respaldo. Detecta dígitos, números escritos en palabras ("mil
// trescientos", "tres meses"), porcentajes (que el motor jamás produce) y
// rangos ("entre X y Y", "100-200").
//
// Autorizado = cifras del output del motor tal como las renderiza la capa
// de presentación, más los tokens del nombre de la meta (dato de origen
// transcrito del usuario). Un número en palabras se autoriza solo si su
// valor coincide con: cantidad de aportes, día o año de una fecha
// respaldada, o el monto en soles enteros de una cifra respaldada.

import type { Currency, GoalEngineResponse } from 'goal-engine';
import { formatCents, formatDate } from '../src/format.js';

export interface Leak {
  kind: 'digits' | 'words' | 'percent' | 'range';
  token: string;
}

const TOKEN_RE = /\d+(?:[.,]\d+)*/g;

export function numericTokens(text: string): string[] {
  return text.match(TOKEN_RE) ?? [];
}

// ── Conjuntos autorizados ─────────────────────────────────────────────

/** Tokens de dígitos respaldados, tal como los renderiza format.ts. */
export function authorizedTokens(
  responses: GoalEngineResponse[],
  goalName: string,
  currency: Currency,
): Set<string> {
  const allowed = new Set<string>();
  const admit = (rendered: string) => {
    for (const token of numericTokens(rendered)) allowed.add(token);
  };
  admit(goalName); // dato de origen: el usuario puede llamar a su meta "Casa 2030"
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

/** Valores contra los que se compara un número escrito en palabras. */
export function authorizedValues(responses: GoalEngineResponse[]): Set<number> {
  const allowed = new Set<number>();
  const admitMoney = (cents: number) => {
    if (cents % 100 === 0) allowed.add(cents / 100); // solo soles enteros exactos
  };
  const admitDate = (iso: string) => {
    const [y, , d] = iso.split('-');
    allowed.add(Number(d));
    allowed.add(Number(y));
  };
  for (const response of responses) {
    switch (response.kind) {
      case 'plan':
        admitMoney(response.requiredContribution);
        admitMoney(response.finalInstallment);
        allowed.add(response.installments);
        admitDate(response.completionDate);
        break;
      case 'projection':
        admitDate(response.completionDate);
        allowed.add(response.installments);
        admitMoney(response.finalContribution);
        admitMoney(response.totalContributed);
        break;
      case 'feasibility':
        admitMoney(response.projectedAmount);
        admitMoney(response.shortfall);
        admitMoney(response.surplus);
        break;
      case 'error':
        break;
    }
  }
  return allowed;
}

// ── Números en palabras (cardinales en español) ───────────────────────

const UNITS: Record<string, number> = {
  uno: 1, un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9,
};
const TEENS: Record<string, number> = {
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
  dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
};
const TWENTIES: Record<string, number> = {
  veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22,
  veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26,
  veintisiete: 27, veintiocho: 28, veintinueve: 29,
};
const TENS: Record<string, number> = {
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60,
  setenta: 70, ochenta: 80, noventa: 90,
};
const HUNDREDS: Record<string, number> = {
  cien: 100, ciento: 100,
  doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300,
  cuatrocientos: 400, cuatrocientas: 400, quinientos: 500, quinientas: 500,
  seiscientos: 600, seiscientas: 600, setecientos: 700, setecientas: 700,
  ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900,
};
const MULTIPLIERS: Record<string, number> = { mil: 1000, millon: 1_000_000, millones: 1_000_000 };

const isNumberWord = (w: string): boolean =>
  w in UNITS || w in TEENS || w in TWENTIES || w in TENS || w in HUNDREDS || w in MULTIPLIERS;

const deaccent = (s: string): string =>
  s.toLowerCase().replace(/[áéíóúü]/g, (c) => ({ á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u' })[c]!);

/** "mil trescientos" → 1300 · "cincuenta y cuatro" → 54 · "doscientas mil" → 200000 */
function cardinalValue(words: string[]): number {
  let total = 0;
  let current = 0;
  for (const word of words) {
    if (word === 'y') continue;
    if (word in MULTIPLIERS) {
      total += (current || 1) * MULTIPLIERS[word];
      current = 0;
    } else if (word === 'cien' || word === 'ciento') {
      current = (current || 1) * 100;
    } else {
      current += UNITS[word] ?? TEENS[word] ?? TWENTIES[word] ?? TENS[word] ?? HUNDREDS[word] ?? 0;
    }
  }
  return total + current;
}

export interface WordNumber {
  text: string;
  value: number;
  percent: boolean;
}

/**
 * Encuentra secuencias de palabras-número. "y" solo une decena con unidad
 * ("treinta y uno"); "entre cien y doscientos" se parte en dos números.
 * "un/una/uno" sueltos se ignoran (son artículos, no cifras).
 */
export function wordNumbers(text: string): WordNumber[] {
  const tokens = deaccent(text).match(/[a-zñ]+/g) ?? [];
  const found: WordNumber[] = [];
  let i = 0;
  while (i < tokens.length) {
    if (!isNumberWord(tokens[i])) {
      i++;
      continue;
    }
    const run: string[] = [tokens[i]];
    let j = i + 1;
    while (j < tokens.length) {
      if (isNumberWord(tokens[j])) {
        run.push(tokens[j]);
        j++;
      } else if (
        tokens[j] === 'y' &&
        tokens[j - 1] in TENS &&
        j + 1 < tokens.length &&
        tokens[j + 1] in UNITS
      ) {
        run.push('y', tokens[j + 1]);
        j += 2;
      } else {
        break;
      }
    }
    const onlyArticles = run.every((w) => w === 'un' || w === 'una' || w === 'uno');
    if (!onlyArticles) {
      const percent =
        (tokens[j] === 'por' && tokens[j + 1] === 'ciento') || tokens[j] === 'porciento';
      found.push({ text: run.join(' '), value: cardinalValue(run), percent });
    }
    i = j;
  }
  return found;
}

// ── Porcentajes y rangos con dígitos ──────────────────────────────────

const PERCENT_DIGIT_RE = /\d+(?:[.,]\d+)?\s*(?:%|por\s+ciento|porciento)/gi;

const RANGE_RES = [
  /(?:\bentre\b|\bde\b)\s+(\d[\d.,]*)\s+(?:\by\b|\ba\b)\s+(\d[\d.,]*)/gi,
  /(\d[\d.,]*)\s*[-–—]\s*(\d[\d.,]*)/g,
];

// ── Verificador principal ─────────────────────────────────────────────

export function findLeaks(
  text: string,
  opts: { responses: GoalEngineResponse[]; goalName?: string; currency: Currency },
): Leak[] {
  const allowedTokens = authorizedTokens(opts.responses, opts.goalName ?? '', opts.currency);
  const allowedValues = authorizedValues(opts.responses);
  const leaks: Leak[] = [];
  const seen = new Set<string>();
  const push = (leak: Leak) => {
    const key = `${leak.kind}:${leak.token}`;
    if (!seen.has(key)) {
      seen.add(key);
      leaks.push(leak);
    }
  };

  for (const token of numericTokens(text)) {
    if (!allowedTokens.has(token)) push({ kind: 'digits', token });
  }

  for (const match of text.matchAll(PERCENT_DIGIT_RE)) {
    push({ kind: 'percent', token: match[0].trim() }); // el motor nunca emite porcentajes
  }

  for (const word of wordNumbers(text)) {
    if (word.percent) push({ kind: 'percent', token: `${word.text} por ciento` });
    else if (!allowedValues.has(word.value)) push({ kind: 'words', token: word.text });
  }

  for (const rangeRe of RANGE_RES) {
    for (const match of text.matchAll(rangeRe)) {
      const [, from, to] = match;
      if (!allowedTokens.has(from) || !allowedTokens.has(to)) {
        push({ kind: 'range', token: match[0].trim() });
      }
    }
  }

  return leaks;
}
