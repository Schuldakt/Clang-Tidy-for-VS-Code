import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { FixEntry, PendingFix, SerializableEdit } from '@clang-tidy/types';
import type { ClangTidyEngine } from '@clang-tidy/engine';
import { output } from '@clang-tidy/lsp';

interface ParsedConfig {
  filePath: string;
  /** Path relative to workspace root — used as the display label and for exact Edit-button lookup. */
  relPath: string;
  checks: string[];
  checkOptions: Array<{ key: string; value: string }>;
  inherits: boolean;
}

interface ResolvedChecks {
  configs: ParsedConfig[];
  effectiveChecks: ResolvedCheck[];
}

interface ResolvedCheck {
  name: string;
  enabled: boolean;
  definedIn: string;
  options: Array<{ key: string; value: string }>;
}

export class ClangTidySidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'clangTidy.sidebar';

  private _view?: vscode.WebviewView;
  private _panel?: vscode.WebviewPanel;
  private _history: FixEntry[] = [];
  private _pending: PendingFix[] = [];
  private _activeFilePath = '';

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly engine: ClangTidyEngine,
  ) {
    this.engine.onDidUpdateFixes((_uri) => {
      // Fetch the FULL state from the engine, now that it tracks everything
      this._pending = this.engine.getAllFixes();

      output.appendLine(`[sidebar] total fixes across all files: ${this._pending.length}`);

      this._syncPending();
      this._sendChecks(this._activeFilePath);
      this._post({ command: 'setScanning', value: false });
    });
  }

  public resolveWebviewView(
    _webviewView: vscode.WebviewView,
    _ctx: vscode.WebviewViewResolveContext,
    _tok: vscode.CancellationToken,
  ): void {
    this._view = _webviewView;
    _webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };
    _webviewView.webview.html = this._getHtml(_webviewView.webview);
    this._attachMessageHandler(_webviewView.webview);

    _webviewView.onDidChangeVisibility(() => {
      if (_webviewView.visible) {
        const ed = vscode.window.activeTextEditor;
        if (ed && isEligibleDoc(ed.document)) {
          this._post({ command: 'setScanning', value: true });
          this.engine.requestScan(ed.document);
        }
      }
    });
  }

  public openAsPanel(extensionUri: vscode.Uri): void {
    if (this._panel) {
      this._panel.reveal();
      return;
    }
    this._panel = vscode.window.createWebviewPanel(
      'clangTidyPanel',
      'Clang-Tidy Fixes',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [extensionUri] },
    );
    this._panel.webview.html = this._getHtml(this._panel.webview);
    this._attachMessageHandler(this._panel.webview);
    this._panel.onDidDispose(() => {
      this._panel = undefined;
    });
  }

  // Files currently being modified by us (apply/dismiss/undo). Any
  // onDidChangeTextDocument events for these files are our own doing and
  // must not trigger watchHistory pruning. Using a Set + try/finally so the
  // guard covers the full async operation, including any secondary changes
  // from formatters or other extensions that piggyback on the same save.
  private _editingFiles = new Set<string>();

  public watchHistory(context: vscode.ExtensionContext): void {
    // Keep _activeFilePath in sync so the Checks panel always reflects the
    // currently-open C/C++ file, even before any scan has run.
    const syncActiveFile = (editor: vscode.TextEditor | undefined): void => {
      if (editor && isEligibleDoc(editor.document)) {
        this._activeFilePath = editor.document.uri.fsPath;
        this._sendChecks();
      }
    };
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(syncActiveFile));
    // Seed with whatever is already open when the extension activates.
    syncActiveFile(vscode.window.activeTextEditor);

    // Auto-refresh the Checks panel whenever any .clang-tidy file is saved or changed.
    const configWatcher = vscode.workspace.createFileSystemWatcher('**/.clang-tidy');
    configWatcher.onDidChange(() => this._sendChecks());
    configWatcher.onDidCreate(() => this._sendChecks());
    configWatcher.onDidDelete(() => this._sendChecks());
    context.subscriptions.push(configWatcher);

    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        const filePath = event.document.uri.fsPath;

        // Suppress all events for files we are currently editing.
        if (this._editingFiles.has(filePath)) return;

        const affected = this._history.filter((e) => e.filePath === filePath && !e.dismissed);
        if (!affected.length) return;
        let changed = false;
        for (const entry of affected) {
          const z0 = entry.line - 1,
            z1 = entry.endLine - 1;
          if (z1 >= event.document.lineCount) {
            this._history = this._history.filter((e) => e.id !== entry.id);
            changed = true;
            continue;
          }
          const lines: string[] = [];
          for (let i = z0; i <= z1; i++) lines.push(event.document.lineAt(i).text);
          if (lines.join('\n').trimEnd() !== entry.after.trimEnd()) {
            output.appendLine(
              `[sidebar] external edit detected, removing history: ${entry.checkName}`,
            );
            this._history = this._history.filter((e) => e.id !== entry.id);
            changed = true;
          }
        }
        if (changed) this._syncHistory();
      }),
    );
  }

  private _attachMessageHandler(webview: vscode.Webview): void {
    webview.onDidReceiveMessage(async (msg) => {
      switch (msg.command) {
        case 'log':
          // Catch silent Webview errors!
          output.appendLine(`[webview JS error] ${msg.text}`);
          break;
        case 'ready':
          output.appendLine(`[sidebar] webview HTML/JS confirmed ready`);
          // Capture the active file before syncing so the Checks panel has data.
          {
            const ed = vscode.window.activeTextEditor;
            if (ed && isEligibleDoc(ed.document)) {
              this._activeFilePath = ed.document.uri.fsPath;
            }
          }
          this._syncAll();
          {
            const ed = vscode.window.activeTextEditor;
            if (ed && isEligibleDoc(ed.document)) {
              this._post({ command: 'setScanning', value: true });
              this.engine.requestScan(ed.document);
            }
          }
          break;
        case 'refresh':
          {
            const ed = vscode.window.activeTextEditor;
            if (ed) {
              this._post({ command: 'setScanning', value: true });
              this.engine.requestScan(ed.document);
            }
          }
          break;
        case 'applyFix':
          await this._applyFix(msg.id);
          break;
        case 'undoFix':
          await this._undoFix(msg.id);
          break;
        case 'dismissFix':
          await this._dismissFix(msg.id);
          break;
        case 'disableCheck':
          await this._disableCheck(msg.checkName, msg.filePath);
          break;
        case 'applyAll':
          await this._applyAll();
          break;
        case 'dismissAll':
          await this._dismissAll();
          break;
        case 'applyFile':
          await this.applyFile(msg.filePath);
          break;
        case 'dismissFile':
          await this._dismissFile(msg.filePath);
          break;
        case 'clearHistory':
          this._clearHistory();
          break;
        case 'setSetting':
          await this._setSetting(msg.key, msg.value);
          break;
        case 'openFile':
          vscode.window.showTextDocument(vscode.Uri.file(msg.filePath), {
            selection: new vscode.Range(
              new vscode.Position(Math.max(0, msg.line - 1), 0),
              new vscode.Position(Math.max(0, msg.line - 1), 0),
            ),
            preserveFocus: true,
          });
          break;
        case 'openConfigFile':
          if (msg.filePath) vscode.window.showTextDocument(vscode.Uri.file(msg.filePath));
          break;
      }
    });
  }

  private async _applyFix(id: string): Promise<void> {
    const fix = this._pending.find((f) => f.id === id);
    if (!fix) return;
    const uri = vscode.Uri.file(fix.filePath);
    this.engine.removeFix(uri, id);
    this._editingFiles.add(fix.filePath);
    try {
      const ok = await applyEdits(fix.filePath, fix.edits);
      if (!ok) return;
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        this.engine.ignoreNextSave(uri);
        await doc.save();
      } catch (err) {
        output.appendLine(`[sidebar] auto-save after apply failed: ${err}`);
      }
      this._pending = this._pending.filter((f) => f.id !== id);
      this._history.unshift(fixToEntry(fix));
      if (this._history.length > 200) this._history.pop();
      this._syncPending();
      this._syncHistory();
      output.appendLine(`[sidebar] applied: ${fix.checkName}`);
    } finally {
      this._editingFiles.delete(fix.filePath);
    }
  }

  private async _undoFix(id: string): Promise<void> {
    const entry = this._history.find((e) => e.id === id);
    if (!entry) return;

    // Optimistic: remove from history immediately
    this._history = this._history.filter((e) => e.id !== id);
    this._syncHistory();

    const uri = vscode.Uri.file(entry.filePath);
    this._editingFiles.add(entry.filePath);
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const we = new vscode.WorkspaceEdit();

      if (entry.dismissed && entry.nolintRevert) {
        const z = entry.nolintRevert.line - 1;
        if (entry.nolintRevert.isNewLine) {
          we.replace(uri, new vscode.Range(z, 0, z + 1, 0), '');
        } else {
          we.replace(
            uri,
            new vscode.Range(z, 0, z, doc.lineAt(z).text.length),
            entry.nolintRevert.before,
          );
        }
      } else {
        const z0 = entry.line - 1;
        const z1 = entry.endLine - 1;
        we.replace(uri, new vscode.Range(z0, 0, z1, doc.lineAt(z1).text.length), entry.before);
        this._pending.push(entry as any);
        this._syncPending();
      }

      const success = await vscode.workspace.applyEdit(we);

      if (success) {
        this.engine.ignoreNextSave(uri);
        await doc.save();
        output.appendLine(
          `[sidebar] undo ${entry.dismissed ? 'dismiss' : 'fix'}: ${entry.checkName}`,
        );
      } else {
        output.appendLine(`[sidebar] undo edit rejected: ${entry.checkName}`);
        this._history.unshift(entry);
        if (!entry.dismissed) {
          this._pending = this._pending.filter((f) => f.id !== id);
          this._syncPending();
        }
        this._syncHistory();
      }
    } catch (err) {
      output.appendLine(`[sidebar] undo error: ${err}`);
      this._history.unshift(entry);
      if (!entry.dismissed) {
        this._pending = this._pending.filter((f) => f.id !== id);
        this._syncPending();
      }
      this._syncHistory();
    } finally {
      this._editingFiles.delete(entry.filePath);
    }
  }

  private async _dismissFix(id: string): Promise<void> {
    const fix = this._pending.find((f) => f.id === id);
    if (!fix) return;
    this._editingFiles.add(fix.filePath);
    try {
      const nolintRevert = await insertNolint(fix.filePath, fix.line, fix.checkName);
      this._pending = this._pending.filter((f) => f.id !== id);
      this._history.unshift({
        ...fixToEntry(fix),
        dismissed: true,
        nolintRevert: nolintRevert ?? undefined,
      });
      if (this._history.length > 200) this._history.pop();
      this._syncPending();
      this._syncHistory();
    } finally {
      this._editingFiles.delete(fix.filePath);
    }
  }

  private async _disableCheck(checkName: string, sourceFilePath: string): Promise<void> {
    const configPath = findClangTidyForFile(sourceFilePath);
    if (!configPath) {
      vscode.window.showWarningMessage(
        `Clang-Tidy: no .clang-tidy found walking up from ${path.dirname(sourceFilePath)}`,
      );
      return;
    }

    try {
      let content = fs.readFileSync(configPath, 'utf8');
      const re = /^(Checks\s*:\s*)(["']?)(.*?)\2(\s*(?:#.*)?)$/m;
      const m = re.exec(content);

      if (m) {
        const before = m[1],
          quote = m[2],
          current = m[3].trim(),
          after = m[4];
        const parts = current.split(',').map((s) => s.trim());
        if (parts.includes(`-${checkName}`)) return;
        const sep = current.endsWith(',') || current === '' ? '' : ',';
        const newLine = `${before}${quote}${current}${sep}-${checkName}${quote}${after}`;
        content = content.slice(0, m.index) + newLine + content.slice(m.index + m[0].length);
      } else {
        content = `Checks: '-${checkName}'\n` + content;
      }

      fs.writeFileSync(configPath, content, 'utf8');
      this._pending = this._pending.filter((f) => f.checkName !== checkName);
      this._syncPending();
      this._sendChecks(sourceFilePath);

      // clangd won't pick up the modified .clang-tidy until it restarts.
      output.appendLine('[sidebar] .clang-tidy updated — restarting language server');
      vscode.window.setStatusBarMessage(
        '$(sync~spin) Clang-Tidy: restarting language server to apply new settings…',
        8000,
      );
      try {
        await vscode.commands.executeCommand('clangd.restart');
      } catch (err) {
        output.appendLine(`[sidebar] clangd.restart failed: ${err}`);
        vscode.window.showInformationMessage(
          `Clang-Tidy: disabled ${checkName}. Please restart the language server for the change to take effect.`,
        );
      }
    } catch (err) {
      output.appendLine(`[sidebar] disableCheck error: ${err}`);
    }
  }

  private async _applyAll(): Promise<void> {
    const byFile = new Map<string, PendingFix[]>();
    for (const fix of this._pending) {
      const arr = byFile.get(fix.filePath) ?? [];
      arr.push(fix);
      byFile.set(fix.filePath, arr);
    }

    const we = new vscode.WorkspaceEdit();
    const filePaths = new Set<string>();
    const urisToSave = new Set<vscode.Uri>();

    for (const [fp, fixes] of byFile) {
      const uri = vscode.Uri.file(fp);
      filePaths.add(fp);
      urisToSave.add(uri);
      this._editingFiles.add(fp);
      this.engine.clearFixes(uri);
      we.set(
        uri,
        fixes
          .flatMap((f) => f.edits)
          .map((e) =>
            vscode.TextEdit.replace(
              new vscode.Range(e.startLine, e.startChar, e.endLine, e.endChar),
              e.newText,
            ),
          ),
      );
    }

    try {
      await vscode.workspace.applyEdit(we);
      for (const uri of urisToSave) {
        try {
          const doc = await vscode.workspace.openTextDocument(uri);
          this.engine.ignoreNextSave(uri);
          await doc.save();
        } catch (err) {
          output.appendLine(`[sidebar] auto-save after applyAll failed: ${err}`);
        }
      }
      for (const fix of this._pending) this._history.unshift(fixToEntry(fix));
      if (this._history.length > 200) this._history.splice(200);
      this._pending = [];
      this._syncPending();
      this._syncHistory();
      output.appendLine(`[sidebar] Apply All completed and saved.`);
    } finally {
      for (const fp of filePaths) this._editingFiles.delete(fp);
    }
  }

  private async _dismissAll(): Promise<void> {
    const newEntries: FixEntry[] = [];
    const sorted = [...this._pending].sort((a, b) => b.line - a.line);
    const affectedFiles = new Set(sorted.map((f) => f.filePath));
    for (const fp of affectedFiles) this._editingFiles.add(fp);
    try {
      for (const fix of sorted) {
        const nolintRevert = await insertNolint(fix.filePath, fix.line, fix.checkName);
        newEntries.push({
          ...fixToEntry(fix),
          dismissed: true,
          nolintRevert: nolintRevert ?? undefined,
        });
      }
      this._pending = [];
      this._history.unshift(...newEntries.reverse());
      if (this._history.length > 200) this._history.splice(200);
      this._syncPending();
      this._syncHistory();
    } finally {
      for (const fp of affectedFiles) this._editingFiles.delete(fp);
    }
  }

  public async applyFile(filePath: string): Promise<void> {
    const fixes = this._pending.filter((f) => f.filePath === filePath);
    if (!fixes.length) return;
    const uri = vscode.Uri.file(filePath);
    this.engine.clearFixes(uri);
    this._editingFiles.add(filePath);
    try {
      const we = new vscode.WorkspaceEdit();
      we.set(
        uri,
        fixes
          .flatMap((f) => f.edits)
          .map((e) =>
            vscode.TextEdit.replace(
              new vscode.Range(e.startLine, e.startChar, e.endLine, e.endChar),
              e.newText,
            ),
          ),
      );
      await vscode.workspace.applyEdit(we);
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        this.engine.ignoreNextSave(uri);
        await doc.save();
      } catch (err) {
        output.appendLine(`[sidebar] auto-save after applyFile failed: ${err}`);
      }
      for (const fix of fixes) this._history.unshift(fixToEntry(fix));
      if (this._history.length > 200) this._history.splice(200);
      this._pending = this._pending.filter((f) => f.filePath !== filePath);
      this._syncPending();
      this._syncHistory();
      output.appendLine(`[sidebar] applied all fixes for: ${filePath}`);
    } finally {
      this._editingFiles.delete(filePath);
    }
  }

  private async _dismissFile(filePath: string): Promise<void> {
    const fixes = this._pending.filter((f) => f.filePath === filePath);
    const newEntries: FixEntry[] = [];
    const sorted = [...fixes].sort((a, b) => b.line - a.line);
    this._editingFiles.add(filePath);
    try {
      for (const fix of sorted) {
        const nolintRevert = await insertNolint(fix.filePath, fix.line, fix.checkName);
        newEntries.push({
          ...fixToEntry(fix),
          dismissed: true,
          nolintRevert: nolintRevert ?? undefined,
        });
      }
      this._pending = this._pending.filter((f) => f.filePath !== filePath);
      this._history.unshift(...newEntries.reverse());
      if (this._history.length > 200) this._history.splice(200);
      this._syncPending();
      this._syncHistory();
    } finally {
      this._editingFiles.delete(filePath);
    }
  }

  private _clearHistory(): void {
    this._history = [];
    this._syncHistory();
  }

  private async _setSetting(key: string, value: unknown): Promise<void> {
    output.appendLine(`[sidebar] Webview requested setting change: ${key} = ${value}`);
    const cfg = vscode.workspace.getConfiguration('clang-tidy');

    try {
      await cfg.update(key, value, vscode.ConfigurationTarget.Workspace);
      output.appendLine(`[sidebar] Successfully wrote clang-tidy.${key} to Workspace settings.`);
    } catch (err) {
      output.appendLine(`[sidebar] FAILED to update setting: ${err}`);
      vscode.window.showErrorMessage(`Failed to update setting: ${err}`);
    }
  }

  private _sendChecks(sourceFilePath?: string): void {
    const filePath = sourceFilePath ?? this._activeFilePath;
    const resolved = filePath ? resolveChecksForFile(filePath) : null;
    this._post({ command: 'updateChecks', resolved });
  }

  private _syncAll(): void {
    this._syncPending();
    this._syncHistory();
    this._sendChecks();
    this._sendAllSettings();
  }

  private _updateTimeout?: NodeJS.Timeout;

  private _syncPending(): void {
    // Debounce: Wait 100ms before rendering to batch rapid updates
    if (this._updateTimeout) clearTimeout(this._updateTimeout);

    this._updateTimeout = setTimeout(() => {
      output.appendLine(`[sidebar] posting ${this._pending.length} fixes to webview`);
      this._post({ command: 'updatePending', fixes: this._pending });
    }, 100);
  }

  private _syncHistory(): void {
    this._post({ command: 'updateHistory', entries: this._history });
  }

  private _sendAllSettings(): void {
    const cfg = vscode.workspace.getConfiguration('clang-tidy');
    this._post({
      command: 'allSettings',
      settings: {
        fixOnSave: cfg.get('fixOnSave', false),
        fixTimeoutMs: cfg.get('fixTimeoutMs', 3000),
        blacklist: cfg.get<string[]>('blacklist', []).join(', '),
        checksFilter: cfg.get<string[]>('checksFilter', []).join(', '),
      },
    });
  }

  private _post(msg: unknown): void {
    this._view?.webview.postMessage(msg);
    this._panel?.webview.postMessage(msg);
  }

  private _getHtml(webview: vscode.Webview): string {
    const htmlPath = vscode.Uri.joinPath(
      this._extensionUri,
      'src',
      'packages',
      'ui',
      'webview',
      'sidebar.html',
    );
    const scriptPath = vscode.Uri.joinPath(
      this._extensionUri,
      'src',
      'packages',
      'ui',
      'webview',
      'sidebar.js',
    );
    const stylePath = vscode.Uri.joinPath(
      this._extensionUri,
      'src',
      'packages',
      'ui',
      'webview',
      'sidebar.css',
    );

    const html = fs.readFileSync(htmlPath.fsPath, 'utf8');
    const scriptUri = webview.asWebviewUri(scriptPath);
    const styleUri = webview.asWebviewUri(stylePath);
    const nonce = getNonce();

    return html
      .replace(/{{cspSource}}/g, webview.cspSource)
      .replace(/{{nonce}}/g, nonce)
      .replace(/{{styleUri}}/g, styleUri.toString())
      .replace(/{{scriptUri}}/g, scriptUri.toString());
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJEKLMNOPQRSTUVWXTZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

// ── Config walking ────────────────────────────────────────────────────────────
function findClangTidyForFile(sourceFilePath: string): string | null {
  let dir = fs.statSync(sourceFilePath).isDirectory()
    ? sourceFilePath
    : path.dirname(sourceFilePath);
  const root = path.parse(dir).root;
  while (dir !== root) {
    const candidate = path.join(dir, '.clang-tidy');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function parseConfigFile(filePath: string): ParsedConfig | null {
  try {
    const content = fs.readFileSync(filePath, 'utf8');

    // ── InheritParentConfig ──────────────────────────────────────────────────
    const inheritsMatch = /^InheritParentConfig\s*:\s*(true|false)/im.exec(content);
    const inherits = inheritsMatch ? inheritsMatch[1].toLowerCase() === 'true' : false;

    // Helper: extract a top-level YAML key's full block (the key line plus all
    // subsequent indented lines), stopping at the next non-indented, non-empty line.
    function extractBlock(key: string): string {
      const esc = key.replace(/[-.*+?^${}()|[\]\\]/g, '\\$&');
      const m = new RegExp(`^${esc}\\s*:`, 'm').exec(content);
      if (!m) return '';
      const rest = content.slice(m.index);
      const lines = rest.split('\n');
      const out: string[] = [lines[0]];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === '') {
          out.push(line);
          continue;
        }
        if (/^\S/.test(line)) break; // next top-level key or YAML document marker
        out.push(line);
      }
      return out.join('\n');
    }

    // ── Checks ───────────────────────────────────────────────────────────────
    // Handles all common spellings:
    //   Checks: '-*,modernize-*'               single-line, quoted
    //   Checks: -*, modernize-*                single-line, unquoted
    //   Checks: >-\n  -*,\n  modernize-*       YAML block scalar
    //   Checks:\n  '-*,\n   modernize-*'       value on next line(s), quoted  ← user's format
    let checks: string[] = [];
    const checksBlock = extractBlock('Checks');
    if (checksBlock) {
      // Strip the "Checks:" key prefix to isolate the value area.
      const valArea = checksBlock.replace(/^Checks\s*:\s*/m, '');

      // Determine value type from the first non-empty, non-whitespace content.
      const firstNonEmpty = valArea.replace(/^[\s\n]*/, '');
      let inner = '';

      if (/^[>|]/.test(firstNonEmpty)) {
        // YAML block scalar (>, >-, |, |-): content on subsequent indented lines.
        inner = firstNonEmpty
          .split('\n')
          .slice(1)
          .map((l) => l.trim())
          .join('');
      } else {
        // Flow scalar (quoted or plain), possibly spanning multiple lines.
        // Find the opening quote (if any) anywhere in valArea.
        const qi = valArea.search(/['"]/);
        if (qi !== -1) {
          const q = valArea[qi];
          const lastQi = valArea.lastIndexOf(q);
          inner = lastQi > qi ? valArea.slice(qi + 1, lastQi) : valArea.slice(qi + 1);
        } else {
          inner = valArea;
        }
      }

      // Normalize: split by newlines first (handles multi-line quoted strings),
      // then by commas.  Each token becomes one check entry.
      checks = inner
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .flatMap((l) => l.split(','))
        .map((s) => s.trim())
        .filter(Boolean);
    }

    // ── CheckOptions ─────────────────────────────────────────────────────────
    // Supports two YAML styles used by different clang-tidy versions:
    //
    //   Style A – block mapping (clang-tidy ≥ 14, user's format):
    //     CheckOptions:
    //       readability-identifier-naming.VariableCase: camelBack
    //
    //   Style B – block sequence (older generators):
    //     CheckOptions:
    //       - key: readability-identifier-naming.VariableCase
    //         value: camelBack
    const checkOptions: Array<{ key: string; value: string }> = [];
    const coBlock = extractBlock('CheckOptions');
    if (coBlock) {
      // Style A: "  dotted.Key: value" — key must contain a dot to avoid matching
      // the sequence keywords "key:" and "value:" from Style B.
      const mapRe = /^\s+([\w-]+\.[\w.\-]+)\s*:\s*['"]?([^'"\n]*?)['"]?\s*$/gm;
      let m: RegExpExecArray | null;
      while ((m = mapRe.exec(coBlock)) !== null) {
        checkOptions.push({ key: m[1].trim(), value: m[2].trim() });
      }

      // Style B: "  - key: foo\n    value: bar" (only if Style A found nothing)
      if (checkOptions.length === 0) {
        const seqRe =
          /[-\s]+key\s*:\s*['"]?([^'"\n]+?)['"]?\s*\n\s+value\s*:\s*['"]?([^'"\n]+?)['"]?/g;
        while ((m = seqRe.exec(coBlock)) !== null) {
          checkOptions.push({ key: m[1].trim(), value: m[2].trim() });
        }
      }
    }

    return { filePath, relPath: '', checks, checkOptions, inherits };
  } catch (_err) {
    return null;
  }
}

function collectConfigChain(sourceFilePath: string): ParsedConfig[] {
  const chain: ParsedConfig[] = [];
  let dir =
    fs.existsSync(sourceFilePath) && fs.statSync(sourceFilePath).isDirectory()
      ? sourceFilePath
      : path.dirname(sourceFilePath);
  const root = path.parse(dir).root;
  while (dir !== root) {
    const candidate = path.join(dir, '.clang-tidy');
    if (fs.existsSync(candidate)) {
      const parsed = parseConfigFile(candidate);
      if (!parsed) break;
      chain.push(parsed);
      if (!parsed.inherits) break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return chain;
}

function resolveChecksForFile(sourceFilePath: string): ResolvedChecks | null {
  if (!sourceFilePath) return null;
  const rawConfigs = collectConfigChain(sourceFilePath);
  if (rawConfigs.length === 0) return null;

  // Stamp each config with its workspace-relative display path so the webview
  // can do an exact lookup for Edit-button links without fragile endsWith logic.
  const configs = rawConfigs.map((c) => ({ ...c, relPath: relativeToWorkspace(c.filePath) }));

  const optionMap = new Map<string, string>();
  for (const cfg of [...configs].reverse()) {
    for (const o of cfg.checkOptions) optionMap.set(o.key, o.value);
  }

  const resolved = new Map<string, { enabled: boolean; definedIn: string }>();
  for (const cfg of [...configs].reverse()) {
    for (const check of cfg.checks) {
      const isDisable = check.startsWith('-');
      const name = check.replace(/^[+-]/, '').trim();
      if (!name || name === '*') continue;
      resolved.set(name, { enabled: !isDisable, definedIn: cfg.relPath });
    }
  }

  const effectiveChecks: ResolvedCheck[] = Array.from(resolved.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, info]) => ({
      name,
      enabled: info.enabled,
      definedIn: info.definedIn,
      // Per-check options are still matched by prefix for checks that ARE
      // explicitly listed (e.g. 'readability-identifier-naming').
      // CheckOptions for wildcards are shown in the raw per-config section below.
      options: Array.from(optionMap.entries())
        .filter(([k]) => k.startsWith(name + '.'))
        .map(([k, v]) => ({ key: k, value: v })),
    }));

  return { configs, effectiveChecks };
}

function relativeToWorkspace(filePath: string): string {
  const folders = vscode.workspace.workspaceFolders;
  if (folders) {
    for (const f of folders) {
      if (filePath.startsWith(f.uri.fsPath)) return filePath.slice(f.uri.fsPath.length + 1);
    }
  }
  return path.basename(path.dirname(filePath)) + '/.clang-tidy';
}

function isEligibleDoc(doc: vscode.TextDocument): boolean {
  return doc.languageId === 'cpp' || doc.languageId === 'c';
}

function fixToEntry(fix: PendingFix): FixEntry {
  const afterLineCount = fix.after.split('\n').length;
  return {
    id: fix.id,
    checkName: fix.checkName,
    filePath: fix.filePath,
    relPath: fix.relPath,
    line: fix.line,
    endLine: fix.line + afterLineCount - 1,
    before: fix.before,
    after: fix.after,
    timestamp: Date.now(),
  };
}

async function applyEdits(filePath: string, edits: SerializableEdit[]): Promise<boolean> {
  const uri = vscode.Uri.file(filePath);
  const we = new vscode.WorkspaceEdit();
  we.set(
    uri,
    edits.map((e) =>
      vscode.TextEdit.replace(
        new vscode.Range(e.startLine, e.startChar, e.endLine, e.endChar),
        e.newText,
      ),
    ),
  );
  return vscode.workspace.applyEdit(we);
}

async function insertNolint(
  filePath: string,
  line: number,
  checkName: string,
): Promise<{ line: number; isNewLine: boolean; before: string } | null> {
  const uri = vscode.Uri.file(filePath);
  let doc: vscode.TextDocument;
  try {
    doc = await vscode.workspace.openTextDocument(uri);
  } catch (_err) {
    return null;
  }
  const zl = line - 1;
  if (zl >= doc.lineCount) return null;
  const lt = doc.lineAt(zl).text;
  const indent = lt.slice(0, lt.length - lt.trimStart().length);
  const exist = /\/\/ NOLINT(\(([^)]*)\))?$/.exec(lt);
  const we = new vscode.WorkspaceEdit();
  if (exist) {
    const cs = (exist[2] ? exist[2].split(',').map((s) => s.trim()) : []).concat(checkName);
    we.replace(
      uri,
      new vscode.Range(zl, lt.lastIndexOf('//'), zl, lt.length),
      `// NOLINT(${cs.join(', ')})`,
    );
    await vscode.workspace.applyEdit(we);
    // Revert: restore original line text (inline append)
    return { line, isNewLine: false, before: lt };
  } else {
    we.insert(uri, new vscode.Position(zl, 0), `${indent}// NOLINTNEXTLINE(${checkName})\n`);
    await vscode.workspace.applyEdit(we);
    // Revert: delete the inserted NOLINTNEXTLINE line (line is now at zl, i.e. 1-based = line)
    return { line, isNewLine: true, before: '' };
  }
}
