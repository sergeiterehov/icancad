import type { ExpressionDiagnostic } from '@icancad/formula';
import type { TFunction } from 'i18next';

/** Turns a diagnostic code into a localised line, keeping the engine text as a fallback. */
export function formulaMessage(
  t: TFunction,
  diagnostic: ExpressionDiagnostic | undefined,
): string | undefined {
  if (!diagnostic) return undefined;
  return t(
    `formula.errors.${diagnostic.code}` as never,
    {
      ...diagnostic.args,
      message: diagnostic.message,
      defaultValue: diagnostic.message,
    } as never,
  ) as unknown as string;
}
