import * as vscode from 'vscode';

export function relativeFilePath(uri: vscode.Uri): string {
  const folders = vscode.workspace.workspaceFolders;
  if (folders) {
    for (const folder of folders) {
      if (uri.fsPath.startsWith(folder.uri.fsPath)) {
        return uri.fsPath.slice(folder.uri.fsPath.length + 1);
      }
    }
  }
  return uri.fsPath.split('/').pop() ?? uri.fsPath;
}
