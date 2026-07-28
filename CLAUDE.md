# CLAUDE.md — Reglas de arquitectura del proyecto

Este documento define reglas **no negociables** para todo el código de este repositorio.
Cualquier cambio (humano o generado por IA) debe cumplirlas. Ante la duda, la regla gana.

## 1. Qué es este proyecto

Un **neobanco** cuyo diferencial es un **motor de metas financieras**: el usuario define
objetivos de ahorro/gasto y el sistema calcula planes, proyecciones y progreso. Hay un
asistente conversacional (LLM) como capa de interacción, pero **el corazón del producto
es el motor de cálculo, no el LLM**.

## 2. Separación estricta de packages

### `packages/goal-engine` — matemática pura
- Contiene **toda** la aritmética financiera: proyecciones, cuotas, intereses, progreso
  de metas, redondeos, distribución de aportes.
- Debe ser **determinista y puro**: mismas entradas → mismas salidas, siempre.
- **Prohibido**: acceso a red, I/O, llamadas a LLMs, dependencias sobre `packages/assistant`,
  relojes implícitos (la fecha/hora entra siempre como parámetro).
- Debe poder testearse de forma exhaustiva con tests unitarios sin mocks de red.

### `packages/assistant` — capa LLM
- Contiene la integración con el LLM: prompts, orquestación, herramientas, conversación.
- **Prohibido**: realizar aritmética financiera. No suma, no resta, no calcula porcentajes,
  cuotas ni proyecciones — ni en código propio ni delegándoselo al modelo.
- Cuando necesita una cifra, **invoca a `goal-engine`** (o a una API que lo envuelva) y usa
  el resultado de forma opaca: lo transporta, no lo transforma.
- La dependencia es unidireccional: `assistant` → `goal-engine`. **Nunca al revés.**

## 3. Ninguna cifra mostrada al usuario puede originarse en un LLM

- Todo número que el usuario ve (saldos, proyecciones, cuotas, porcentajes, fechas de
  cumplimiento de meta) debe ser **trazable a `goal-engine`** o a datos de origen
  (transacciones, saldos de cuenta).
- El LLM puede **referirse** a cifras que recibe ya calculadas, pero la UI nunca debe
  renderizar un número que el modelo haya generado, estimado, redondeado o reformateado.
- Patrón obligatorio: el LLM produce texto con *placeholders* o referencias a valores
  calculados; la capa de presentación inserta las cifras reales desde la fuente confiable.
- Si una respuesta del LLM contiene un número financiero que no proviene de una fuente
  calculada, se descarta o se filtra antes de mostrarse.

## 4. El dinero es un entero en céntimos

- Todo importe monetario se representa como **entero de céntimos** (ej.: `10,50 €` = `1050`).
- **Prohibido `float`/`double` para dinero** en cualquier capa: dominio, API, base de datos,
  serialización y UI-estado. Sin excepciones.
- Las divisiones (cuotas, prorrateos) deben definir explícitamente su política de redondeo
  y garantizar que la suma de las partes iguala el total (sin céntimos perdidos ni creados).
- El formateo a moneda legible (`1050` → `"10,50 €"`) ocurre **solo** en el borde de
  presentación, nunca antes.

## 5. Contrato de tipos: `assistant` ↔ `goal-engine`

Este es el contrato completo entre los dos packages. Solo tipos, sin implementación;
cualquier cambio al contrato se acuerda primero en este documento.

