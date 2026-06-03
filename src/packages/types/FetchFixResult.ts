import * as vscode from 'vscode';
import { PendingFix } from './PendingFix';

export interface FetchFixesResult {
  edits: vscode.TextEdit[];
  pending: PendingFix[];
}
