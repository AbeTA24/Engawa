import { describe, expect, it, vi } from 'vitest';
import { evaluateGoal, type GoalEngineResponse } from 'goal-engine';
import { Assistant, type LlmClient } from './src/index.js';
import { CASES, type EvalCase } from './evals/cases.js';
import { findLeaks } from './evals/figures-guard.js';

// ─────────────────────────────────────────────────────────────────────
// Evals guionados (corren siempre, en CI): los 15 casos con LLM guionado
// contra el motor real. El verificador (evals/figures-guard.ts) espía la
// llamada al motor y falla ante cualquier cifra sin respaldo exacto —
// dígitos, números en palabras, porcentajes o rangos. La variante contra
// el LLM real vive en assistant.evals.live.test.ts (LIVE_EVALS=1).
// ─────────────────────────────────────────────────────────────────────

function scriptedLlm(evalCase: EvalCase): LlmClient {
  return {
    extract: async () => evalCase.extract,
    narrate: async () => {
      if (evalCase.narrate === undefined) throw new Error('narrador caído');
      return evalCase.narrate;
    },
  };
}

describe('evals: toda cifra de la respuesta tiene respaldo exacto del motor', () => {
  it.each(CASES)('$name', async (evalCase) => {
    const engine = vi.fn(evaluateGoal);
    const assistant = new Assistant({ llm: scriptedLlm(evalCase), engine });

    const { text } = await assistant.handle(evalCase.utterance, evalCase.asOf);

    const responses = engine.mock.results.map((r) => r.value as GoalEngineResponse);
    const goalName =
      evalCase.extract.kind === 'extraction' ? evalCase.extract.extraction.goalName : '';
    const leaks = findLeaks(text, { responses, goalName, currency: 'PEN' });
    expect(
      leaks,
      `cifras sin respaldo del motor: ${JSON.stringify(leaks)} en la respuesta "${text}"`,
    ).toEqual([]);

    for (const expected of evalCase.expectContains ?? []) {
      expect(text).toContain(expected);
    }
    if (evalCase.expectNoDigits) {
      expect(text).not.toMatch(/\d/);
    }
  });
});
