/**
 * The exam paper every student shares, and each student's own layout of it.
 *
 * At the start of an exam a whole hall asks for the same paper at the same moment. Instead of the
 * server building it thousands of times, the paper (questions and options, never the answers) is
 * encrypted once and served from Cloudflare's cache; devices download it in the lobby before the
 * exam opens. When a student starts, the server only sends the key and that student's order of
 * questions and options, and the device puts the paper together here.
 *
 * Used in the browser and on the server (no server-only imports).
 */

export type PaperQuestion = { id: string; type: string; prompt: string; points: number; media_url: string | null; section: string | null; data: Record<string, any> };

/** The list each question type shuffles per student (as engine.toPublicQuestion does on the server). */
export const SHUFFLED_FIELD: Record<string, string> = {
  mcq_single: "options", mcq_multi: "options", matching: "right", ordering: "items", drag_drop: "items", label_image: "labels"
};

function reorder<T extends { id: string }>(list: T[], order?: string[]): T[] {
  if (!order?.length) return list;
  const byId = new Map(list.map(x => [x.id, x]));
  const out = order.map(id => byId.get(id)).filter(Boolean) as T[];
  for (const x of list) if (!order.includes(x.id)) out.push(x);
  return out;
}

/** One student's paper: their questions in their order, each with its options in their order. */
export function applyLayout(paper: PaperQuestion[], questionOrder: string[] | null | undefined, optionOrders: Record<string, string[]> | null | undefined): PaperQuestion[] {
  const byId = new Map(paper.map(q => [q.id, q]));
  const order = questionOrder?.length ? questionOrder : paper.map(q => q.id);
  return order.map(id => byId.get(id)).filter((q): q is PaperQuestion => Boolean(q)).map(q => {
    const field = SHUFFLED_FIELD[q.type];
    const ord = optionOrders?.[q.id];
    if (!field || !ord?.length || !Array.isArray(q.data?.[field])) return q;
    return { ...q, data: { ...q.data, [field]: reorder(q.data[field], ord) } };
  });
}

const b64ToBytes = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

/**
 * Opens a downloaded paper with the key the server gave this student at the start.
 * The file is a 12-byte IV followed by AES-256-GCM ciphertext (with its tag).
 */
export async function decryptPaper(file: ArrayBuffer, keyB64: string): Promise<PaperQuestion[]> {
  const bytes = new Uint8Array(file);
  if (bytes.length < 29) throw new Error("paper file too short");
  const key = await crypto.subtle.importKey("raw", b64ToBytes(keyB64), { name: "AES-GCM" }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12));
  const paper = JSON.parse(new TextDecoder().decode(plain));
  if (!Array.isArray(paper)) throw new Error("not a paper");
  return paper as PaperQuestion[];
}

/** Whether this browser can open an encrypted paper (very old browsers get the paper from the server instead). */
export const canOpenPaper = () => typeof crypto !== "undefined" && Boolean(crypto.subtle) && typeof TextDecoder !== "undefined";
