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

const matchesType = (
  actual: string | number | null | undefined,
  name: string,
  index: number,
): boolean => {
  if (actual === null || actual === undefined) {
    return false;
  }
  if (actual === name) {
    return true;
  }
  return Number(actual) === index;
};

const landmarkPosition = (
  landmarks: RNMLKitFaceLandmark[],
  name: string,
  index: number,
): { x: number; y: number } | null =>
  landmarks.find((landmark) => matchesType(landmark.type, name, index))?.position ??
  null;

const toPositive = (value: number | null | undefined): number | null =>
  value === null || value === undefined ? null : Math.abs(value);

export const extractDriverMetrics = (
  face: RNMLKitFace | undefined,
  imageWidth: number,
  imageHeight: number,
): DriverMetrics => {
  if (!face || imageWidth <= 0 || imageHeight <= 0) {
    return {
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
  }

  const leftEye = face.leftEyeOpenProbability ?? null;
  const rightEye = face.rightEyeOpenProbability ?? null;
  const eyeValues = [leftEye, rightEye].filter(
    (value): value is number => value !== null,
  );
  const eyeOpenness = eyeValues.length
    ? eyeValues.reduce((sum, value) => sum + value, 0) / eyeValues.length
    : null;

  const noseBase = landmarkPosition(face.landmarks, 'noseBase', LANDMARK_INDEX.noseBase);
  const bottomMouth = landmarkPosition(face.landmarks, 'bottomMouth', LANDMARK_INDEX.bottomMouth);
  const faceHeight = face.frame.size.y;
  const mouthOpenness =
    noseBase && bottomMouth && faceHeight > 0
      ? Math.max(0, bottomMouth.y - noseBase.y) / faceHeight
      : null;

  const faceCenterX =
    (face.frame.origin.x + face.frame.size.x / 2) / imageWidth;
  const faceCenterY =
    (face.frame.origin.y + face.frame.size.y / 2) / imageHeight;

  return {
    faceDetected: true,
    eyeOpenness,
    mouthOpenness,
    headTurn: toPositive(face.headEulerAngleY),
    headPitch: toPositive(face.headEulerAngleX),
    headRoll: toPositive(face.headEulerAngleZ),
    faceCenterX,
    faceCenterY,
    faceSizeRatio: face.frame.size.x / imageWidth,
  };
};
