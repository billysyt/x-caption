import type { PywebviewApi } from "../types";

export function callApiMethod(api: PywebviewApi | null | undefined, names: string[], ...args: unknown[]) {
  if (!api) return null;
  for (const name of names) {
    const fn = api[name];
    if (typeof fn === "function") {
      return fn.call(api, ...args);
    }
  }
  return null;
}
