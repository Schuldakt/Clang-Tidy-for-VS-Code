import { LspRange } from './LspRange';

export interface LspTextEdit {
  range: LspRange;
  newText: string;
}
