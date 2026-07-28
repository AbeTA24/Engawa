import type { GoalEngineRequest, GoalEngineResponse } from './types.js';

export * from './types.js';

// Stub deliberado: los tests definen el comportamiento antes de implementarlo.
export function evaluateGoal(request: GoalEngineRequest): GoalEngineResponse {
  void request;
  throw new Error('goal-engine: not implemented');
}
