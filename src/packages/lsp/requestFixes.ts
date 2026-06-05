import * as vscode from 'vscode';
import { extractEdits } from './extractEdits';
import { buildPendingFix } from './buildPendingFix';
import { logPendingFix } from './logPendingFix';
import { mergeEdits } from './mergeEdits';
import { isClangTidyQuickfix } from './isClangTidyQuickfix';
import {
  ClangdClient,
  FetchFixesResult,
  LspCodeAction,
  PendingFix,
  LspTextEdit,
} from '@clang-tidy/types';

export async function requestFixes(
  client: ClangdClient,
  params: unknown,
  doc: vscode.TextDocument,
  checksFilter: string[],
): Promise<FetchFixesResult> {
  let actions: LspCodeAction[];

  try {
    actions = await client.sendRequest<LspCodeAction[]>('textDocument/codeAction', params);
  } catch (err) {
    return { edits: [], pending: [] };
  }

  if (!Array.isArray(actions)) {
    return { edits: [], pending: [] };
  }

  actions.forEach((action) => {
    if (action.kind === 'quickfix' && (!action.diagnostics || action.diagnostics.length === 0)) {
      action.diagnostics = [
        {
          source: 'clang-tidy',
          code: 'readability-identifier-naming',
          message: action.title,
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          severity: 3,
        },
      ];
    }
  });

  const matching = actions.filter((a) => isClangTidyQuickfix(a, checksFilter));

  const pendingFixes: PendingFix[] = [];
  const allLspEdits: LspTextEdit[] = [];

  for (const action of matching) {
    let resolvedEdit = action.edit;

    // --- NEW: HANDLE CLANGD RENAME COMMAND ---
    if (
      !resolvedEdit &&
      action.command?.command === 'clangd.applyRename' &&
      action.command.arguments?.[0]
    ) {
      const renameArg = action.command.arguments[0];
      try {
        // Ask clangd to compute the file-wide text edits for this rename
        resolvedEdit = await client.sendRequest<any>('textDocument/rename', {
          textDocument: renameArg.textDocument,
          position: renameArg.position,
          newName: renameArg.newName,
        });
      } catch (err) {
        continue; // If rename calculation fails, skip it
      }
    }

    // Fallback for any other commands that might have the edit nested directly
    if (!resolvedEdit && action.command?.arguments?.length) {
      const arg = action.command.arguments[0];
      if (arg && (arg.changes || arg.documentChanges)) {
        resolvedEdit = arg;
      }
    }

    if (!resolvedEdit) continue;

    // Pass the resolved WorkspaceEdit to extractEdits
    const lspEdits = extractEdits(resolvedEdit, doc.uri.toString());
    if (lspEdits.length === 0) continue;

    const pendingFix = buildPendingFix(action, lspEdits, doc);
    logPendingFix(pendingFix);
    pendingFixes.push(pendingFix);
    allLspEdits.push(...lspEdits);
  }

  return {
    edits: mergeEdits(allLspEdits),
    pending: pendingFixes,
  };
}
