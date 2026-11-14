import type { DriverMetrics } from '../driverSignals';

export enum WarningLevel {
  NORMAL = 0,
  MILD = 1,
  MODERATE = 2,
  SEVERE = 3,
  CRITICAL = 4,
}

export const WARNING_LABELS: Record<WarningLevel, string> = {
  [WarningLevel.NORMAL]: 'NORMAL',
  [WarningLevel.MILD]: 'MILD',
  [WarningLevel.MODERATE]: 'MODERATE',
  [WarningLevel.SEVERE]: 'SEVERE',
  [WarningLevel.CRITICAL]: 'CRITICAL',
};

export enum DetectionType {
  EYES_CLOSED = 'EYES_CLOSED',
  YAWN = 'YAWN',
  DISTRACTION = 'DISTRACTION',
  SEVERE_DROWSINESS = 'SEVERE_DROWSINESS',
  FACE_UNSEEN = 'FACE_UNSEEN',
}

export const DETECTION_LABELS: Record<DetectionType, string> = {
  [DetectionType.EYES_CLOSED]: 'EYES CLOSED',
  [DetectionType.YAWN]: 'YAWNING',
  [DetectionType.DISTRACTION]: 'LOOKING AWAY',
  [DetectionType.SEVERE_DROWSINESS]: 'SEVERE DROWSINESS',
  [DetectionType.FACE_UNSEEN]: 'FACE NOT VISIBLE',
};

export type SafetyState = {
  warningLevel: WarningLevel;
  activeDetection: DetectionType | null;
  rideSafetyScore: number;
  isMonitoring: boolean;
  tripStartTime: number | null;
  infractions: Infraction[];
  /** Most recent raw signals, for the live monitoring readout. */
  lastMetrics: DriverMetrics | null;
};

export type Infraction = {
  id: string;
  type: DetectionType;
  timestamp: number;
  severity: WarningLevel;
  /** Real elapsed time of the episode, in ms. Filled in when the episode closes. */
  duration: number;
};

/**
 * Every threshold has a paired "clear" value. A signal turns on when it crosses
 * the trigger threshold and only turns off once it moves back past the clear
 * threshold, so a metric hovering on the boundary cannot make the alarm flap.
 */
export type SafetyEngineConfig = {
  eyeClosedThreshold: number;
  eyeClosedClearThreshold: number;
  severeEyeOpennessThreshold: number;
  severeEyeOpennessClearThreshold: number;
  eyeClosedDurationMs: number;
  severeDrowsinessDurationMs: number;
  yawnThreshold: number;
  yawnClearThreshold: number;
  /**
   * Yawns are judged relative to this driver's own closed-mouth baseline rather
   * than a fixed constant. Nose-base-to-lower-lip distance is already ~30-40% of
   * face height with the mouth shut, and varies with face shape and distance
   * from the camera, so any absolute threshold is either unusable or noisy.
   */
  yawnBaselineRatio: number;
  yawnClearRatio: number;
  yawnDurationMs: number;
  distractionAngleThreshold: number;
  distractionClearThreshold: number;
  distractionDurationMs: number;
  /**
   * How long the face may drop out before the engine gives up on the current
   * episode. Short dropouts (a blink, a hand over the lens, a shadow) are
   * bridged instead of resetting every timer.
   */
  faceLostGraceMs: number;
  scoreDeductionDistraction: number;
  scoreDeductionEyesClosed: number;
  scoreDeductionYawn: number;
  scoreDeductionSevereDrowsiness: number;
  scoreDeductionFaceUnseen: number;
};

export const DEFAULT_CONFIG: SafetyEngineConfig = {
  eyeClosedThreshold: 0.3,
  eyeClosedClearThreshold: 0.45,
  severeEyeOpennessThreshold: 0.15,
  severeEyeOpennessClearThreshold: 0.25,
  eyeClosedDurationMs: 1500,
  severeDrowsinessDurationMs: 2500,
  yawnThreshold: 0.25,
  yawnClearThreshold: 0.18,
  yawnBaselineRatio: 1.18,
  yawnClearRatio: 1.06,
  yawnDurationMs: 2000,
  distractionAngleThreshold: 20,
  distractionClearThreshold: 14,
  distractionDurationMs: 2000,
  faceLostGraceMs: 3000,
  scoreDeductionDistraction: 2,
  scoreDeductionEyesClosed: 3,
  scoreDeductionYawn: 5,
  scoreDeductionSevereDrowsiness: 15,
  scoreDeductionFaceUnseen: 4,
};

export const SCORE_DEDUCTIONS: Record<DetectionType, number> = {
  [DetectionType.DISTRACTION]: DEFAULT_CONFIG.scoreDeductionDistraction,
  [DetectionType.EYES_CLOSED]: DEFAULT_CONFIG.scoreDeductionEyesClosed,
  [DetectionType.YAWN]: DEFAULT_CONFIG.scoreDeductionYawn,
  [DetectionType.SEVERE_DROWSINESS]: DEFAULT_CONFIG.scoreDeductionSevereDrowsiness,
  [DetectionType.FACE_UNSEEN]: DEFAULT_CONFIG.scoreDeductionFaceUnseen,
};

export type Deduction = {
  id: string;
  type: DetectionType;
  severity: WarningLevel;
  startedAt: number;
};

export type ClosedEpisode = {
  id: string;
  type: DetectionType;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  peakSeverity: WarningLevel;
};

export type SafetyEngineResult = {
  warningLevel: WarningLevel;
  activeDetection: DetectionType | null;
  /** True when at least one deduction fired this frame. */
  shouldDeductScore: boolean;
  /** Every detection that fired a deduction this frame — not just the last one. */
  deductions: Deduction[];
  /** Episodes that ended this frame, carrying their real elapsed duration. */
  closedEpisodes: ClosedEpisode[];
  /** The detection driving the warning level. */
  detectionType?: DetectionType;
  /** How long the face has been missing, or null while it is visible. */
  faceLostDurationMs?: number | null;
};