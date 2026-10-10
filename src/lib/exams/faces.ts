/**
 * Counts faces in a webcam frame for exam proctoring, in every modern
 * browser: the browser's own FaceDetector where it exists (some Chrome
 * builds), otherwise MediaPipe's BlazeFace model running in WebAssembly,
 * served from this site (/mediapipe, /models). Returns -1 when no detector
 * could start, so callers simply skip the face check.
 */
type Counter = (frame: HTMLCanvasElement) => Promise<number>;

let pending: Promise<Counter> | null = null;

export function faceCounter(): Promise<Counter> {
  if (!pending) pending = create();
  return pending;
}

async function create(): Promise<Counter> {
  const Native = (window as unknown as { FaceDetector?: new () => { detect: (s: CanvasImageSource) => Promise<unknown[]> } }).FaceDetector;
  if (Native) {
    try {
      const d = new Native();
      return async frame => { try { return (await d.detect(frame)).length; } catch { return -1; } };
    } catch { /* fall through to MediaPipe */ }
  }
  try {
    const { FilesetResolver, FaceDetector } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks("/mediapipe");
    const detector = await FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: "/models/blaze_face_short_range.tflite", delegate: "CPU" },
      runningMode: "IMAGE",
      minDetectionConfidence: 0.5
    });
    return async frame => { try { return detector.detect(frame).detections.length; } catch { return -1; } };
  } catch {
    return async () => -1;
  }
}
