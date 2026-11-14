import { extractDriverMetrics, EMPTY_METRICS } from '../src/driverSignals';
import type { RNMLKitFace, RNMLKitFaceLandmark } from '@infinitered/react-native-mlkit-face-detection';

const landmark = (
  type: RNMLKitFaceLandmark['type'],
  x: number,
  y: number,
): RNMLKitFaceLandmark => ({ type, position: { x, y } });

const makeFace = (overrides: Partial<RNMLKitFace> = {}): RNMLKitFace =>
  ({
    frame: { origin: { x: 100, y: 50 }, size: { x: 200, y: 400 } },
    landmarks: [
      landmark('noseBase', 150, 200),
      landmark('bottomMouth', 150, 280),
    ],
    contours: [],
    hasTrackingID: false,
    hasHeadEulerAngleX: true,
    headEulerAngleX: -10,
    hasHeadEulerAngleY: true,
    headEulerAngleY: 25,
    hasHeadEulerAngleZ: true,
    headEulerAngleZ: 4,
    hasSmilingProbability: false,
    hasLeftEyeOpenProbability: true,
    leftEyeOpenProbability: 0.9,
    hasRightEyeOpenProbability: true,
    rightEyeOpenProbability: 0.7,
    ...overrides,
  }) as unknown as RNMLKitFace;

describe('extractDriverMetrics', () => {
  it('returns empty metrics when no face is present', () => {
    expect(extractDriverMetrics(undefined, 640, 480)).toEqual(EMPTY_METRICS);
    expect(extractDriverMetrics(undefined, 640, 480).faceDetected).toBe(false);
  });

  it('returns empty metrics for a zero-sized image', () => {
    expect(extractDriverMetrics(makeFace(), 0, 480)).toEqual(EMPTY_METRICS);
    expect(extractDriverMetrics(makeFace(), 640, 0)).toEqual(EMPTY_METRICS);
  });

  it('averages the two eye openness probabilities', () => {
    const metrics = extractDriverMetrics(makeFace(), 640, 480);

    expect(metrics.eyeOpenness).toBeCloseTo(0.8);
  });

  it('uses a single eye when only one is available', () => {
    const face = makeFace({ rightEyeOpenProbability: null });
    expect(extractDriverMetrics(face, 640, 480).eyeOpenness).toBe(0.9);
  });

  it('nulls eye openness when neither eye reports', () => {
    const face = makeFace({ rightEyeOpenProbability: null, leftEyeOpenProbability: null });
    expect(extractDriverMetrics(face, 640, 480).eyeOpenness).toBeNull();
  });

  it('derives mouth openness from nose-to-bottom-lip distance over face height', () => {
    const metrics = extractDriverMetrics(makeFace(), 640, 480);

    // 280 - 200 = 80px over a 400px tall face.
    expect(metrics.mouthOpenness).toBeCloseTo(0.2);
  });

  it('nulls mouth openness when the landmarks are missing', () => {
    const face = makeFace({ landmarks: [] });
    expect(extractDriverMetrics(face, 640, 480).mouthOpenness).toBeNull();
  });

  describe('landmark name conventions', () => {
    // Captured from a real device: a tracked face produced landmark types
    // 0,1,3,4,5,6,7,9,10,11 — numeric indices, not the camelCase strings the
    // library's types advertise. noseBase is 5, bottomMouth is 0.
    it('reads landmarks the native module emits as numeric indices', () => {
      const face = makeFace({
        landmarks: [
          { type: 0 as unknown as RNMLKitFaceLandmark['type'], position: { x: 150, y: 280 } },
          { type: 5 as unknown as RNMLKitFaceLandmark['type'], position: { x: 150, y: 200 } },
        ],
      });

      const metrics = extractDriverMetrics(face, 640, 480);
      expect(metrics.mouthOpenness).toBeCloseTo(0.2);
    });

    it('resolves a full real-world landmark set', () => {
      const observed = [0, 1, 3, 4, 5, 6, 7, 9, 10, 11];
      const face = makeFace({
        landmarks: observed.map((index) => ({
          type: index as unknown as RNMLKitFaceLandmark['type'],
          position: { x: 100 + index * 10, y: index === 0 ? 280 : index === 5 ? 200 : 150 },
        })),
      });

      expect(extractDriverMetrics(face, 640, 480).mouthOpenness).toBeCloseTo(0.2);
    });

    it('reads landmarks emitted as numeric strings', () => {
      const face = makeFace({
        landmarks: [
          { type: '0' as unknown as RNMLKitFaceLandmark['type'], position: { x: 150, y: 280 } },
          { type: '5' as unknown as RNMLKitFaceLandmark['type'], position: { x: 150, y: 200 } },
        ],
      });

      expect(extractDriverMetrics(face, 640, 480).mouthOpenness).toBeCloseTo(0.2);
    });

    it('reads landmarks emitted in UPPER_SNAKE_CASE', () => {
      const face = makeFace({
        landmarks: [
          landmark('NOSE_BASE' as RNMLKitFaceLandmark['type'], 150, 200),
          landmark('MOUTH_BOTTOM' as RNMLKitFaceLandmark['type'], 150, 280),
        ],
      });

      expect(extractDriverMetrics(face, 640, 480).mouthOpenness).toBeCloseTo(0.2);
    });

    it('still accepts the camelCase names the types advertise', () => {
      expect(extractDriverMetrics(makeFace(), 640, 480).mouthOpenness).toBeCloseTo(0.2);
    });
  });

  it('resolves landmarks by their string type', () => {
    // The old implementation carried a fabricated numeric index table, which
    // silently resolved whatever the native layer returned. An unrecognised
    // type must now simply fail to match — the cast simulates a value the
    // native module could return despite the declared union.
    const face = makeFace({
      landmarks: [
        landmark('someUnknownType' as RNMLKitFaceLandmark['type'], 150, 200),
      ],
    });
    expect(extractDriverMetrics(face, 640, 480).mouthOpenness).toBeNull();
  });

  it('normalises face centre and size against the image dimensions', () => {
    const metrics = extractDriverMetrics(makeFace(), 640, 480);

    expect(metrics.faceCenterX).toBeCloseTo((100 + 100) / 640);
    expect(metrics.faceCenterY).toBeCloseTo((50 + 200) / 480);
    expect(metrics.faceSizeRatio).toBeCloseTo(200 / 640);
  });

  it('reports head angles as magnitudes', () => {
    const metrics = extractDriverMetrics(makeFace(), 640, 480);

    expect(metrics.headTurn).toBe(25);
    expect(metrics.headPitch).toBe(10);
    expect(metrics.headRoll).toBe(4);
  });

  it('nulls head angles when ML Kit did not estimate them', () => {
    const face = makeFace({
      headEulerAngleX: null,
      headEulerAngleY: null,
      headEulerAngleZ: null,
    });
    const metrics = extractDriverMetrics(face, 640, 480);

    expect(metrics.headTurn).toBeNull();
    expect(metrics.headPitch).toBeNull();
    expect(metrics.headRoll).toBeNull();
  });
});