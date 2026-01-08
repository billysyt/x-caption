import type { ExportLanguage } from "../types";
import { getOpenCc } from "./window";

export function safeOpenCcConverter(target: ExportLanguage): ((input: string) => string) | null {
  const OpenCC = getOpenCc();
  if (!OpenCC || typeof OpenCC.Converter !== "function") return null;
  try {
    if (target === "traditional") {
      return OpenCC.Converter({ from: "cn", to: "tw" });
    }
    return OpenCC.Converter({ from: "tw", to: "cn" });
  } catch {
    return null;
  }
}
