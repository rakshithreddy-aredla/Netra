import type {
  RNMLKitFace,
  RNMLKitFaceLandmark,
} from '@infinitered/react-native-mlkit-face-detection';

export type DriverMetrics = {
  faceDetected: boolean;
  eyeOpenness: number | null;
  mouthOpenness: number | null;
  headTurn: number | null;
  headPitch: number | null;
  headRoll: number | null;
  faceCenterX: number | null;
  faceCenterY: number | null;
  faceSizeRatio: number | null;
};

export const EMPTY_METRICS: DriverMetrics = {
  faceDetected: false,
  eyeOpenness: null,
  mouthOpenness: null,
  headTurn: null,
  headPitch: null,
  headRoll: null,
  faceCenterX: null,
  faceCenterY: null,
  faceSizeRatio: null,
};

/**
 * Landmark identifiers as the native module actually emits them.
 *
 * Despite the declared `FaceLandmarkType` being camelCase strings, the module
 * hands JS **numeric** indices (verified on-device: a tracked face yields
 * types 0,1,3,4,5,6,7,9,10,11). The string names below are accepted too, so
 * this keeps working if the bridge ever switches to emitting them.
 */
const LANDMARK_INDEX: Record<string, number> = {
  bottomMouth: 0,
  leftCheek: 1,
  leftEar: 2,
  leftEye: 3,
  leftMouth: 4,
  noseBase: 5,
  rightCheek: 6,
  rightEar: 7,
  rightEye: 8,
  rightMouth: 9,
  leftEarTip: 10,
  rightEarTip: 11,
};

const normaliseLandmarkType = (type: string): string =>
  type.replace(/[_\s-]/g, '').toUpperCase();

/** Coerces a landmark type that arrived as a number or a numeric string. */
const numericIndex = (type: unknown): number | null => {
  if (typeof type === 'number' && Number.isFinite(type)) return type;
  if (typeof type === 'string' && /^\d+$/.test(type.trim())) return Number(type.trim());
  return null;
};

/**
 * Resolves a landmark by name. `types` accepts alternates because ML Kit
 * exposes both MOUTH_BOTTOM and BOTTOM_LIP, and it is not clear which one the
 * library's "bottomMouth" index (0) refers to.
 *
 * The bridge has been observed emitting the identifier as a number *and* as a
 * numeric string, so both are accepted rather than assumed.
 */
const landmarkPosition = (
  landmarks: RNMLKitFaceLandmark[],
  ...types: string[]
): { x: number; y: number } | null => {
  const names = new Set(types.map(normaliseLandmarkType));
  const indices = new Set(
    types.map((name) => LANDMARK_INDEX[name]).filter((n): n is number => n !== undefined),
  );

  return (
    landmarks.find((landmark) => {
      const type = landmark.type;
      if (type === null || type === undefined) return false;

      const index = numericIndex(type);
      if (index !== null) return indices.has(index);

      return names.has(normaliseLandmarkType(String(type)));
    })?.position ?? null
  );
};

const toPositive = (value: number | null | undefined): number | null =>
  value === null || value === undefined ? null : Math.abs(value);

export const extractDriverMetrics = (
  face: RNMLKitFace | undefined,
  imageWidth: number,
  imageHeight: number,
): DriverMetrics => {
  if (!face || imageWidth <= 0 || imageHeight <= 0) {
    return EMPTY_METRICS;
  }

  const leftEye = face.leftEyeOpenProbability ?? null;
  const rightEye = face.rightEyeOpenProbability ?? null;
  const eyeValues = [leftEye, rightEye].filter(
    (value): value is number => value !== null,
  );
  const eyeOpenness = eyeValues.length
    ? eyeValues.reduce((sum, value) => sum + value, 0) / eyeValues.length
    : null;

  const landmarks = face.landmarks ?? [];
  const noseBase = landmarkPosition(landmarks, 'noseBase');
  const bottomMouth = landmarkPosition(landmarks, 'bottomMouth', 'mouthBottom', 'bottomLip');
  const faceHeight = face.frame?.size?.y ?? 0;
  const mouthOpenness =
    noseBase && bottomMouth && faceHeight > 0
      ? Math.max(0, bottomMouth.y - noseBase.y) / faceHeight
      : null;

  const frameWidth = face.frame?.size?.x ?? 0;
  const faceCenterX =
    (face.frame.origin.x + frameWidth / 2) / imageWidth;
  const faceCenterY =
    (face.frame.origin.y + faceHeight / 2) / imageHeight;

  return {
    faceDetected: true,
    eyeOpenness,
    mouthOpenness,
    headTurn: toPositive(face.headEulerAngleY),
    headPitch: toPositive(face.headEulerAngleX),
    headRoll: toPositive(face.headEulerAngleZ),
    faceCenterX,
    faceCenterY,
    faceSizeRatio: imageWidth > 0 ? frameWidth / imageWidth : null,
  };
};