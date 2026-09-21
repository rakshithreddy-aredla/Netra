import { AlarmManager, AlarmLevel } from '../src/alarm/AlarmManager';
import { WarningLevel, DetectionType } from '../src/types/SafetyTypes';

jest.mock('expo-audio', () => ({
  setAudioModeAsync: jest.fn(),
  createAudioPlayer: jest.fn(() => ({
    play: jest.fn(),
    pause: jest.fn(),
    remove: jest.fn(),
    loop: false,
    volume: 1,
  })),
}));

jest.mock('expo-speech', () => ({
  speak: jest.fn(),
  stop: jest.fn(),
}));

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: {
    Heavy: 'Heavy',
  },
  NotificationFeedbackType: {
    Warning: 'Warning',
    Error: 'Error',
  },
}));

jest.mock('react-native', () => ({
  Vibration: {
    vibrate: jest.fn(),
  },
  Platform: {
    OS: 'ios',
  },
}));

jest.mock('expo-device', () => ({
  isDevice: true,
}));

describe('AlarmManager', () => {
  let alarmManager: AlarmManager;

  beforeEach(() => {
    jest.clearAllMocks();
    alarmManager = new AlarmManager();
  });

  afterEach(() => {
    alarmManager.cleanup();
  });

  describe('constructor', () => {
    it('should create AlarmManager with NONE alarm level', () => {
      expect(alarmManager.getCurrentAlarmLevel()).toBe(AlarmLevel.NONE);
      expect(alarmManager.isAlarmActive()).toBe(false);
    });
  });

  describe('triggerAlarm', () => {
    it('should set alarm level to VOICE_ALERT for MILD warning', async () => {
      await alarmManager.triggerAlarm(WarningLevel.MILD);

      expect(alarmManager.getCurrentAlarmLevel()).toBe(AlarmLevel.VOICE_ALERT);
    });

    it('should set alarm level to HAPTIC_FEEDBACK for MODERATE warning', async () => {
      await alarmManager.triggerAlarm(WarningLevel.MODERATE);

      expect(alarmManager.getCurrentAlarmLevel()).toBe(AlarmLevel.HAPTIC_FEEDBACK);
    });

    it('should set alarm level to SIREN for SEVERE warning', async () => {
      await alarmManager.triggerAlarm(WarningLevel.SEVERE);

      expect(alarmManager.getCurrentAlarmLevel()).toBe(AlarmLevel.SIREN);
    });

    it('should set alarm level to STROBE for CRITICAL warning', async () => {
      await alarmManager.triggerAlarm(WarningLevel.CRITICAL);

      expect(alarmManager.getCurrentAlarmLevel()).toBe(AlarmLevel.STROBE);
    });

    it('should not trigger alarm for NORMAL warning', async () => {
      await alarmManager.triggerAlarm(WarningLevel.NORMAL);

      expect(alarmManager.getCurrentAlarmLevel()).toBe(AlarmLevel.NONE);
      expect(alarmManager.isAlarmActive()).toBe(false);
    });
  });

  describe('stopAllAlarms', () => {
    it('should reset alarm level to NONE', async () => {
      await alarmManager.triggerAlarm(WarningLevel.CRITICAL);
      expect(alarmManager.isAlarmActive()).toBe(true);

      await alarmManager.stopAllAlarms();

      expect(alarmManager.getCurrentAlarmLevel()).toBe(AlarmLevel.NONE);
      expect(alarmManager.isAlarmActive()).toBe(false);
    });
  });

  describe('getCurrentAlarmLevel', () => {
    it('should return NONE initially', () => {
      expect(alarmManager.getCurrentAlarmLevel()).toBe(AlarmLevel.NONE);
    });

    it('should return correct alarm level after triggerAlarm', async () => {
      await alarmManager.triggerAlarm(WarningLevel.MODERATE);
      expect(alarmManager.getCurrentAlarmLevel()).toBe(AlarmLevel.HAPTIC_FEEDBACK);
    });
  });

  describe('isAlarmActive', () => {
    it('should return false when no alarm is active', () => {
      expect(alarmManager.isAlarmActive()).toBe(false);
    });

    it('should return true when an alarm is active', async () => {
      await alarmManager.triggerAlarm(WarningLevel.MILD);
      expect(alarmManager.isAlarmActive()).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('should stop all alarms and reset state', async () => {
      await alarmManager.triggerAlarm(WarningLevel.SEVERE);
      expect(alarmManager.isAlarmActive()).toBe(true);

      alarmManager.cleanup();

      expect(alarmManager.getCurrentAlarmLevel()).toBe(AlarmLevel.NONE);
      expect(alarmManager.isAlarmActive()).toBe(false);
    });
  });
});