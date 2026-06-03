import { PendingFix } from '@clang-tidy/types';
import { output } from './initOutput';

const SEPARATOR = '─'.repeat(60);

export function logPendingFix(fix: PendingFix): void {
  output.appendLine('');
  output.appendLine(`⚑ ${fix.checkName}`);
  output.appendLine(`  @ ${fix.relPath}:${fix.line}`);
  for (const line of fix.before.split('\n')) output.appendLine(`  - ${line}`);
  for (const line of fix.after.split('\n')) output.appendLine(`  + ${line}`);
  output.appendLine(SEPARATOR);
}
