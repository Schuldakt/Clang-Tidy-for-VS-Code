import { LspRange } from './LspRange';

export interface LspDiagnostic {
  range: LspRange;
  message: string;
  severity?: number;
  source?: string;
  code?: string | number;
}
