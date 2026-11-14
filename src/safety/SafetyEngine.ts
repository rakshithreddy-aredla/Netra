import type { DriverMetrics } from '../driverSignals';
import type {
  SafetyEngineConfig,
  SafetyEngineResult,
  Deduction,
  ClosedEpisode,
  DetectionType as DetectionTypeT,
} from '../types/SafetyTypes';
import {
  DEFAULT_CONFIG,
  WarningLevel,
  DetectionType,
} from '../types/SafetyTypes';

export type { Deduction, ClosedEpisode };

type Episode = {
  id: string;
  startedAt: number;
  peakSeverity: WarningLevel;
  scoreDeducted: boolean;
};

export interface TrackingState {
  episodes: Partial<Record<DetectionTypeT, Episode>>;
  faceLostStartTime: number | null;
  /** This driver's learned closed-mouth baseline. */
  mouthBaseline: number | null;
}

/**
 * How fast the baseline adapts. Deliberately slow: a yawn is a brief excursion,
 * so the running mean is dominated by closed-mouth frames and barely moves
 * during one.
 */
const MOUTH_BASELINE_ALPHA = 0.03;

const MAX = (a: WarningLevel, b: WarningLevel): WarningLevel =>
  a > b ? a : b;

const episodeId = (type: DetectionTypeT, startedAt: number): string =>
  `${type}@${startedAt}`;

/**
 * Turns a stream of raw face metrics into escalating safety warnings.
 *
 * Each signal (eyes, severe drowsiness, yawn, head turn, face visibility) runs
 * through the same latch: it opens an episode when the metric crosses its
 * trigger threshold, holds it until the metric moves back past a separate clear
 * threshold (hysteresis), and reports the episode's duration when it closes.
 *
 * The engine is pure with respect to the outside world — it takes metrics and a
 * timestamp and returns what happened. All side effects (sound, haptics, score)
 * are the caller's job.
 */
export class SafetyEngine {
  private config: SafetyEngineConfig;
  private state: TrackingState;

  constructor(config: Partial<SafetyEngineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = { episodes: {}, faceLostStartTime: null, mouthBaseline: null };
  }

  reset(): void {
    this.state = { episodes: {}, faceLostStartTime: null, mouthBaseline: null };
  }

  getConfig(): SafetyEngineConfig {
    return { ...this.config };
  }

  getCurrentState(): TrackingState {
    return {
      episodes: { ...this.state.episodes },
      faceLostStartTime: this.state.faceLostStartTime,
      mouthBaseline: this.state.mouthBaseline,
    };
  }

