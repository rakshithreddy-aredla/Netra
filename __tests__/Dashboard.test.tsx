import React from 'react';
import { render } from '@testing-library/react-native';
import { SafetyDashboard, TripSummary } from '../src/components/Dashboard';
import { DriverProvider } from '../src/state/DriverContext';
import { resetAlarmManagerForTests } from '../src/alarm/AlarmManager';
import { DetectionType } from '../src/types/SafetyTypes';

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

describe('Dashboard', () => {
  beforeEach(() => {
    resetAlarmManagerForTests();
  });

  describe('SafetyDashboard', () => {
    it('shows a calm monitoring state with no active detection', () => {
      const { getByText } = render(
        <DriverProvider>
          <SafetyDashboard onStopTrip={jest.fn()} />
        </DriverProvider>,
      );

      expect(getByText('Monitoring...')).toBeTruthy();
      expect(getByText('100')).toBeTruthy();
      expect(getByText('■ END TRIP')).toBeTruthy();
    });
  });

  describe('TripSummary', () => {
    const summary = (infractions: Partial<Record<DetectionType, number>>) =>
      ({
        DISTRACTION: 0,
        YAWN: 0,
        EYES_CLOSED: 0,
        SEVERE_DROWSINESS: 0,
        FACE_UNSEEN: 0,
        ...infractions,
      }) as Record<DetectionType, number>;

    it('renders the final score and duration', () => {
      const { getByText } = render(
        <TripSummary
          score={82.4}
          duration={3_725_000}
          infractions={summary({})}
          onClose={jest.fn()}
        />,
      );

      expect(getByText('82')).toBeTruthy();
      expect(getByText('1h 2m')).toBeTruthy();
    });

    it('uses human-readable detection labels rather than raw enum names', () => {
      const { getByText, queryByText } = render(
        <TripSummary
          score={50}
          duration={0}
          infractions={summary({ SEVERE_DROWSINESS: 2 })}
          onClose={jest.fn()}
        />,
      );

      expect(getByText('SEVERE DROWSINESS:')).toBeTruthy();
      expect(getByText('2')).toBeTruthy();
      // The old rendering printed the raw enum key instead of a readable label.
      expect(queryByText('severe drowsiness:')).toBeNull();
    });

    it('reports a clean trip when nothing was detected', () => {
      const { getByText } = render(
        <TripSummary
          score={100}
          duration={60_000}
          infractions={summary({})}
          onClose={jest.fn()}
        />,
      );

      expect(getByText('None — clean trip.')).toBeTruthy();
    });

    it('omits detections with a zero count', () => {
      const { queryByText } = render(
        <TripSummary
          score={95}
          duration={1000}
          infractions={summary({ YAWN: 1 })}
          onClose={jest.fn()}
        />,
      );

      expect(queryByText('DISTRACTION:')).toBeNull();
    });
  });
});