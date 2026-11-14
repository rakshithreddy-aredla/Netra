import { SafetyEngine } from '../src/safety/SafetyEngine';
import type { DriverMetrics } from '../src/driverSignals';
import { WarningLevel, DetectionType } from '../src/types/SafetyTypes';

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

/** Triggers eyes-closed but stays above the severe-drowsiness threshold. */
const EYES_HALF_CLOSED = 0.27;
/** Below `severeEyeOpennessThreshold` (0.15). */
const EYES_SHUT = 0.05;

/**
 * The engine is driven by explicit timestamps, so these tests advance a clock by
 * hand rather than mocking timers. Every duration threshold is genuinely
 * exercised instead of collapsing to zero as it did before.
 */
class Clock {
  constructor(private now = 1_000_000) {}

  at(): number {
    return this.now;
  }

  advance(ms: number): number {
    this.now += ms;
    return this.now;
  }
}

describe('SafetyEngine', () => {
  let engine: SafetyEngine;
  let clock: Clock;

  beforeEach(() => {
    engine = new SafetyEngine();
    clock = new Clock();
  });

  const step = (metrics: DriverMetrics, elapsedMs: number) => {
    clock.advance(elapsedMs);
    return engine.processMetrics(metrics, clock.at());
  };

  describe('normal operation', () => {
    it('reports nothing while the driver is alert', () => {
      const result = step(createMetrics(), 0);

      expect(result.warningLevel).toBe(WarningLevel.NORMAL);
      expect(result.activeDetection).toBeNull();
      expect(result.shouldDeductScore).toBe(false);
      expect(result.deductions).toHaveLength(0);
    });

    it('holds an episode latched while the metric sits between trigger and clear', () => {
      step(createMetrics({ eyeOpenness: EYES_HALF_CLOSED }), 0);
      step(createMetrics({ eyeOpenness: EYES_HALF_CLOSED }), 1600);

      // 0.32 is above the 0.30 trigger but below the 0.45 clear threshold, so
      // the episode must survive rather than flapping off and on.
      const result = step(createMetrics({ eyeOpenness: 0.32 }), 100);

      expect(result.activeDetection).toBe(DetectionType.EYES_CLOSED);
      expect(result.warningLevel).toBe(WarningLevel.MODERATE);
    });
  });

  describe('eyes closed', () => {
    it('escalates NORMAL -> MILD -> MODERATE as the duration crosses each gate', () => {
      expect(
        step(createMetrics({ eyeOpenness: EYES_HALF_CLOSED }), 0).warningLevel,
      ).toBe(WarningLevel.NORMAL);

      const mild = step(createMetrics({ eyeOpenness: EYES_HALF_CLOSED }), 800);
      expect(mild.activeDetection).toBe(DetectionType.EYES_CLOSED);
      expect(mild.warningLevel).toBe(WarningLevel.MILD);
      expect(mild.shouldDeductScore).toBe(false);

      const moderate = step(createMetrics({ eyeOpenness: EYES_HALF_CLOSED }), 800);
      expect(moderate.warningLevel).toBe(WarningLevel.MODERATE);
      expect(moderate.shouldDeductScore).toBe(true);
    });

    it('clears only once openness passes the clear threshold', () => {
      step(createMetrics({ eyeOpenness: EYES_HALF_CLOSED }), 0);
      step(createMetrics({ eyeOpenness: EYES_HALF_CLOSED }), 1000);

      // Above the trigger, still below the clear threshold.
      expect(
        step(createMetrics({ eyeOpenness: 0.4 }), 1000).activeDetection,
      ).toBe(DetectionType.EYES_CLOSED);

      expect(step(createMetrics({ eyeOpenness: 0.5 }), 100).activeDetection).toBeNull();
    });

    it('deducts exactly once per episode, not once per frame', () => {
      step(createMetrics({ eyeOpenness: EYES_HALF_CLOSED }), 0);
      const first = step(createMetrics({ eyeOpenness: EYES_HALF_CLOSED }), 1600);
      expect(first.shouldDeductScore).toBe(true);

      // Ten further frames of a sustained half-closed eye must not drain score.
      for (let i = 0; i < 10; i += 1) {
        const result = step(createMetrics({ eyeOpenness: EYES_HALF_CLOSED }), 1000);
        expect(result.shouldDeductScore).toBe(false);
        expect(result.deductions).toHaveLength(0);
      }
    });

    it('re-opens and deducts again after the eyes reopen', () => {
      step(createMetrics({ eyeOpenness: EYES_HALF_CLOSED }), 0);
      expect(
        step(createMetrics({ eyeOpenness: EYES_HALF_CLOSED }), 1600).shouldDeductScore,
      ).toBe(true);

      step(createMetrics({ eyeOpenness: 0.8 }), 100);

      expect(
        step(createMetrics({ eyeOpenness: EYES_HALF_CLOSED }), 0).shouldDeductScore,
      ).toBe(false);
      expect(
        step(createMetrics({ eyeOpenness: EYES_HALF_CLOSED }), 1600).shouldDeductScore,
      ).toBe(true);
    });
  });

  describe('severe drowsiness', () => {
    it('deducts only once no matter how long it lasts', () => {
      const metrics = createMetrics({ eyeOpenness: EYES_SHUT });

      expect(step(metrics, 0).warningLevel).toBe(WarningLevel.SEVERE);

      const triggering = step(metrics, 2600);
      expect(triggering.warningLevel).toBe(WarningLevel.CRITICAL);
      expect(triggering.shouldDeductScore).toBe(true);
      expect(triggering.deductions).toHaveLength(1);

      // The regression this suite exists for: ten further frames of a fully
      // shut-eyed driver must produce no further deductions.
      for (let i = 0; i < 10; i += 1) {
        const result = step(metrics, 1000);
        expect(result.shouldDeductScore).toBe(false);
        expect(result.deductions).toHaveLength(0);
        expect(result.warningLevel).toBe(WarningLevel.CRITICAL);
      }
    });

    it('reports the real episode duration when it closes', () => {
      const metrics = createMetrics({ eyeOpenness: EYES_SHUT });
      step(metrics, 0);
      step(metrics, 2600);

      const closed = step(createMetrics(), 1000);
      const episode = closed.closedEpisodes.find(
        (e) => e.type === DetectionType.SEVERE_DROWSINESS,
      );

      expect(episode).toBeDefined();
      expect(episode!.durationMs).toBe(3600);
      expect(episode!.peakSeverity).toBe(WarningLevel.CRITICAL);
    });
  });

  describe('simultaneous detections', () => {
    it('deducts for both eyes-closed and yawn in the same frame', () => {
      // Yawns are judged against this driver's own closed-mouth baseline, so
      // establish one before opening the mouth.
      step(createMetrics({ eyeOpenness: EYES_HALF_CLOSED, mouthOpenness: 0.3 }), 0);

      const both = createMetrics({
        eyeOpenness: EYES_HALF_CLOSED,
        mouthOpenness: 0.42,
      });
      step(both, 0);
      const result = step(both, 2100);

      expect(result.deductions.map((d) => d.type).sort()).toEqual(
        [DetectionType.EYES_CLOSED, DetectionType.YAWN].sort(),
      );
      expect(result.shouldDeductScore).toBe(true);
    });

    it('learns a closed-mouth baseline and does not call it a yawn', () => {
      // A driver whose mouth simply sits at 0.34 must never alarm.
      for (let i = 0; i < 30; i += 1) {
        const result = step(createMetrics({ mouthOpenness: 0.34 }), 500);
        expect(result.activeDetection).toBeNull();
        expect(result.shouldDeductScore).toBe(false);
      }
    });

    it('fires when the mouth opens well past the learned baseline', () => {
      for (let i = 0; i < 20; i += 1) {
        step(createMetrics({ mouthOpenness: 0.34 }), 500);
      }

      const yawning = createMetrics({ mouthOpenness: 0.46 });
      expect(step(yawning, 0).shouldDeductScore).toBe(false);
      const result = step(yawning, 2100);

      expect(result.activeDetection).toBe(DetectionType.YAWN);
      expect(result.shouldDeductScore).toBe(true);
    });

    it('scales to drivers with different anatomy', () => {
      // A large-mouthed driver with a 0.45 baseline should still be detected
      // at the same *relative* opening as a small-mouthed one.
      for (let i = 0; i < 20; i += 1) {
        step(createMetrics({ mouthOpenness: 0.45 }), 500);
      }

      step(createMetrics({ mouthOpenness: 0.56 }), 0);
      const result = step(createMetrics({ mouthOpenness: 0.56 }), 2100);
      expect(result.activeDetection).toBe(DetectionType.YAWN);
    });

    it('lets the most severe detection drive the warning level', () => {
      const metrics = createMetrics({
        eyeOpenness: EYES_SHUT,
        mouthOpenness: 0.4,
        headTurn: 30,
      });

      step(metrics, 0);
      const result = step(metrics, 3000);

      expect(result.activeDetection).toBe(DetectionType.SEVERE_DROWSINESS);
      expect(result.warningLevel).toBe(WarningLevel.CRITICAL);
      expect(result.deductions.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('distraction', () => {
    it('requires the duration to elapse before warning', () => {
      const away = createMetrics({ headTurn: 30 });

      expect(step(away, 0).warningLevel).toBe(WarningLevel.NORMAL);
      expect(step(away, 2100).activeDetection).toBe(DetectionType.DISTRACTION);
    });

    it('stays latched while the head eases back toward centre', () => {
      step(createMetrics({ headTurn: 30 }), 0);

      // 18 degrees is below the 20 trigger but above the 14 clear threshold.
      expect(step(createMetrics({ headTurn: 18 }), 3000).activeDetection).toBe(
        DetectionType.DISTRACTION,
      );
    });
  });

  describe('face loss', () => {
    it('bridges a short dropout without discarding eye-closed progress', () => {
      step(createMetrics({ eyeOpenness: EYES_SHUT }), 0);

      step(createMetrics({ faceDetected: false }), 0);
      const lost = step(createMetrics({ faceDetected: false }), 2000);

      expect(lost.faceLostDurationMs).toBe(2000);
      expect(lost.activeDetection).toBe(DetectionType.SEVERE_DROWSINESS);

      // The face returns and the same episode is still running, now critical.
      const back = step(createMetrics({ eyeOpenness: EYES_SHUT }), 1000);
      expect(back.warningLevel).toBe(WarningLevel.CRITICAL);
    });

    it('raises FACE_UNSEEN once the grace window expires', () => {
      step(createMetrics({ faceDetected: false }), 0);
      const result = step(createMetrics({ faceDetected: false }), 3100);

      expect(result.activeDetection).toBe(DetectionType.FACE_UNSEEN);
      expect(result.shouldDeductScore).toBe(true);
      expect(result.deductions.map((d) => d.type)).toEqual([DetectionType.FACE_UNSEEN]);
    });

    it('makes a fully-turned-away driver detectable', () => {
      // ML Kit loses the face entirely when the driver turns away, which used to
      // make that case permanently invisible to the safety engine.
      step(createMetrics({ faceDetected: false }), 0);
      const result = step(createMetrics({ faceDetected: false }), 4000);

      expect(result.activeDetection).toBe(DetectionType.FACE_UNSEEN);
    });

    it('clears FACE_UNSEEN when the face returns', () => {
      step(createMetrics({ faceDetected: false }), 0);
      step(createMetrics({ faceDetected: false }), 4000);

      const result = step(createMetrics(), 100);

      expect(result.activeDetection).toBeNull();
      expect(result.faceLostDurationMs).toBeNull();
    });

    it('survives a dropout that follows a closed episode', () => {
      // Regression: a closed episode used to be left in the map as an
      // `undefined` value, and the face-lost grace path dereferenced it —
      // crashing the app the moment the driver's face dropped out.
      step(createMetrics({ eyeOpenness: EYES_SHUT }), 0);
      step(createMetrics({ eyeOpenness: EYES_SHUT }), 3000);
      step(createMetrics(), 100);

      expect(() => {
        step(createMetrics({ faceDetected: false }), 0);
        step(createMetrics({ faceDetected: false }), 2000);
      }).not.toThrow();
    });

    it('leaves no dangling keys behind after episodes close', () => {
      step(createMetrics({ eyeOpenness: EYES_SHUT }), 0);
      step(createMetrics({ eyeOpenness: EYES_SHUT }), 3000);
      step(createMetrics(), 100);

      const entries = Object.entries(engine.getCurrentState().episodes);
      entries.forEach(([, episode]) => {
        expect(episode).toBeDefined();
      });
    });
  });

  describe('reset', () => {
    it('clears every open episode', () => {
      step(createMetrics({ eyeOpenness: EYES_SHUT }), 0);
      engine.reset();

      const state = engine.getCurrentState();
      expect(state.episodes).toEqual({});
      expect(state.faceLostStartTime).toBeNull();
    });
  });

  describe('getCurrentState', () => {
    it('returns a copy, not the live object', () => {
      step(createMetrics({ eyeOpenness: EYES_SHUT }), 0);

      const first = engine.getCurrentState();
      const second = engine.getCurrentState();

      expect(first).not.toBe(second);
      expect(first).toEqual(second);
    });
  });
});