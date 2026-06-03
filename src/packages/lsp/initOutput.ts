import * as vscode from 'vscode';

// Single output channel shared across all modules.
// Initialized by extension.ts on activate().
// All other modules import { output } from './logger' — never from './extension'.

export let output: vscode.OutputChannel;

export function initOutput(channel: vscode.OutputChannel): void {
  output = channel;
}
