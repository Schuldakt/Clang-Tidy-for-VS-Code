import * as vscode from 'vscode';
import { buildDiagnosticsContext } from './buildDiagnosticsContext';
import { withTimeout } from './withTimeout';
import { requestFixes } from './requestFixes';
import { ClangdClient, FetchFixesResult } from '@clang-tidy/types';

export async function fetchFixes(
  client: ClangdClient,
  doc: vscode.TextDocument,
  timeoutMs: number,
  checksFilter: string[],
): Promise<FetchFixesResult> {
  const params = {
    textDocument: { uri: doc.uri.toString() },
    range: {
      start: { line: 0, character: 0 },
      end: { line: Math.max(0, doc.lineCount - 1), character: 0 },
    },
    context: {
      diagnostics: buildDiagnosticsContext(doc),
      only: ['quickfix'],
    },
  };

  return withTimeout(requestFixes(client, params, doc, checksFilter), timeoutMs, {
    edits: [],
    pending: [],
  });
}
