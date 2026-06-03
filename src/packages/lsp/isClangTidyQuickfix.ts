import { LspCodeAction } from '@clang-tidy/types';

export function isClangTidyQuickfix(action: LspCodeAction, checksFilter: string[]): boolean {
  if (!action.kind?.startsWith('quickfix')) return false;
  if (!action.edit) return false;

  const isFromClangTidy = action.diagnostics?.some((d) => d.source === 'clang-tidy') ?? false;

  if (!isFromClangTidy) {
    return (
      /\[[\w]+-[\w-]+\]/.test(action.title) ||
      /^fix [\w]+-[\w-]+/.test(action.title) ||
      /\bclang-tidy\b/i.test(action.title)
    );
  }

  if (checksFilter.length === 0) return true;

  return (
    action.diagnostics?.some((d) =>
      checksFilter.some((f) => {
        try {
          return new RegExp(f).test(String(d.code));
        } catch {
          return false;
        }
      }),
    ) ?? false
  );
}
