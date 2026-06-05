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
  const lastLineIndex = Math.max(0, doc.lineCount - 1);
  const lastLineLength = doc.lineAt(lastLineIndex).text.length;

  const params = {
    textDocument: { uri: doc.uri.toString() },
    range: {
      start: { line: 0, character: 0 },
      end: { line: lastLineIndex, character: lastLineLength },
    },
    context: {
      diagnostics: buildDiagnosticsContext(doc),
    },
  };

  return withTimeout(requestFixes(client, params, doc, checksFilter), timeoutMs, {
    edits: [],
    pending: [],
  });
}
