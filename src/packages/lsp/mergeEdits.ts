import * as vscode from 'vscode';
import { LspTextEdit } from '@clang-tidy/types';

export function mergeEdits(lspEdits: LspTextEdit[]): vscode.TextEdit[] {
  const edits = lspEdits.map((e) => ({
    range: new vscode.Range(
      new vscode.Position(e.range.start.line, e.range.start.character),
      new vscode.Position(e.range.end.line, e.range.end.character),
    ),
    newText: e.newText,
  }));

  edits.sort((a, b) => {
    if (a.range.start.line !== b.range.start.line) return b.range.start.line - a.range.start.line;
    return b.range.start.character - a.range.start.character;
  });

  const committed: vscode.Range[] = [];
  const result: vscode.TextEdit[] = [];

  for (const { range, newText } of edits) {
    if (committed.some((c) => c.intersection(range) !== undefined)) continue;
    committed.push(range);
    result.push(vscode.TextEdit.replace(range, newText));
  }

  return result;
}
