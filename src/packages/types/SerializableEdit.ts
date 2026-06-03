export interface SerializableEdit {
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
  newText: string;
}
