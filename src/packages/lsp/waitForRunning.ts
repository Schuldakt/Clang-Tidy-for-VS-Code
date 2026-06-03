import { State } from 'vscode-languageclient';

// How long to wait for the server to reach Running during an in-flight scan.
// The engine separately re-triggers scans whenever State.Running fires, so
// this only needs to cover the "server is mid-startup" window, not a full
// re-index.  30 s is enough for even large projects.

export async function waitForRunning(client: any, timeoutMs: number): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (client.state === State.Running) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}
