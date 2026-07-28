import { describe, expect, it } from 'vitest';
import type { GoalEngineResponse } from 'goal-engine';
import { findLeaks, wordNumbers } from './figures-guard.js';

// Respuesta sintética de referencia: S/ 1,300.00 al mes, 3 aportes,
// termina el 1 de julio de 2027. Valores autorizados en palabras: 1300
// (soles enteros), 3 (aportes), 1 y 2027 (fecha).
const plan: GoalEngineResponse = {
  kind: 'plan',
  requiredContribution: 130000,
  installments: 3,
  finalInstallment: 130000,
  completionDate: '2027-07-01',
};

const opts = { responses: [plan], goalName: 'Viaje', currency: 'PEN' } as const;

describe('figures-guard: números en palabras', () => {
  it('parsea cardinales compuestos', () => {
    expect(wordNumbers('mil trescientos soles')[0]).toMatchObject({ value: 1300 });
    expect(wordNumbers('cincuenta y cuatro')[0]).toMatchObject({ value: 54 });
    expect(wordNumbers('doscientas mil personas')[0]).toMatchObject({ value: 200000 });
    expect(wordNumbers('ciento veinte')[0]).toMatchObject({ value: 120 });
    expect(wordNumbers('veintiún aportes')[0]).toMatchObject({ value: 21 });
  });

  it('"un/una" sueltos son artículos, no cifras', () => {
    expect(wordNumbers('un aporte más y una nueva fecha')).toEqual([]);
    expect(wordNumbers('treinta y uno')[0]).toMatchObject({ value: 31 }); // en compuesto sí cuenta
  });

  it('"entre cien y doscientos" son dos números, no 300', () => {
    const found = wordNumbers('entre cien y doscientos soles');
    expect(found.map((w) => w.value)).toEqual([100, 200]);
  });

  it('valor respaldado por el motor → no fuga', () => {
    expect(findLeaks('Serán tres aportes de mil trescientos soles.', opts)).toEqual([]);
  });

  it('valor sin respaldo → fuga', () => {
    expect(findLeaks('Con unos cuatro meses te alcanza.', opts)).toEqual([
      { kind: 'words', token: 'cuatro' },
    ]);
    expect(findLeaks('Necesitás mil cuatrocientos soles.', opts)).toEqual([
      { kind: 'words', token: 'mil cuatrocientos' },
    ]);
  });

  it('monto con céntimos no respalda su parte entera en palabras', () => {
    const rounded: GoalEngineResponse = { ...plan, requiredContribution: 136364 }; // S/ 1,363.64
    const leaks = findLeaks('unos mil trescientos sesenta y tres soles', {
      ...opts,
      responses: [rounded],
    });
    expect(leaks).toContainEqual({ kind: 'words', token: 'mil trescientos sesenta y tres' });
  });
});

describe('figures-guard: porcentajes (el motor nunca los emite)', () => {
  it.each([
    ['ahorrá el 15% de tu sueldo', '15%'],
    ['ahorrá el 15 por ciento de tu sueldo', '15 por ciento'],
    ['ahorrá el quince por ciento de tu sueldo', 'quince por ciento'],
  ])('"%s" → fuga percent', (text, token) => {
    expect(findLeaks(text, opts)).toContainEqual({ kind: 'percent', token });
  });

  it('un porcentaje fuga aunque su número esté respaldado', () => {
    // 3 = installments está autorizado como conteo, pero "3%" jamás.
    expect(findLeaks('subió un 3%', opts)).toContainEqual({ kind: 'percent', token: '3%' });
  });
});

describe('figures-guard: rangos', () => {
  it.each([
    ['aportá entre 100 y 200 soles', 'entre 100 y 200'],
    ['aportá de 100 a 200 soles', 'de 100 a 200'],
    ['aportá 100-200 soles', '100-200'],
  ])('"%s" → fuga range', (text, token) => {
    expect(findLeaks(text, opts)).toContainEqual({ kind: 'range', token });
  });

  it('rango en palabras: cada extremo se valida por separado', () => {
    const leaks = findLeaks('entre cien y doscientos soles', opts);
    expect(leaks).toContainEqual({ kind: 'words', token: 'cien' });
    expect(leaks).toContainEqual({ kind: 'words', token: 'doscientos' });
  });
});

describe('figures-guard: autorizaciones', () => {
  it('las cifras renderizadas del motor no fugan', () => {
    expect(
      findLeaks('Aportá S/ 1,300.00 por mes: 3 aportes, terminando el 1 de julio de 2027.', opts),
    ).toEqual([]);
  });

  it('dígitos en el nombre de la meta son dato de origen', () => {
    const leaks = findLeaks('Tu meta Casa 2030 va en camino.', {
      ...opts,
      goalName: 'Casa 2030',
    });
    expect(leaks).toEqual([]);
  });

  it('sin respuestas del motor, todo dígito fuga', () => {
    expect(findLeaks('Serían 250 soles.', { responses: [], currency: 'PEN' })).toEqual([
      { kind: 'digits', token: '250' },
    ]);
  });
});
