import { output } from './initOutput';

export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => {
      output.appendLine(`[withTimeout] timed out after ${ms}ms`);
      resolve(fallback);
    }, ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        output.appendLine(`[withTimeout] promise rejected: ${err}`);
        resolve(fallback);
      },
    );
  });
}
