import {
  driverReducer,
  INITIAL_STATE,
  MAX_SCORE,
  MIN_SCORE,
} from '../src/state/DriverContext';
import type { SafetyState } from '../src/types/SafetyTypes';
import { WarningLevel, DetectionType, SCORE_DEDUCTIONS } from '../src/types/SafetyTypes';

// The provider imports the alarm layer, which reaches native modules that have
// no implementation under Jest. babel-jest hoists these above the imports.
jest.mock('expo-audio', () => ({
  setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
  createAudioPlayer: jest.fn(),
}));
jest.mock('expo-speech', () => ({
  speak: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  impactAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Heavy: 'Heavy' },
  NotificationFeedbackType: { Warning: 'Warning', Error: 'Error' },
}));
jest.mock('expo-device', () => ({ isDevice: true }));

const startTrip = (): SafetyState => driverReducer(INITIAL_STATE, { type: 'START_TRIP' });

describe('driverReducer', () => {
  describe('START_TRIP', () => {
    it('begins monitoring with a full score and a start time', () => {
      const state = startTrip();

      expect(state.isMonitoring).toBe(true);
      expect(state.rideSafetyScore).toBe(MAX_SCORE);
      expect(state.tripStartTime).not.toBeNull();
      expect(state.infractions).toEqual([]);
    });

    it('clears the previous trip', () => {
      const dirty: SafetyState = {
        ...INITIAL_STATE,
        rideSafetyScore: 42,
        infractions: [
          {
            id: 'YAWN@1',
            type: DetectionType.YAWN,
            timestamp: 1,
            severity: WarningLevel.MODERATE,
            duration: 2100,
          },
        ],
      };

      const state = driverReducer(dirty, { type: 'START_TRIP' });

      expect(state.rideSafetyScore).toBe(MAX_SCORE);
      expect(state.infractions).toEqual([]);
    });
  });

  describe('STOP_TRIP', () => {
    it('stops monitoring and clears the warning but keeps the results', () => {
      const dirty: SafetyState = {
        ...startTrip(),
        rideSafetyScore: 70,
        warningLevel: WarningLevel.CRITICAL,
        activeDetection: DetectionType.SEVERE_DROWSINESS,
      };

      const state = driverReducer(dirty, { type: 'STOP_TRIP' });

      expect(state.isMonitoring).toBe(false);
      expect(state.warningLevel).toBe(WarningLevel.NORMAL);
      expect(state.activeDetection).toBeNull();
      expect(state.rideSafetyScore).toBe(70);
    });
  });

  describe('DEDUCT_SCORE', () => {
    it('applies the configured deduction for each detection type', () => {
      Object.values(DetectionType).forEach((detectionType) => {
        const state = driverReducer(startTrip(), {
          type: 'DEDUCT_SCORE',
          payload: { detectionType },
        });

        expect(state.rideSafetyScore).toBe(
          MAX_SCORE - SCORE_DEDUCTIONS[detectionType],
        );
      });
    });

    it('never falls below zero', () => {
      let state = startTrip();

      for (let i = 0; i < 40; i += 1) {
        state = driverReducer(state, {
          type: 'DEDUCT_SCORE',
          payload: { detectionType: DetectionType.SEVERE_DROWSINESS },
        });
      }

      expect(state.rideSafetyScore).toBe(MIN_SCORE);
    });

    it('falls back to a default for an unrecognised detection type', () => {
      const state = driverReducer(startTrip(), {
        type: 'DEDUCT_SCORE',
        payload: { detectionType: 'NOT_A_DETECTION' as DetectionType },
      });

      expect(state.rideSafetyScore).toBe(MAX_SCORE - 5);
    });
  });

  describe('infractions', () => {
    it('appends an infraction', () => {
      const infraction = {
        id: 'EYES_CLOSED@100',
        type: DetectionType.EYES_CLOSED,
        timestamp: 100,
        severity: WarningLevel.MODERATE,
        duration: 0,
      };

      const state = driverReducer(startTrip(), {
        type: 'ADD_INFRACTION',
        payload: infraction,
      });

      expect(state.infractions).toEqual([infraction]);
    });

    it('fills in the real duration when the episode closes', () => {
      const opened = driverReducer(startTrip(), {
        type: 'ADD_INFRACTION',
        payload: {
          id: 'YAWN@100',
          type: DetectionType.YAWN,
          timestamp: 100,
          severity: WarningLevel.MODERATE,
          duration: 0,
        },
      });

      const closed = driverReducer(opened, {
        type: 'CLOSE_INFRACTION',
        payload: { id: 'YAWN@100', duration: 2400, severity: WarningLevel.MODERATE },
      });

      expect(closed.infractions[0].duration).toBe(2400);
    });

    it('escalates the recorded severity to the episode peak on close', () => {
      const opened = driverReducer(startTrip(), {
        type: 'ADD_INFRACTION',
        payload: {
          id: 'SEVERE_DROWSINESS@1',
          type: DetectionType.SEVERE_DROWSINESS,
          timestamp: 1,
          severity: WarningLevel.SEVERE,
          duration: 0,
        },
      });

      const closed = driverReducer(opened, {
        type: 'CLOSE_INFRACTION',
        payload: {
          id: 'SEVERE_DROWSINESS@1',
          duration: 3600,
          severity: WarningLevel.CRITICAL,
        },
      });

      expect(closed.infractions[0].severity).toBe(WarningLevel.CRITICAL);
    });

    it('ignores a close for an unknown id', () => {
      const opened = driverReducer(startTrip(), {
        type: 'ADD_INFRACTION',
        payload: {
          id: 'YAWN@100',
          type: DetectionType.YAWN,
          timestamp: 100,
          severity: WarningLevel.MODERATE,
          duration: 0,
        },
      });

      const closed = driverReducer(opened, {
        type: 'CLOSE_INFRACTION',
        payload: { id: 'SOMETHING_ELSE', duration: 5000, severity: WarningLevel.SEVERE },
      });

      expect(closed.infractions[0].duration).toBe(0);
      expect(closed.infractions[0].severity).toBe(WarningLevel.MODERATE);
    });
  });

  describe('UPDATE_WARNING', () => {
    it('applies a new warning level', () => {
      const state = driverReducer(startTrip(), {
        type: 'UPDATE_WARNING',
        payload: {
          warningLevel: WarningLevel.MODERATE,
          activeDetection: DetectionType.YAWN,
        },
      });

      expect(state.warningLevel).toBe(WarningLevel.MODERATE);
      expect(state.activeDetection).toBe(DetectionType.YAWN);
    });

    it('returns the same object when nothing changed', () => {
      // The detection loop runs every second; an unchanged level must not
      // re-render the whole dashboard.
      const state = startTrip();
      const next = driverReducer(state, {
        type: 'UPDATE_WARNING',
        payload: {
          warningLevel: WarningLevel.NORMAL,
          activeDetection: null,
        },
      });

      expect(next).toBe(state);
    });
  });

  it('resets to the initial state', () => {
    const dirty: SafetyState = {
      ...startTrip(),
      rideSafetyScore: 10,
      infractions: [
        {
          id: 'x',
          type: DetectionType.YAWN,
          timestamp: 1,
          severity: WarningLevel.MILD,
          duration: 1,
        },
      ],
    };

    expect(driverReducer(dirty, { type: 'RESET_STATE' })).toEqual(INITIAL_STATE);
  });
});