import { SafetyEngine } from '../src/safety/SafetyEngine';
import type { DriverMetrics } from '../src/driverSignals';

const createMetrics = (overrides: Partial<DriverMetrics> = {}): DriverMetrics => ({
  faceDetected: true,
  eyeOpenness: 0.8,
  mouthOpenness: 0.1,
  headTurn: 5,
  headPitch: 3,
  headRoll: 2,
  faceCenterX: 0.5,
  faceCenterY: 0.4,
  faceSizeRatio: 0.6,
  ...overrides,
});

describe('SafetyEngine', () => {
  let engine: SafetyEngine;

  beforeEach(() => {
    engine = new SafetyEngine();
  });

  describe('processMetrics', () => {
    it('should return NORMAL when face is detected with normal metrics', () => {
      const metrics = createMetrics();
      const result = engine.processMetrics(metrics);

      expect(result.warningLevel).toBe(0);
      expect(result.activeDetection).toBeNull();
      expect(result.shouldDeductScore).toBe(false);
    });

    it('should return NORMAL and reset when face is not detected', () => {
      const metrics = createMetrics({ faceDetected: false });
      const result = engine.processMetrics(metrics);

      expect(result.warningLevel).toBe(0);
      expect(result.activeDetection).toBeNull();
    });

    it('should escalate warning when eye openness is below threshold', () => {
      const metrics = createMetrics({ eyeOpenness: 0.1 });
      const result = engine.processMetrics(metrics);

      expect(result.warningLevel).toBeGreaterThanOrEqual(1);
      expect(result.activeDetection).toBeTruthy();
    });

    it('should detect severe drowsiness when eye openness is very low', () => {
      const metrics = createMetrics({ eyeOpenness: 0.05 });
      const result = engine.processMetrics(metrics);

      expect(result.activeDetection).toBeTruthy();
      expect(result.warningLevel).toBeGreaterThanOrEqual(3);
    });

    it('should track repeated eye closure and set detection', () => {
      const metrics = createMetrics({ eyeOpenness: 0.1 });

      const result1 = engine.processMetrics(metrics);
      expect(result1.activeDetection).toBeTruthy();

      const result2 = engine.processMetrics(metrics);
      expect(result2.shouldDeductScore).toBe(false);
    });

    it('should reset state when face is re-detected after being lost', () => {
      const noFaceMetrics = createMetrics({ faceDetected: false });
      engine.processMetrics(noFaceMetrics);

      const faceMetrics = createMetrics({ eyeOpenness: 0.05 });
      const result = engine.processMetrics(faceMetrics);

      expect(result.warningLevel).toBeGreaterThanOrEqual(3);
    });
  });

  describe('reset', () => {
    it('should reset tracking state to initial values', () => {
      const metrics = createMetrics({ eyeOpenness: 0.1 });
      engine.processMetrics(metrics);

      engine.reset();
      const state = engine.getCurrentState();

      expect(state.eyeClosedStartTime).toBeNull();
      expect(state.severeDrowsinessStartTime).toBeNull();
      expect(state.yawnStartTime).toBeNull();
      expect(state.distractionStartTime).toBeNull();
      expect(state.lastEyeClosedScoreDeducted).toBe(false);
      expect(state.lastYawnScoreDeducted).toBe(false);
      expect(state.lastDistractionScoreDeducted).toBe(false);
    });
  });

  describe('getCurrentState', () => {
    it('should return a copy of the current state', () => {
      const metrics = createMetrics({ eyeOpenness: 0.1 });
      engine.processMetrics(metrics);

      const state1 = engine.getCurrentState();
      const state2 = engine.getCurrentState();

      expect(state1).not.toBe(state2);
      expect(state1).toEqual(state2);
    });
  });
});