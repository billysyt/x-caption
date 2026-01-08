type LogFn = (...args: unknown[]) => void;

const noop: LogFn = () => undefined;
const debugEnabled = Boolean(import.meta.env.DEV);

export const logger = {
  debug: debugEnabled ? (...args: unknown[]) => console.log(...args) : noop,
  info: debugEnabled ? (...args: unknown[]) => console.info(...args) : noop,
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args)
};