```typescript
// ═══ Tipos base compartidos por el contrato ═══════════════════════════

/** Dinero: entero en céntimos (10,50 € → 1050). Nunca float. */
type Cents = number;

/** Fecha civil ISO-8601 sin hora: "2026-07-28". */
type ISODate = string;

/** Código de moneda ISO 4217: "EUR". */
type Currency = string;


// ═══ INPUT: assistant → goal-engine ═══════════════════════════════════
// El assistant extrae esto del lenguaje natural del usuario. Todo número
// presente aquí debe ser transcripción literal de lo que el usuario dijo;
// el LLM jamás deriva, convierte ni calcula un valor.

interface GoalEngineRequest {
  query: GoalQuery;      // qué pregunta debe resolver el motor
  goal: GoalInput;       // la meta tal como la describió el usuario
  asOf: ISODate;         // el "hoy": el motor no tiene reloj propio, la fecha siempre entra como parámetro
  currency: Currency;    // moneda de todos los importes del request
}

/** Una pregunta por llamada. Unión discriminada. */
type GoalQuery =
  | { kind: 'plan' }         // dado goal.targetDate → ¿qué aporte periódico necesito?
  | { kind: 'projection' }   // dado goal.contribution → ¿cuándo alcanzo la meta?
  | { kind: 'feasibility' }; // dados ambos → ¿llego a tiempo? ¿cuánto falta o sobra?

interface GoalInput {
  name: string;                     // etiqueta legible de la meta, ej. "Viaje a Japón"
  targetAmount: Cents;              // monto objetivo que dijo el usuario
  currentAmount: Cents;             // lo ya ahorrado hacia esta meta (0 si arranca de cero)
  targetDate?: ISODate;             // fecha límite — requerida si query es 'plan' o 'feasibility'
  contribution?: ContributionInput; // aporte periódico — requerido si query es 'projection' o 'feasibility'
}

interface ContributionInput {
  amount: Cents;                              // importe de cada aporte
  frequency: 'weekly' | 'biweekly' | 'monthly';
  startDate?: ISODate;                        // primer aporte; si se omite, el motor usa asOf
}


// ═══ OUTPUT: goal-engine → assistant ══════════════════════════════════
// Única fuente válida de cifras mostradas al usuario. El assistant
// transporta estos valores de forma opaca (por referencia/placeholder);
// la capa de presentación los formatea. El LLM nunca los reescribe.

type GoalEngineResponse =
  | PlanResult
  | ProjectionResult
  | FeasibilityResult
  | EngineError;

interface PlanResult {
  kind: 'plan';
  requiredContribution: Cents; // aporte por período necesario para llegar a targetDate
  installments: number;        // cantidad total de aportes hasta la meta
  finalInstallment: Cents;     // último aporte, ajustado por redondeo: la suma cierra exacta con targetAmount
  completionDate: ISODate;     // fecha del último aporte
}

interface ProjectionResult {
  kind: 'projection';
  completionDate: ISODate;     // fecha en la que se alcanza targetAmount con el aporte dado
  installments: number;        // cantidad de aportes hasta ese momento
  finalContribution: Cents;    // último aporte, recortado para no exceder la meta
  totalContributed: Cents;     // suma total aportada al completar (cierra exacta: currentAmount + aportes = targetAmount)
}

interface FeasibilityResult {
  kind: 'feasibility';
  feasible: boolean;           // ¿se alcanza targetAmount en o antes de targetDate?
  projectedAmount: Cents;      // cuánto habrá acumulado en targetDate con el plan dado
  shortfall: Cents;            // cuánto falta en targetDate (0 si feasible)
  surplus: Cents;              // cuánto sobra al llegar antes (0 si no llega o llega justo)
}

interface EngineError {
  kind: 'error';
  code:
    | 'TARGET_IN_PAST'         // targetDate anterior a asOf
    | 'MISSING_TARGET_DATE'    // query 'plan'/'feasibility' sin goal.targetDate
    | 'MISSING_CONTRIBUTION'   // query 'projection'/'feasibility' sin goal.contribution
    | 'NON_POSITIVE_AMOUNT'    // targetAmount ≤ 0, contribution.amount ≤ 0, o currentAmount < 0
    | 'ALREADY_REACHED';       // currentAmount ≥ targetAmount: no hay nada que calcular
  message: string;             // texto técnico para logs; el assistant redacta la explicación al usuario sin inventar cifras
}
```

## 6. Regla general

Si un cambio necesita violar alguna de estas reglas, no se hace: primero se discute y se
actualiza este documento de forma explícita.
