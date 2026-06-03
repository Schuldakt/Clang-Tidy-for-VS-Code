import * as vscode from 'vscode';
import type { ClangdExtension } from '@clangd/vscode-clangd';
import { ClangTidyEngine } from '@clang-tidy/engine';
import { ClangTidySidebarProvider } from '@clang-tidy/ui';
import { initOutput, output } from '@clang-tidy/lsp';

const CLANGD_EXTENSION = 'llvm-vs-code-extensions.vscode-clangd';
const CLANGD_API_VERSION = 1;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel('Clang-Tidy', 'clang-tidy-output');
  context.subscriptions.push(outputChannel);
  initOutput(outputChannel);

  output.appendLine('[activate] extension starting');

  const clangdExt = vscode.extensions.getExtension<ClangdExtension>(CLANGD_EXTENSION);
  if (!clangdExt) {
    vscode.window.showWarningMessage('Clang-Tidy: clangd extension not found.');
    return;
  }

  await clangdExt.activate();
  const api = clangdExt.exports.getApi(CLANGD_API_VERSION);
  if (!api.languageClient) {
    vscode.window.showWarningMessage('Clang-Tidy: clangd language client failed to initialize!');
    return;
  }

  const engine = new ClangTidyEngine(clangdExt.exports);
  engine.activate(context);
  context.subscriptions.push(engine);

  // 2. Initialize UI Provider (The View) -> Pass the Engine to it!
  const sidebarProvider = new ClangTidySidebarProvider(context.extensionUri, engine);

  engine.onApplyFileRequested = (fp) => sidebarProvider.applyFile(fp);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ClangTidySidebarProvider.viewId, sidebarProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  sidebarProvider.watchHistory(context);

  // 3. Open as editor panel
  context.subscriptions.push(
    vscode.commands.registerCommand('clang-tidy.openPanel', () => {
      sidebarProvider.openAsPanel(context.extensionUri);
    }),
  );

  // 4. Status bar
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'clang-tidy.scanFixes';
  statusBar.tooltip = 'Click to scan for clang-tidy fixes';
  context.subscriptions.push(statusBar);

  vscode.window.onDidChangeActiveTextEditor(
    (editor) => {
      if (editor && (editor.document.languageId === 'cpp' || editor.document.languageId === 'c')) {
        statusBar.text = '$(wrench) Clang-Tidy';
        statusBar.show();
      } else {
        statusBar.hide();
      }
    },
    null,
    context.subscriptions,
  );

  // 5. Manual scan command -> Tells the engine to scan!
  context.subscriptions.push(
    vscode.commands.registerCommand('clang-tidy.scanFixes', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        engine.requestScan(editor.document);
        vscode.commands.executeCommand('clangTidy.sidebar.focus');
      }
    }),
  );

  output.appendLine('[activate] ready');
}

export function deactivate(): void {}
