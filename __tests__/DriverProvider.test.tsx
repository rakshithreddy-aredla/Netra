import React from 'react';
import { Text } from 'react-native';
import { render, act } from '@testing-library/react-native';
import { DriverProvider, useDriver } from '../src/state/DriverContext';
import { resetAlarmManagerForTests } from '../src/alarm/AlarmManager';
import { safetyEngine } from '../src/safety/SafetyEngine';
import type { DriverMetrics } from '../src/driverSignals';
import { WarningLevel, DetectionType, SCORE_DEDUCTIONS } from '../src/types/SafetyTypes';

jest.mock('expo-audio', () => ({
  setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
  createAudioPlayer: jest.fn(() => ({
    play: jest.fn(),
    pause: jest.fn(),
    remove: jest.fn(),
    loop: false,
    volume: 1,
    playing: true,
  })),
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

const metrics = (overrides: Partial<DriverMetrics> = {}): DriverMetrics => ({
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

/** Surfaces the live context values to the test. */
let latest: ReturnType<typeof useDriver>;
const Probe: React.FC = () => {
  latest = useDriver();
  return <Text>{String(latest.state.warningLevel)}</Text>;
};

const setup = () =>
  render(
    <DriverProvider>
      <Probe />
    </DriverProvider>,
  );

describe('DriverProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    safetyEngine.reset();
    resetAlarmManagerForTests();
    jest.useFakeTimers();
    jest.setSystemTime(1_000_000);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts idle', () => {
    setup();

    expect(latest.state.isMonitoring).toBe(false);
    expect(latest.state.rideSafetyScore).toBe(100);
  });

  it('ignores detections while no trip is running', () => {
    setup();

    act(() => {
      latest.processDetection(metrics({ eyeOpenness: 0.05 }));
      jest.advanceTimersByTime(3000);
      latest.processDetection(metrics({ eyeOpenness: 0.05 }));
    });

    expect(latest.state.warningLevel).toBe(WarningLevel.NORMAL);
    expect(latest.state.rideSafetyScore).toBe(100);
  });

  it('deducts once for a sustained severe-drowsiness episode', () => {
    setup();

    act(() => latest.startTrip());

    // Eyes shut for five seconds at one sample per second. This is the
    // regression that drove the rewrite: the old engine deducted every frame,
    // taking the score from 100 to 0 well inside a single drowsy episode.
    act(() => {
      latest.processDetection(metrics({ eyeOpenness: 0.05 }));
      for (let i = 0; i < 5; i += 1) {
        jest.advanceTimersByTime(1000);
        latest.processDetection(metrics({ eyeOpenness: 0.05 }));
      }
    });

    expect(latest.state.warningLevel).toBe(WarningLevel.CRITICAL);
    expect(latest.state.rideSafetyScore).toBe(
      100 - SCORE_DEDUCTIONS[DetectionType.SEVERE_DROWSINESS],
    );
    expect(latest.state.infractions).toHaveLength(1);
  });

  it('records the real duration once the episode closes', () => {
    setup();

    act(() => latest.startTrip());

    act(() => {
      latest.processDetection(metrics({ eyeOpenness: 0.05 }));
      jest.advanceTimersByTime(3000);
      latest.processDetection(metrics({ eyeOpenness: 0.05 }));
      // Driver recovers.
      jest.advanceTimersByTime(1000);
      latest.processDetection(metrics());
    });

    expect(latest.state.infractions[0].type).toBe(DetectionType.SEVERE_DROWSINESS);
    expect(latest.state.infractions[0].duration).toBe(4000);
    expect(latest.state.infractions[0].severity).toBe(WarningLevel.CRITICAL);
  });

  it('clears the warning and silences the alarm once the driver recovers', () => {
    setup();

    act(() => latest.startTrip());

    act(() => {
      latest.processDetection(metrics({ eyeOpenness: 0.05 }));
      jest.advanceTimersByTime(3000);
      latest.processDetection(metrics({ eyeOpenness: 0.05 }));
    });
    expect(latest.state.warningLevel).toBe(WarningLevel.CRITICAL);

    act(() => {
      jest.advanceTimersByTime(1000);
      latest.processDetection(metrics());
    });

    expect(latest.state.warningLevel).toBe(WarningLevel.NORMAL);
    expect(latest.state.activeDetection).toBeNull();
  });

  it('keeps the score deducted after a trip ends', () => {
    setup();

    act(() => latest.startTrip());
    act(() => {
      // Seed a closed-mouth baseline before yawning; yawns are judged
      // relative to the driver's own resting mouth.
      latest.processDetection(metrics({ mouthOpenness: 0.3 }));
      jest.advanceTimersByTime(500);
      latest.processDetection(metrics({ mouthOpenness: 0.44 }));
      jest.advanceTimersByTime(2100);
      latest.processDetection(metrics({ mouthOpenness: 0.44 }));
    });

    act(() => latest.stopTrip());

    expect(latest.state.isMonitoring).toBe(false);
    expect(latest.state.rideSafetyScore).toBe(
      100 - SCORE_DEDUCTIONS[DetectionType.YAWN],
    );
  });

  it('starts a fresh trip with a clean slate', () => {
    setup();

    act(() => latest.startTrip());
    act(() => {
      // Seed a closed-mouth baseline before yawning; yawns are judged
      // relative to the driver's own resting mouth.
      latest.processDetection(metrics({ mouthOpenness: 0.3 }));
      jest.advanceTimersByTime(500);
      latest.processDetection(metrics({ mouthOpenness: 0.44 }));
      jest.advanceTimersByTime(2100);
      latest.processDetection(metrics({ mouthOpenness: 0.44 }));
    });
    act(() => latest.stopTrip());
    act(() => latest.startTrip());

    expect(latest.state.rideSafetyScore).toBe(100);
    expect(latest.state.infractions).toEqual([]);
  });

  it('ignores a second start while a trip is already running', () => {
    setup();

    act(() => latest.startTrip());
    const firstStart = latest.state.tripStartTime;

    act(() => {
      jest.advanceTimersByTime(5000);
      latest.startTrip();
    });

    expect(latest.state.tripStartTime).toBe(firstStart);
  });

  it('summarises infractions by type', () => {
    setup();

    act(() => latest.startTrip());
    act(() => {
      // Seed a closed-mouth baseline before yawning; yawns are judged
      // relative to the driver's own resting mouth.
      latest.processDetection(metrics({ mouthOpenness: 0.3 }));
      jest.advanceTimersByTime(500);
      latest.processDetection(metrics({ mouthOpenness: 0.44 }));
      jest.advanceTimersByTime(2100);
      latest.processDetection(metrics({ mouthOpenness: 0.44 }));
      jest.advanceTimersByTime(3000);
      latest.processDetection(metrics());
    });

    const summary = latest.getInfractionSummary();
    expect(summary[DetectionType.YAWN]).toBe(1);
    expect(summary[DetectionType.DISTRACTION]).toBe(0);
  });
});
