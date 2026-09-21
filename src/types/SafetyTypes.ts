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
}

export type SafetyState = {
  warningLevel: WarningLevel;
  activeDetection: DetectionType | null;
  rideSafetyScore: number;
  isMonitoring: boolean;
  tripStartTime: number | null;
  infractions: Infraction[];
};

export type Infraction = {
  type: DetectionType;
  timestamp: number;
  severity: WarningLevel;
  duration: number;
};

export type SafetyEngineConfig = {
  eyeClosedThreshold: number;
  eyeClosedDurationMs: number;
  severeDrowsinessDurationMs: number;
  yawnThreshold: number;
  yawnDurationMs: number;
  distractionAngleThreshold: number;
  distractionDurationMs: number;
  scoreDeductionDistraction: number;
  scoreDeductionYawn: number;
  scoreDeductionSevere: number;
};

export const DEFAULT_CONFIG: SafetyEngineConfig = {
  eyeClosedThreshold: 0.3,
  eyeClosedDurationMs: 1500,
  severeDrowsinessDurationMs: 2500,
  yawnThreshold: 0.04,
  yawnDurationMs: 1200,
  distractionAngleThreshold: 20,
  distractionDurationMs: 2000,
  scoreDeductionDistraction: 2,
  scoreDeductionYawn: 5,
  scoreDeductionSevere: 15,
};

export type SafetyEngineResult = {
  warningLevel: WarningLevel;
  activeDetection: DetectionType | null;
  shouldDeductScore: boolean;
  detectionType?: DetectionType;
};