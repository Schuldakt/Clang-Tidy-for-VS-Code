import * as vscode from 'vscode';
import { fetchFixes, waitForRunning } from '@clang-tidy/lsp';
import type { PendingFix } from '@clang-tidy/types';
import type { BaseLanguageClient } from 'vscode-languageclient';
import { State } from 'vscode-languageclient';
import { output } from '@clang-tidy/lsp';
import type { ClangdExtension } from '@clangd/vscode-clangd';

export class ClangTidyEngine implements vscode.Disposable {
  private _onDidUpdateFixes = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidUpdateFixes = this._onDidUpdateFixes.event;
  public onApplyFileRequested?: (filePath: string) => Promise<void>;

  private _pendingFixes = new Map<string, PendingFix[]>();
  private _scanTimers = new Map<string, NodeJS.Timeout>();
  private _disposables: vscode.Disposable[] = [];

  // A VIP list of files that should bypass the auto-fix loop on their next save
  private _ignoreNextSave = new Set<string>();

  constructor(private clangdExtension: ClangdExtension) {}

  private get client(): BaseLanguageClient {
    return this.clangdExtension.getApi(1).languageClient as any;
  }

  // ── Methods for the UI to safely update the Engine's state ──
  public removeFix(uri: vscode.Uri, id: string) {
    const fixes = this.getFixes(uri).filter((f) => f.id !== id);
    this._pendingFixes.set(uri.fsPath, fixes);
  }

  public clearFixes(uri: vscode.Uri) {
    this._pendingFixes.set(uri.fsPath, []);
  }

  public ignoreNextSave(uri: vscode.Uri) {
    this._ignoreNextSave.add(uri.fsPath);
  }
  // ────────────────────────────────────────────────────────────

  public activate(context: vscode.ExtensionContext) {
    // 1. Diagnostic observer (Only registers once)
    this._disposables.push(
      vscode.languages.onDidChangeDiagnostics((e) => {
        for (const uri of e.uris) {
          const openDoc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === uri.fsPath);
          if (openDoc && this.isEligible(openDoc)) {
            this.requestScan(openDoc);
          }
        }
      }),
    );

    // 2. State listener (use the helper to safely attach)
    this._attachClientListeners();

    // 3. Fix on Save Hook
    this._disposables.push(
      vscode.workspace.onDidSaveTextDocument(async (doc) => {
        if (!this.isEligible(doc)) return;
        if (this._ignoreNextSave.has(doc.uri.fsPath)) {
          this._ignoreNextSave.delete(doc.uri.fsPath);
          return;
        }

        const cfg = vscode.workspace.getConfiguration('clang-tidy');
        // FIX: Ensure default is false!
        const isEnabled = cfg.get<boolean>('fixOnSave', true);

        output.appendLine(`[engine] Debug: fixOnSave is currently: ${isEnabled}`);
        if (!isEnabled) {
          return;
        } else {
          if (this.onApplyFileRequested) {
            await this.onApplyFileRequested(doc.uri.fsPath);
          }
        }

        const pending = this.getFixes(doc.uri);
        if (pending.length === 0) return;

        output.appendLine(`[engine] Post-save triggered. Applying ${pending.length} fixes...`);

        const we = new vscode.WorkspaceEdit();
        const textEdits = pending.flatMap((f) =>
          f.edits.map((edit) =>
            vscode.TextEdit.replace(
              new vscode.Range(edit.startLine, edit.startChar, edit.endLine, edit.endChar),
              edit.newText,
            ),
          ),
        );
        we.set(doc.uri, textEdits);

        this._pendingFixes.set(doc.uri.fsPath, []);
        this._onDidUpdateFixes.fire(doc.uri);

        const success = await vscode.workspace.applyEdit(we);
        if (success) {
          // Grant this file a VIP pass so the follow-up save doesn't trigger an infinite loop
          this.ignoreNextSave(doc.uri);
          await doc.save();
          output.appendLine(
            `[engine] Auto-applied fixes and triggered follow-up save successfully.`,
          );
        }
      }),
    );
  }

  private _attachClientListeners() {
    if (this.client?.onDidChangeState) {
      this._disposables.push(
        this.client.onDidChangeState(async (e) => {
          if (e.newState === State.Running) {
            output.appendLine('[engine] server running - scanning open files');
            for (const doc of vscode.workspace.textDocuments) {
              if (this.isEligible(doc)) this.requestScan(doc);
            }
          }
        }),
      );
    }
  }

  public getFixes(uri: vscode.Uri): PendingFix[] {
    return this._pendingFixes.get(uri.fsPath) || [];
  }

  public getAllFixes(): PendingFix[] {
    return Array.from(this._pendingFixes.values()).flat();
  }

  public requestScan(doc: vscode.TextDocument) {
    const key = doc.uri.fsPath;
    if (this._scanTimers.has(key)) clearTimeout(this._scanTimers.get(key)!);

    const targetVersion = doc.version;
    this._scanTimers.set(
      key,
      setTimeout(() => {
        // If the document changed while the timer was running a newer scan will
        // be scheduled by onDidChangeDiagnostics, but we must still fire so the
        // sidebar spinner doesn't get stuck.
        if (doc.version !== targetVersion) {
          this._onDidUpdateFixes.fire(doc.uri);
          return;
        }
        this._doScan(doc);
      }, 1200),
    );
  }

  private _isScanning = new Set<string>();

  private async _doScan(doc: vscode.TextDocument) {
    const client = this.client;
    const key = doc.uri.fsPath;

    if (!client) {
      output.appendLine('[engine] language server not available');
    }

    // Prevent concurrent scans for the same file
    if (this._isScanning.has(key)) return;

    this._isScanning.add(key);

    try {
      if (doc.isClosed) return;

      const diags = vscode.languages.getDiagnostics(doc.uri);
      const hasTidyDiags = diags.some(
        (d) => d.source === 'clang-tidy' || String(d.code).includes('-'),
      );

      if (!hasTidyDiags) {
        this._pendingFixes.set(key, []);
        return;
      }

      const cfg = vscode.workspace.getConfiguration('clang-tidy', doc.uri);
      const timeoutMs = cfg.get<number>('fixTimeoutMs', 3000);
      const checksFilter = cfg.get<string[]>('checksFilter', []);

      const ready = await waitForRunning(this.client, timeoutMs);
      if (!ready) {
        output.appendLine('[engine] language server not ready — scan deferred');
        return;
      }

      try {
        const result: any = await fetchFixes(this.client, doc, timeoutMs, checksFilter);

        if (result === null || result === undefined) {
          output.appendLine('[engine] server returned null result - deferring!');
          return;
        }

        const pendingArr: PendingFix[] = Array.isArray(result) ? result : result?.pending || [];
        this._pendingFixes.set(key, pendingArr);
      } catch (err) {
        output.appendLine(`[engine] fetchFixes error: ${err}`);
      }
    } finally {
      // 1. Always remove from scanning set
      this._isScanning.delete(key);
      // 2. Always signal UI update to reset spinners
      this._onDidUpdateFixes.fire(doc.uri);
    }
  }

  private isEligible(doc: vscode.TextDocument): boolean {
    return ['cpp', 'c'].includes(doc.languageId);
  }

  public dispose() {
    this._disposables.forEach((d) => d.dispose());
    this._onDidUpdateFixes.dispose();
  }
}
