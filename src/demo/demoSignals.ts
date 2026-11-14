import type { DriverMetrics } from '../driverSignals';

/**
 * Demo signal source.
 *
 * The naive version of this re-randomised every metric on every tick, which
 * meant no condition ever lasted long enough to cross a duration threshold —
 * eye openness could not even reach the severe-drowsiness cutoff. The engine
 * therefore stayed at NORMAL forever and the demo showed nothing.
 *
 * Instead the generator picks a *scenario* and holds it for several seconds,
 * so the real escalation path (MILD -> MODERATE -> SEVERE -> CRITICAL) is
 * actually exercised.
 */

type Scenario = 'alert' | 'yawn' | 'distracted' | 'unseen' | 'normal';

const SCENARIOS: Scenario[] = [
  'normal',
  'alert',
  'normal',
  'yawn',
  'normal',
  'distracted',
  'normal',
  'unseen',
];

/** Long enough to clear the longest gate (severe drowsiness at 2500ms). */
const SCENARIO_DURATION_MS = 6000;
/** Settled time between scenarios, so the UI visibly recovers. */
const SCENARIO_GAP_MS = 3500;

export class DemoSignalSource {
  private scenario: Scenario = 'normal';
  private scenarioStartedAt = 0;
  private index = 0;
  private now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  reset(): void {
    this.scenario = 'normal';
    this.scenarioStartedAt = 0;
    this.index = 0;
  }

  /** True while a non-normal scenario is being held, for the UI badge. */
  get currentScenario(): Scenario {
    return this.scenario;
  }

  next(): DriverMetrics {
    const now = this.now();

    // Hold each scenario long enough for the engine to escalate through it,
    // then settle back to normal so the recovery path is visible too.
    const limit = this.scenario === 'normal' ? SCENARIO_GAP_MS : SCENARIO_DURATION_MS;
    if (now - this.scenarioStartedAt > limit) {
      this.scenarioStartedAt = now;
      this.scenario =
        this.scenario === 'normal'
          ? SCENARIOS[this.index++ % SCENARIOS.length]
          : 'normal';
    }

    return this.metricsFor(this.scenario);
  }

  private metricsFor(scenario: Scenario): DriverMetrics {
    // Small jitter keeps it looking organic without breaking a threshold.
    const jitter = (amount: number) => (Math.random() - 0.5) * amount;

    const base: Record<Scenario, DriverMetrics> = {
      // Eyes drifting shut: sustained below the severe threshold.
      alert: {
        faceDetected: true,
        eyeOpenness: 0.05 + jitter(0.04),
        mouthOpenness: 0.12,
        headTurn: 4,
        headPitch: 3,
        headRoll: 2,
        faceCenterX: 0.5,
        faceCenterY: 0.4,
        faceSizeRatio: 0.6,
      },
      yawn: {
        faceDetected: true,
        eyeOpenness: 0.72,
        mouthOpenness: 0.42 + jitter(0.08),
        headTurn: 4,
        headPitch: 3,
        headRoll: 2,
        faceCenterX: 0.5,
        faceCenterY: 0.4,
        faceSizeRatio: 0.6,
      },
      distracted: {
        faceDetected: true,
        eyeOpenness: 0.75,
        mouthOpenness: 0.12,
        headTurn: 32 + jitter(8),
        headPitch: 6,
        headRoll: 3,
        faceCenterX: 0.36,
        faceCenterY: 0.4,
        faceSizeRatio: 0.6,
      },
      // Driver turns far enough that ML Kit loses the face entirely.
      unseen: {
        faceDetected: false,
        eyeOpenness: null,
        mouthOpenness: null,
        headTurn: null,
        headPitch: null,
        headRoll: null,
        faceCenterX: null,
        faceCenterY: null,
        faceSizeRatio: null,
      },
      normal: {
        faceDetected: true,
        eyeOpenness: 0.82 + jitter(0.12),
        mouthOpenness: 0.11 + jitter(0.04),
        headTurn: 6 + jitter(6),
        headPitch: 3 + jitter(4),
        headRoll: 2,
        faceCenterX: 0.5,
        faceCenterY: 0.4,
        faceSizeRatio: 0.6,
      },
    };

    return base[scenario];
  }
}