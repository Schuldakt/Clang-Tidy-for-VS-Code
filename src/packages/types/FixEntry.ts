export interface FixEntry {
  id: string;
  checkName: string;
  filePath: string;
  relPath: string;
  line: number; // 1-based start line of the fix
  endLine: number; // 1-based end line of the fix (for fingerprint checking)
  before: string;
  after: string;
  timestamp: number;
  /** True when this entry represents a dismissed (NOLINT'd) fix rather than an applied one. */
  dismissed?: boolean;
  /**
   * How to revert the NOLINT insertion so the undo button can work on dismissed entries.
   * `isNewLine` = true  → a NOLINTNEXTLINE comment was inserted as a new line; undo deletes that line.
   * `isNewLine` = false → an existing NOLINT() comment was extended inline; undo restores the original line.
   */
  nolintRevert?: { line: number; isNewLine: boolean; before: string };
}
