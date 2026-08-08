import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

// Suppress TFLite WASM stderr messages (e.g., "INFO: Created TensorFlow Lite XNNPACK delegate for CPU.")
// from invoking console.error, which triggers Next.js dev error overlays despite being purely informational logs.
if (typeof window !== "undefined") {
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    const firstArg = args[0];
    if (
      typeof firstArg === "string" &&
      (firstArg.startsWith("INFO:") ||
        firstArg.includes("TensorFlow Lite") ||
        firstArg.includes("XNNPACK delegate") ||
        firstArg.includes("Created TensorFlow Lite"))
    ) {
      console.info(...args);
      return;
    }
    originalConsoleError.apply(console, args);
  };
}

// Standard 6-point eye contours from MediaPipe's 478-point face mesh,
// ordered [outer corner, upper-1, upper-2, inner corner, lower-2, lower-1]
// so the EAR formula lines up the same way it does for dlib's 68-point set.
const RIGHT_EYE = [33, 160, 158, 133, 153, 144];
const LEFT_EYE = [362, 385, 387, 263, 373, 380];

// Inner-lip vertical points and outer mouth corners, for a MAR (Mouth
// Aspect Ratio) that mirrors the EAR formula: opening-height / mouth-width.
const MOUTH_TOP = 13;
const MOUTH_BOTTOM = 14;
const MOUTH_LEFT = 61;
const MOUTH_RIGHT = 291;

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

let landmarkerPromise: Promise<FaceLandmarker> | null = null;

async function createLandmarker() {
  const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
  try {
    return await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: "/mediapipe/face_landmarker.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFacialTransformationMatrixes: true,
      outputFaceBlendshapes: false,
    });
  } catch (gpuErr) {
    console.warn("GPU FaceLandmarker failed, trying CPU delegate fallback:", gpuErr);
    return await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: "/mediapipe/face_landmarker.task",
        delegate: "CPU",
      },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFacialTransformationMatrixes: true,
      outputFaceBlendshapes: false,
    });
  }
}

export function loadFaceLandmarker(): Promise<FaceLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = createLandmarker().catch((err) => {
      landmarkerPromise = null;
      throw err;
    });
  }
  return landmarkerPromise;
}

export function closeFaceLandmarker() {
  if (landmarkerPromise) {
    landmarkerPromise
      .then((instance) => {
        try {
          instance.close();
        } catch {}
      })
      .catch(() => {});
    landmarkerPromise = null;
  }
}

function dist(a: Landmark, b: Landmark) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function eyeAspectRatio(points: Landmark[]) {
  const [p1, p2, p3, p4, p5, p6] = points;
  return (dist(p2, p6) + dist(p3, p5)) / (2 * dist(p1, p4));
}

export function computeEAR(landmarks: Landmark[]): number {
  const left = LEFT_EYE.map((i) => landmarks[i]);
  const right = RIGHT_EYE.map((i) => landmarks[i]);
  return (eyeAspectRatio(left) + eyeAspectRatio(right)) / 2;
}

export function computeMAR(landmarks: Landmark[]): number {
  const top = landmarks[MOUTH_TOP];
  const bottom = landmarks[MOUTH_BOTTOM];
  const left = landmarks[MOUTH_LEFT];
  const right = landmarks[MOUTH_RIGHT];
  return dist(top, bottom) / dist(left, right);
}

// Total rotation of the head from its neutral/forward pose, derived from
// MediaPipe's facial transformation matrix. Using trace(R) keeps this
// robust to the matrix's row/col-major layout (trace is transpose-invariant)
// and to the non-unit scale baked into the matrix (each basis vector is
// re-normalized before the trace is taken).
export function computeHeadTiltDegrees(matrix: number[] | undefined): number {
  if (!matrix || matrix.length < 16) return 0;
  const basis = [
    [matrix[0], matrix[1], matrix[2]],
    [matrix[4], matrix[5], matrix[6]],
    [matrix[8], matrix[9], matrix[10]],
  ];
  let trace = 0;
  for (let i = 0; i < 3; i++) {
    const v = basis[i];
    const norm = Math.hypot(v[0], v[1], v[2]) || 1;
    trace += v[i] / norm;
  }
  const angle = Math.acos(Math.min(1, Math.max(-1, (trace - 1) / 2)));
  return (angle * 180) / Math.PI;
}
