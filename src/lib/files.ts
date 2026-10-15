/**
 * Checks an uploaded file: allowed type, size, and that its first bytes match
 * the type it claims (so a renamed program cannot be stored as a "PDF").
 */
export const DOC_TYPES: Record<string, string> = {
  "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic"
};
export const MEDIA_TYPES: Record<string, string> = {
  ...DOC_TYPES, "video/mp4": "mp4", "audio/mpeg": "mp3", "audio/mp4": "m4a",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx", "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx"
};

/** Recorded voice and video feedback. */
export const RECORDING_TYPES: Record<string, string> = {
  "audio/webm": "weba", "video/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "video/mp4": "mp4", "audio/mpeg": "mp3"
};
/** What students hand in. */
export const SUBMISSION_TYPES: Record<string, string> = { ...MEDIA_TYPES, "video/webm": "webm", "audio/webm": "weba" };

export function sniff(buf: Buffer, ext: string): boolean {
  const hex = buf.subarray(0, 12).toString("hex");
  switch (ext) {
    case "pdf": return hex.startsWith("25504446");
    case "jpg": return hex.startsWith("ffd8");
    case "png": return hex.startsWith("89504e47");
    case "webp": return hex.startsWith("52494646") && buf.subarray(8, 12).toString() === "WEBP";
    case "heic": case "mp4": case "m4a": return buf.subarray(4, 8).toString() === "ftyp";
    case "mp3": return hex.startsWith("494433") || hex.startsWith("fffb") || hex.startsWith("fff3") || hex.startsWith("fff2");
    case "docx": case "pptx": return hex.startsWith("504b0304");
    case "webm": case "weba": return hex.startsWith("1a45dfa3");
    case "ogg": return hex.startsWith("4f676753");
    default: return false;
  }
}

export async function readUpload(file: unknown, types: Record<string, string>, maxMb: number): Promise<{ ok: true; buf: Buffer; ext: string; type: string; name: string; size: number } | { ok: false; error: string; status: number }> {
  if (!(file instanceof File)) return { ok: false, error: "choose a file", status: 400 };
  if (file.size > maxMb * 1024 * 1024) return { ok: false, error: `files must be ${maxMb} MB or smaller`, status: 413 };
  // Recorders report types like "audio/webm;codecs=opus".
  const type = file.type.split(";")[0].trim().toLowerCase();
  const ext = types[type];
  if (!ext) return { ok: false, error: `this file type is not accepted (${[...new Set(Object.values(types))].join(", ")})`, status: 415 };
  const buf = Buffer.from(await file.arrayBuffer());
  if (!sniff(buf, ext)) return { ok: false, error: "that file is not what its name says it is", status: 415 };
  return { ok: true, buf, ext, type, name: file.name.replace(/[^\w.\- ]+/g, "_").slice(-100) || `file.${ext}`, size: file.size };
}
