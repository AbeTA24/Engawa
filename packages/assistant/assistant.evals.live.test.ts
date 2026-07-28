import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { evaluateGoal, type GoalEngineResponse } from 'goal-engine';
import { AnthropicLlmClient, Assistant, type ExtractionResult, type LlmClient } from './src/index.js';
import { CASES } from './evals/cases.js';
import { findLeaks, type Leak } from './evals/figures-guard.js';

// ─────────────────────────────────────────────────────────────────────
// Evals EN VIVO: los mismos 15 casos contra el LLM real (extracción y
// narración), motor real espiado. Excluidos del CI por defecto:
//
//   LIVE_EVALS=1 npm run test:evals:live
//
// Config por entorno:
//   EVAL_RUNS           corridas por caso (default 5)
//   EVAL_MODEL          modelo (default claude-opus-5)
//   EVAL_MAX_LEAK_RATE  tasa de fugas tolerada por caso (default 0)
//
// La verificación es auto-consistente por corrida: sea lo que sea que el
// LLM extraiga, toda cifra de la respuesta debe estar respaldada por el
// output del motor de ESA corrida (o el nombre de meta extraído).
// ─────────────────────────────────────────────────────────────────────

const LIVE = process.env.LIVE_EVALS === '1';
const RUNS = Number(process.env.EVAL_RUNS ?? '5');
const MAX_LEAK_RATE = Number(process.env.EVAL_MAX_LEAK_RATE ?? '0');
const MODEL = process.env.EVAL_MODEL ?? 'claude-opus-5';
const PER_CASE_TIMEOUT = 120_000 * RUNS;

interface ReportRow {
  name: string;
  runs: number;
  leakedRuns: number;
  tokens: Set<string>;
}

describe.runIf(LIVE)(`evals en vivo contra ${MODEL} (${RUNS} corridas por caso)`, () => {
  const report: ReportRow[] = [];

  beforeAll(() => {
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      throw new Error('LIVE_EVALS=1 requiere ANTHROPIC_API_KEY (o ANTHROPIC_AUTH_TOKEN) en el entorno.');
    }
  });

  afterAll(() => {
    const width = Math.max(...report.map((r) => r.name.length), 4);
    const lines = [
      '',
      `── Reporte de evals en vivo · modelo ${MODEL} · ${RUNS} corridas por caso ──`,
      `${'caso'.padEnd(width)}  corridas  fugas  tasa   tokens fugados`,
      ...report.map((r) => {
        const rate = `${Math.round((r.leakedRuns / r.runs) * 100)}%`;
        const tokens = r.tokens.size === 0 ? '—' : [...r.tokens].slice(0, 6).join(', ');
        return `${r.name.padEnd(width)}  ${String(r.runs).padStart(8)}  ${String(r.leakedRuns).padStart(5)}  ${rate.padStart(4)}   ${tokens}`;
      }),
      '',
    ];
    console.log(lines.join('\n'));
  });

  it.each(CASES)(
    '$name',
    async (evalCase) => {
      const real = new AnthropicLlmClient({ model: MODEL });
      const row: ReportRow = { name: evalCase.name, runs: RUNS, leakedRuns: 0, tokens: new Set() };
      const failures: string[] = [];

      for (let run = 0; run < RUNS; run++) {
        // Grabamos la extracción real para conocer el goalName de esta corrida.
        let lastExtraction: ExtractionResult | undefined;
        const llm: LlmClient = {
          extract: async (utterance, asOf) => (lastExtraction = await real.extract(utterance, asOf)),
          narrate: (context) => real.narrate(context),
        };
        const engine = vi.fn(evaluateGoal);
        const assistant = new Assistant({ llm, engine });

        const { text } = await assistant.handle(evalCase.utterance, evalCase.asOf);

        const responses = engine.mock.results.map((r) => r.value as GoalEngineResponse);
        const goalName =
          lastExtraction?.kind === 'extraction' ? lastExtraction.extraction.goalName : '';
        const leaks: Leak[] = findLeaks(text, { responses, goalName, currency: 'PEN' });
        if (leaks.length > 0) {
          row.leakedRuns++;
          for (const leak of leaks) row.tokens.add(`${leak.token} (${leak.kind})`);
          failures.push(`corrida ${run + 1}: ${JSON.stringify(leaks)} en "${text}"`);
        }
      }

      report.push(row);
      const leakRate = row.leakedRuns / RUNS;
      expect(
        leakRate,
        `tasa de fugas ${row.leakedRuns}/${RUNS} supera el máximo ${MAX_LEAK_RATE}:\n${failures.join('\n')}`,
      ).toBeLessThanOrEqual(MAX_LEAK_RATE);
    },
    PER_CASE_TIMEOUT,
  );
});
