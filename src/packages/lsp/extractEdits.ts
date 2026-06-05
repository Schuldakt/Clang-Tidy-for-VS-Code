import * as vscode from 'vscode';
import { LspTextEdit } from '@clang-tidy/types';

// Changed signature to accept the WorkspaceEdit object directly
export function extractEdits(edit: any, docUri: string): LspTextEdit[] {
  if (!edit) return [];

  const targetFsPath = vscode.Uri.parse(docUri).fsPath;

  if (edit.documentChanges) {
    return edit.documentChanges
      .filter(
        (c: any) => c.textDocument && vscode.Uri.parse(c.textDocument.uri).fsPath === targetFsPath,
      )
      .flatMap((c: any) => c.edits || []);
  }

  if (edit.changes) {
    for (const [uri, edits] of Object.entries(edit.changes)) {
      if (vscode.Uri.parse(uri).fsPath === targetFsPath) {
        return edits as LspTextEdit[];
      }
    }
  }

  return [];
}
