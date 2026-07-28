// Interfaz de la capa LLM. El contrato aquí garantiza CLAUDE.md §3:
// hacia adentro, el LLM solo transcribe literales del usuario; hacia afuera,
// solo produce texto con placeholders — nunca ve ni escribe cifras del motor.

import type { ISODate } from 'goal-engine';

/**
 * Lo que el LLM extrae del lenguaje natural. Los importes son strings
 * VERBATIM de lo que dijo el usuario ("1.200", "300 euros"); la conversión
 * a céntimos la hace código determinista (parse.ts), jamás el modelo.
 */
export interface RawExtraction {
  query: 'plan' | 'projection' | 'feasibility';
  goalName: string;
  targetAmount: string;
  currentAmount?: string;
  targetDate?: ISODate;
  contribution?: {
    amount: string;
    frequency: 'weekly' | 'biweekly' | 'monthly';
    startDate?: ISODate;
  };
}

export type ExtractionResult =
  | { kind: 'extraction'; extraction: RawExtraction }
  | { kind: 'clarification'; question: string };

/**
 * Contexto de narración: deliberadamente SIN valores. El LLM conoce el tipo
 * de resultado y los nombres de los placeholders disponibles; las cifras
 * nunca entran a su contexto, así no puede copiarlas ni inventarlas.
 */
export interface NarrationContext {
  resultKind: 'plan' | 'projection' | 'feasibility' | 'error';
  goalName: string;
  placeholders: string[];
  feasible?: boolean;
  errorCode?: string;
}

export interface LlmClient {
  extract(utterance: string): Promise<ExtractionResult>;
  /** Devuelve texto con {{placeholder}}; prohibido escribir dígitos. */
  narrate(context: NarrationContext): Promise<string>;
}
