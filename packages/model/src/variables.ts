import type { Variable } from './types';

/** Python keywords and the names the formula sandbox already uses. */
const RESERVED = new Set([
  'False',
  'None',
  'True',
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'try',
  'while',
  'with',
  'yield',
  'abs',
  'all',
  'any',
  'float',
  'int',
  'len',
  'math',
  'max',
  'min',
  'round',
  'str',
  'sum',
]);

export type VariableNameProblem = 'EMPTY' | 'INVALID' | 'RESERVED';

const IDENTIFIER = /^[\p{L}_][\p{L}\p{N}_]*$/u;

/** Python 3 accepts Cyrillic identifiers, so the UI does too. */
export function variableNameProblem(name: string): VariableNameProblem | null {
  const trimmed = name.trim();
  if (!trimmed) return 'EMPTY';
  if (!IDENTIFIER.test(trimmed)) return 'INVALID';
  if (RESERVED.has(trimmed)) return 'RESERVED';
  return null;
}

export function variableSourceProblem(variable: Pick<Variable, 'type' | 'source'>): string | null {
  if (variable.type === 'number' && variable.source.trim() === '') {
    return 'A number variable needs a value or a formula';
  }
  return null;
}

/** A name unique among the project variables; suffix counts from 2. */
export function uniqueVariableName(taken: Iterable<string>, base = 'var'): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let index = 2; ; index += 1) {
    const candidate = `${base}${index}`;
    if (!used.has(candidate)) return candidate;
  }
}
