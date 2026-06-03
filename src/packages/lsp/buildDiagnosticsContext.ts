import * as vscode from 'vscode';
import { convertSeverity } from './convertSeverity';

export function buildDiagnosticsContext(doc: vscode.TextDocument): unknown[] {
  return vscode.languages.getDiagnostics(doc.uri).map((d) => ({
    range: {
      start: { line: d.range.start.line, character: d.range.start.character },
      end: { line: d.range.end.line, character: d.range.end.character },
    },
    message: d.message,
    severity: convertSeverity(d.severity),
    source: d.source,
    code: typeof d.code === 'object' ? d.code.value : d.code,
  }));
}
