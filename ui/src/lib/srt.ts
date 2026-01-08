import type { TranscriptSegment } from "../types";

export function parseSrtTimestamp(raw: string) {
  const match = raw.trim().match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{1,3})/);
  if (!match) return 0;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const millis = Number(match[4].padEnd(3, "0"));
  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

export function formatSrtTimestamp(seconds: number) {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${secs.toString().padStart(2, "0")},${ms
    .toString()
    .padStart(3, "0")}`;
}

export function parseSrt(text: string): TranscriptSegment[] {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  const segments: TranscriptSegment[] = [];
  let id = 1;
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines.length) continue;
    let timeLineIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeLineIndex < 0) continue;
    if (timeLineIndex === 0 && /^\d+$/.test(lines[0])) {
      timeLineIndex = 1;
    }
    const timeLine = lines[timeLineIndex] ?? "";
    const [startRaw, endRaw] = timeLine.split("-->").map((part) => part.trim());
    if (!startRaw || !endRaw) continue;
    const start = parseSrtTimestamp(startRaw);
    const end = parseSrtTimestamp(endRaw);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const textLines = lines.slice(timeLineIndex + 1);
    const captionText = textLines.join("\n").trim();
    segments.push({
      id,
      start,
      end,
      text: captionText,
      originalText: captionText
    });
    id += 1;
  }
  return segments;
}
