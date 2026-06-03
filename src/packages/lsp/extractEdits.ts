import * as vscode from 'vscode';
import { LspCodeAction, LspTextEdit } from '@clang-tidy/types';

export function extractEdits(action: LspCodeAction, docUri: string): LspTextEdit[] {
  const edit = action.edit;
  if (!edit) return [];

  // Parse the target URI once to compare filesystem paths safely
  const targetFsPath = vscode.Uri.parse(docUri).fsPath;

  if (edit.documentChanges) {
    return edit.documentChanges
      .filter((c) => vscode.Uri.parse(c.textDocument.uri).fsPath === targetFsPath)
      .flatMap((c) => c.edits);
  }

  if (edit.changes) {
    for (const [uri, edits] of Object.entries(edit.changes)) {
      if (vscode.Uri.parse(uri).fsPath === targetFsPath) {
        return edits;
      }
    }
  }

  return [];
}