  processMetrics(metrics: DriverMetrics, now: number = Date.now()): SafetyEngineResult {
    const deductions: Deduction[] = [];
    const closedEpisodes: ClosedEpisode[] = [];

    if (!metrics.faceDetected) {
      return this.processFaceLost(now, deductions, closedEpisodes);
    }

    // Face is back: stop accruing a face-loss episode, but leave the other
    // signals alone so a brief dropout doesn't discard their progress.
    this.state.faceLostStartTime = null;
    this.closeEpisode(DetectionType.FACE_UNSEEN, now, closedEpisodes);

    const candidates: { type: DetectionTypeT; severity: WarningLevel }[] = [];

    // --- Eyes closed -------------------------------------------------------
    // Severe drowsiness is a strict subset of eyes-closed, so it is evaluated
    // first and wins the warning level when both are active.
    const eyeSeverity = this.evaluateSignal({
      now,
      type: DetectionType.SEVERE_DROWSINESS,
      triggered:
        metrics.eyeOpenness !== null &&
        metrics.eyeOpenness < this.config.severeEyeOpennessThreshold,
      cleared:
        metrics.eyeOpenness !== null &&
        metrics.eyeOpenness >= this.config.severeEyeOpennessClearThreshold,
      severityForDuration: (elapsed) =>
        elapsed >= this.config.severeDrowsinessDurationMs
          ? WarningLevel.CRITICAL
          : WarningLevel.SEVERE,
      deductAt: WarningLevel.CRITICAL,
      deductions,
      closedEpisodes,
    });
    if (eyeSeverity !== null) {
      candidates.push({ type: DetectionType.SEVERE_DROWSINESS, severity: eyeSeverity });
    }

    const closedSeverity = this.evaluateSignal({
      now,
      type: DetectionType.EYES_CLOSED,
      triggered:
        metrics.eyeOpenness !== null &&
        metrics.eyeOpenness < this.config.eyeClosedThreshold,
      cleared:
        metrics.eyeOpenness !== null &&
        metrics.eyeOpenness >= this.config.eyeClosedClearThreshold,
      severityForDuration: (elapsed) => {
        if (elapsed >= this.config.eyeClosedDurationMs) return WarningLevel.MODERATE;
        if (elapsed >= this.config.eyeClosedDurationMs / 2) return WarningLevel.MILD;
        return null;
      },
      deductAt: WarningLevel.MODERATE,
      // Fully-shut eyes are already accounted for by severe drowsiness; charging
      // both would penalise a single physical event twice.
      deductEnabled: eyeSeverity === null,
      deductions,
      closedEpisodes,
    });
    if (closedSeverity !== null) {
      candidates.push({ type: DetectionType.EYES_CLOSED, severity: closedSeverity });
    }

    // --- Yawn --------------------------------------------------------------
    const mouth = this.updateMouthBaseline(metrics.mouthOpenness);
    const yawnSeverity = this.evaluateSignal({
      now,
      type: DetectionType.YAWN,
      triggered: mouth.isYawn,
      cleared: mouth.isSettled,
      severityForDuration: (elapsed) =>
        elapsed >= this.config.yawnDurationMs ? WarningLevel.MODERATE : null,
      deductAt: WarningLevel.MODERATE,
      deductions,
      closedEpisodes,
    });
    if (yawnSeverity !== null) {
      candidates.push({ type: DetectionType.YAWN, severity: yawnSeverity });
    }

    // --- Distraction -------------------------------------------------------
    const distractionSeverity = this.evaluateSignal({
      now,
      type: DetectionType.DISTRACTION,
      triggered:
        metrics.headTurn !== null &&
        metrics.headTurn > this.config.distractionAngleThreshold,
      cleared:
        metrics.headTurn !== null &&
        metrics.headTurn <= this.config.distractionClearThreshold,
      severityForDuration: (elapsed) =>
        elapsed >= this.config.distractionDurationMs ? WarningLevel.MILD : null,
      deductAt: WarningLevel.MILD,
      deductions,
      closedEpisodes,
    });
    if (distractionSeverity !== null) {
      candidates.push({ type: DetectionType.DISTRACTION, severity: distractionSeverity });
    }

    return this.buildResult(candidates, deductions, closedEpisodes, null);
  }

  /**
   * The face vanished. Short dropouts are bridged; once the grace window
   * expires the driver is treated as not visible at all, which is also how
   * "looking away so far the face leaves frame" finally becomes detectable.
   */
  private processFaceLost(
    now: number,
    deductions: Deduction[],
    closedEpisodes: ClosedEpisode[],
  ): SafetyEngineResult {
    if (this.state.faceLostStartTime === null) {
      this.state.faceLostStartTime = now;
    }
    const lostMs = now - this.state.faceLostStartTime;

    if (lostMs < this.config.faceLostGraceMs) {
      // Still inside the grace window: hold every open episode open and
      // report the warning level accumulated so far.
      const held = Object.entries(this.state.episodes)
        .filter((entry): entry is [DetectionTypeT, Episode] => !!entry[1])
        .map(([type, episode]) => ({
          type,
          severity: episode.peakSeverity,
        }));
      return this.buildResult(held, deductions, closedEpisodes, lostMs);
    }

    // Grace expired — the other signals can no longer be trusted. Close them.
    this.closeAllEpisodes(now, closedEpisodes);

    const unseenSeverity = this.evaluateSignal({
      now,
      type: DetectionType.FACE_UNSEEN,
      triggered: true,
      cleared: false,
      severityForDuration: () => WarningLevel.MODERATE,
      deductAt: WarningLevel.MODERATE,
      deductions,
      closedEpisodes,
    });

    const candidates =
      unseenSeverity === null
        ? []
        : [{ type: DetectionType.FACE_UNSEEN, severity: unseenSeverity }];

    return this.buildResult(candidates, deductions, closedEpisodes, lostMs);
  }

  /**
   * Learns this driver's closed-mouth baseline and judges yawns against it.
   *
   * The raw metric is nose-base-to-lower-lip distance over face height. That is
   * a large anatomical number even when the mouth is shut, and it scales with
   * face shape and camera distance, so a single absolute threshold cannot work
   * for everyone. The configured absolute values remain as a floor for the very
   * first frames, before a baseline exists.
   */
  private updateMouthBaseline(
    mouthOpenness: number | null,
  ): { isYawn: boolean; isSettled: boolean; baseline: number | null } {
    if (mouthOpenness === null) {
      return { isYawn: false, isSettled: false, baseline: this.state.mouthBaseline };
    }

    if (this.state.mouthBaseline === null) {
      this.state.mouthBaseline = mouthOpenness;
    } else {
      this.state.mouthBaseline +=
        MOUTH_BASELINE_ALPHA * (mouthOpenness - this.state.mouthBaseline);
    }

    const baseline = this.state.mouthBaseline;
    const trigger = Math.max(
      baseline * this.config.yawnBaselineRatio,
      this.config.yawnThreshold,
    );
    const clear = Math.max(
      baseline * this.config.yawnClearRatio,
      this.config.yawnClearThreshold,
    );

    return {
      isYawn: mouthOpenness > trigger,
      isSettled: mouthOpenness <= clear,
      baseline,
    };
  }

