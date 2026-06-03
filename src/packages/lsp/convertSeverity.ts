import * as vscode from 'vscode';

export function convertSeverity(severity: vscode.DiagnosticSeverity | undefined): number {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return 1;
    case vscode.DiagnosticSeverity.Warning:
      return 2;
    case vscode.DiagnosticSeverity.Information:
      return 3;
    case vscode.DiagnosticSeverity.Hint:
      return 4;
    default:
      return 3;
  }
}
