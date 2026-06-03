import { LspTextEdit } from '@clang-tidy/types';

export function applyEditsToText(
  originalText: string,
  edits: LspTextEdit[],
  baseLineOffset: number,
): string {
  const lines = originalText.split('\n');

  const lineOffsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }

  let buffer = originalText;

  const sorted = [...edits].sort((a, b) => {
    if (a.range.start.line !== b.range.start.line) return b.range.start.line - a.range.start.line;
    return b.range.start.character - a.range.start.character;
  });

  for (const edit of sorted) {
    const startLine = edit.range.start.line - baseLineOffset;
    const endLine = edit.range.end.line - baseLineOffset;

    if (startLine < 0 || startLine >= lineOffsets.length) continue;

    const startOffset = lineOffsets[startLine] + edit.range.start.character;
    const endOffset = Math.min(
      (lineOffsets[endLine] ?? buffer.length) + edit.range.end.character,
      buffer.length,
    );

    buffer = buffer.slice(0, startOffset) + edit.newText + buffer.slice(endOffset);
  }

  return buffer;
}
