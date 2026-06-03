import * as vscode from 'vscode';
import { nextId } from './_idCounter';
import { applyEditsToText } from './applyEditsToText';
import { relativeFilePath } from './relativeFilePath';
import { LspCodeAction, LspTextEdit, PendingFix, SerializableEdit } from '@clang-tidy/types';

export function buildPendingFix(
  action: LspCodeAction,
  lspEdits: LspTextEdit[],
  doc: vscode.TextDocument,
): PendingFix {
  const checkName = String(action.diagnostics?.[0]?.code ?? action.title);
  const minLine = Math.min(...lspEdits.map((e) => e.range.start.line));
  const maxLine = Math.max(...lspEdits.map((e) => e.range.end.line));

  const originalLines: string[] = [];
  for (let i = minLine; i <= maxLine; i++) {
    if (i < doc.lineCount) originalLines.push(doc.lineAt(i).text);
  }
  const before = originalLines.join('\n').trimEnd();
  const after = applyEditsToText(before, lspEdits, minLine).trimEnd();

  const serializable: SerializableEdit[] = lspEdits.map((e) => ({
    startLine: e.range.start.line,
    startChar: e.range.start.character,
    endLine: e.range.end.line,
    endChar: e.range.end.character,
    newText: e.newText,
  }));

  return {
    id: nextId(),
    checkName,
    filePath: doc.uri.fsPath,
    relPath: relativeFilePath(doc.uri),
    line: minLine + 1,
    before,
    after,
    edits: serializable,
  };
}
