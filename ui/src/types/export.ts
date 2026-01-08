export type ExportLanguage = "simplified" | "traditional";

export type ConvertChineseResponse = {
  success?: boolean;
  converted_text?: string;
  error?: string;
};

export type ExportSegmentPayload = {
  id?: number | string;
  start?: number | string | null;
  end?: number | string | null;
  text?: string | null;
  originalText?: string | null;
};

export type ExportResponse = {
  success?: boolean;
  content?: string;
  suffix?: string;
  error?: string;
};