  /** The baseline currently in effect, for UI diagnostics. */
  getMouthBaseline(): number | null {
    return this.state.mouthBaseline;
  }

  private buildResult(
    candidates: { type: DetectionTypeT; severity: WarningLevel }[],
    deductions: Deduction[],
    closedEpisodes: ClosedEpisode[],
    faceLostDurationMs: number | null,
  ): SafetyEngineResult {
    let warningLevel = WarningLevel.NORMAL;
    let activeDetection: DetectionTypeT | null = null;
    let detectionType: DetectionTypeT | undefined;

    for (const candidate of candidates) {
      if (candidate.severity > warningLevel) {
        warningLevel = candidate.severity;
        activeDetection = candidate.type;
        detectionType = candidate.type;
      }
    }

    return {
      warningLevel,
      activeDetection,
      shouldDeductScore: deductions.length > 0,
      deductions,
      closedEpisodes,
      detectionType,
      faceLostDurationMs,
    };
  }

  /**
   * The shared latch. Opens an episode on trigger, holds it until the clear
   * threshold is crossed (hysteresis), and deducts at most once per episode.
   */
  private evaluateSignal(options: {
    now: number;
    type: DetectionTypeT;
    triggered: boolean;
    cleared: boolean;
    severityForDuration: (elapsed: number) => WarningLevel | null;
    deductAt: WarningLevel;
    /**
     * Set false when another signal already accounts for this same physical
     * event, so one incident is never charged twice.
     */
    deductEnabled?: boolean;
    deductions: Deduction[];
    closedEpisodes: ClosedEpisode[];
  }): WarningLevel | null {
    const { now, type, triggered, cleared, severityForDuration } = options;
    const deductEnabled = options.deductEnabled ?? true;
    const existing = this.state.episodes[type];

    // Nothing open and nothing triggering: stay quiet.
    if (!existing) {
      if (!triggered) return null;
    }

    if (existing && cleared) {
      this.closeEpisode(type, now, options.closedEpisodes);
      return null;
    }

    if (!this.state.episodes[type]) {
      const startedAt = now;
      this.state.episodes[type] = {
        id: episodeId(type, startedAt),
        startedAt,
        peakSeverity: WarningLevel.NORMAL,
        scoreDeducted: false,
      };
    }

    const episode = this.state.episodes[type]!;
    const severity = severityForDuration(now - episode.startedAt);

    if (severity === null) {
      return episode.peakSeverity > WarningLevel.NORMAL
        ? episode.peakSeverity
        : null;
    }

    episode.peakSeverity = MAX(episode.peakSeverity, severity);

    // Deduct exactly once per episode, and only once the episode is severe
    // enough to warrant it — a brief dip to MILD is a warning, not a penalty.
    if (deductEnabled && !episode.scoreDeducted && episode.peakSeverity >= options.deductAt) {
      episode.scoreDeducted = true;
      options.deductions.push({
        id: episode.id,
        type,
        severity: episode.peakSeverity,
        startedAt: episode.startedAt,
      });
    }

    return episode.peakSeverity;
  }

  private closeEpisode(
    type: DetectionTypeT,
    now: number,
    closedEpisodes: ClosedEpisode[],
  ): void {
    const episode = this.state.episodes[type];
    if (!episode) return;

    // Delete rather than assign undefined: `Object.entries` would still report
    // the key, and the face-lost grace path iterates those entries.
    delete this.state.episodes[type];
    closedEpisodes.push({
      id: episode.id,
      type,
      startedAt: episode.startedAt,
      endedAt: now,
      durationMs: now - episode.startedAt,
      peakSeverity: episode.peakSeverity,
    });
  }

  private closeAllEpisodes(now: number, closedEpisodes: ClosedEpisode[]): void {
    for (const type of Object.keys(this.state.episodes) as DetectionTypeT[]) {
      this.closeEpisode(type, now, closedEpisodes);
    }
    this.state.faceLostStartTime = now;
  }
}

export const safetyEngine = new SafetyEngine();