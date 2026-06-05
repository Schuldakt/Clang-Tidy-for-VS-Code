import { LspDiagnostic } from './LspDiagnostic';
import { LspTextEdit } from './LspTextEdit';

export interface LspCodeAction {
  title: string;
  kind?: string;
  diagnostics?: LspDiagnostic[];
  edit?: {
    changes?: Record<string, LspTextEdit[]>;
    documentChanges?: Array<{
      textDocument: { uri: string };
      edits: LspTextEdit[];
    }>;
  };
  command?: {
    title: string;
    command: string;
    arguments?: any[];
  };
}
