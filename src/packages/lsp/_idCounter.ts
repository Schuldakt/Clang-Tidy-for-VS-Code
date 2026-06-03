let _idCounter = 0;

export function nextId(): string {
  return `fix-${Date.now()}-${_idCounter++}`;
}
