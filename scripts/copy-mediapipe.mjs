// Copies MediaPipe's WebAssembly runtime into public/ so face detection for
// webcam-proctored exams loads from our own domain (no third-party CDN).
// Runs automatically before `npm run build` and `npm run dev`.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const from = path.join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const to = path.join(root, "public", "mediapipe");
if (!fs.existsSync(from)) { console.warn("copy-mediapipe: @mediapipe/tasks-vision not installed; face detection falls back to the browser's own"); process.exit(0); }
fs.mkdirSync(to, { recursive: true });
for (const f of fs.readdirSync(from)) fs.copyFileSync(path.join(from, f), path.join(to, f));
console.log(`copy-mediapipe: ${fs.readdirSync(to).length} files → public/mediapipe`);
