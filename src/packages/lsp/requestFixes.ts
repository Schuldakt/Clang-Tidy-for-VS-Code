import * as vscode from 'vscode';
import { extractEdits } from './extractEdits';
import { buildPendingFix } from './buildPendingFix';
import { logPendingFix } from './logPendingFix';
import { mergeEdits } from './mergeEdits';
import { output } from './initOutput';
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
    output.appendLine(`[requestFixes] sendRequest threw: ${err}`);
    return { edits: [], pending: [] };
  }

  if (!Array.isArray(actions)) {
    return { edits: [], pending: [] };
  }

  const matching = actions.filter((a) => isClangTidyQuickfix(a, checksFilter));

  const pendingFixes: PendingFix[] = [];
  const allLspEdits: LspTextEdit[] = [];

  for (const action of matching) {
    const lspEdits = extractEdits(action, doc.uri.toString());
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
