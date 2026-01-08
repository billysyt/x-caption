export type PywebviewApi = Record<string, (...args: unknown[]) => unknown>;

export type OpenCcApi = {
  Converter?: (options: { from: string; to: string }) => (input: string) => string;
};

export type PywebviewWindow = Window & {
  pywebview?: { api?: PywebviewApi };
  __APP_VERSION__?: string;
  __USE_NATIVE_DRAG__?: boolean;
  OpenCC?: OpenCcApi;
  store?: unknown;
};
