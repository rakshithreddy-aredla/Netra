import { AlarmManager, AlarmLevel } from '../src/alarm/AlarmManager';
import { WarningLevel, DetectionType } from '../src/types/SafetyTypes';
import { createAudioPlayer } from 'expo-audio';
import * as Speech from 'expo-speech';

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

jest.mock('react-native', () => ({
  Vibration: { vibrate: jest.fn() },
  Platform: { OS: 'android', select: (spec: { android?: unknown; default?: unknown }) => spec.default },
}));

jest.mock('expo-device', () => ({
  isDevice: true,
}));

type FakePlayer = {
  play: jest.Mock;
  pause: jest.Mock;
  remove: jest.Mock;
  loop: boolean;
  volume: number;
  playing: boolean;
};

const createFakePlayer = (): FakePlayer => {
  const player: FakePlayer = {
    play: jest.fn(function (this: FakePlayer) {
      player.playing = true;
    }),
    pause: jest.fn(function (this: FakePlayer) {
      player.playing = false;
    }),
    remove: jest.fn(),
    loop: false,
    volume: 1,
    playing: false,
  };
  return player;
};

describe('AlarmManager', () => {
  let alarmManager: AlarmManager;

  beforeEach(() => {
    jest.clearAllMocks();
    (createAudioPlayer as jest.Mock).mockImplementation(() => createFakePlayer());
    alarmManager = new AlarmManager();
  });

  afterEach(() => {
    alarmManager.cleanup();
  });

  describe('alarm level mapping', () => {
    it.each([
      [WarningLevel.NORMAL, AlarmLevel.NONE],
      [WarningLevel.MILD, AlarmLevel.VOICE_ALERT],
      [WarningLevel.MODERATE, AlarmLevel.HAPTIC_FEEDBACK],
      [WarningLevel.SEVERE, AlarmLevel.SIREN],
      [WarningLevel.CRITICAL, AlarmLevel.SIREN],
    ])('maps warning %s to alarm %s', async (warning, expected) => {
      await alarmManager.triggerAlarm(warning);

      expect(alarmManager.getCurrentAlarmLevel()).toBe(expected);
    });

    it('starts inactive', () => {
      expect(alarmManager.isAlarmActive()).toBe(false);
    });
  });

  describe('speech', () => {
    it('speaks the detection-specific message when a detection is supplied', async () => {
      await alarmManager.triggerAlarm(WarningLevel.SEVERE, DetectionType.YAWN);

      expect(Speech.speak).toHaveBeenCalledWith(
        expect.stringContaining('Yawning'),
        expect.any(Object),
      );
    });

    it('falls back to the level message with no detection', async () => {
      await alarmManager.triggerAlarm(WarningLevel.SEVERE);

      expect(Speech.speak).toHaveBeenCalledWith(
        expect.stringContaining('Pull over'),
        expect.any(Object),
      );
    });
  });

  describe('siren', () => {
    it('creates the player from the bundled asset, not a remote URL', async () => {
      await alarmManager.triggerAlarm(WarningLevel.SEVERE);

      expect(createAudioPlayer).toHaveBeenCalledTimes(1);

      // Jest substitutes the binary asset with a stub object; what matters is
      // that the source is a bundled module, never a network URL string.
      const source = (createAudioPlayer as jest.Mock).mock.calls[0][0];
      expect(typeof source).not.toBe('string');
      expect(source).toEqual(expect.anything());
    });

    it('does not recreate the player when the alarm keeps sounding', async () => {
      // The bug this guards: playSiren() removed and re-created the native
      // player on every detection frame.
      await alarmManager.triggerAlarm(WarningLevel.SEVERE);
      await alarmManager.triggerAlarm(WarningLevel.SEVERE);
      await alarmManager.triggerAlarm(WarningLevel.SEVERE);

      expect(createAudioPlayer).toHaveBeenCalledTimes(1);
    });

    it('releases the player when the alarm stops', async () => {
      await alarmManager.triggerAlarm(WarningLevel.SEVERE);

      const player = (createAudioPlayer as jest.Mock).mock.results[0].value as FakePlayer;

      await alarmManager.stopAllAlarms();

      expect(player.pause).toHaveBeenCalled();
      expect(player.remove).toHaveBeenCalled();
      expect(alarmManager.isAlarmActive()).toBe(false);
    });

    it('degrades to haptics and voice when the asset fails to load', async () => {
      (createAudioPlayer as jest.Mock).mockImplementationOnce(() => {
        throw new Error('asset missing');
      });

      await alarmManager.triggerAlarm(WarningLevel.SEVERE);

      // The alarm path must never throw, even without the bundled asset.
      expect(alarmManager.getCurrentAlarmLevel()).toBe(AlarmLevel.SIREN);
    });
  });

  describe('re-triggering', () => {
    it('does not re-fire an alarm that is already sounding at the same level', async () => {
      await alarmManager.triggerAlarm(WarningLevel.MODERATE);
      await alarmManager.triggerAlarm(WarningLevel.MODERATE);

      // One voice prompt, not one per detection frame.
      expect(Speech.speak).toHaveBeenCalledTimes(1);
    });

    it('does re-fire when the warning level changes', async () => {
      // Voice is on a cooldown, so step past it to isolate the level change.
      const now = jest.spyOn(Date, 'now');
      now.mockReturnValue(1_000_000);

      await alarmManager.triggerAlarm(WarningLevel.MILD);
      expect(Speech.speak).toHaveBeenCalledTimes(1);

      now.mockReturnValue(1_000_000 + 6000);
      await alarmManager.triggerAlarm(WarningLevel.SEVERE);
      expect(Speech.speak).toHaveBeenCalledTimes(2);

      now.mockRestore();
    });

    it('holds voice on cooldown while the level is unchanged', async () => {
      const now = jest.spyOn(Date, 'now');
      now.mockReturnValue(1_000_000);

      await alarmManager.triggerAlarm(WarningLevel.MODERATE);
      await alarmManager.triggerAlarm(WarningLevel.MODERATE);

      expect(Speech.speak).toHaveBeenCalledTimes(1);
      now.mockRestore();
    });

    it('escalates from voice to siren', async () => {
      await alarmManager.triggerAlarm(WarningLevel.MILD);
      expect(createAudioPlayer).not.toHaveBeenCalled();

      await alarmManager.triggerAlarm(WarningLevel.SEVERE);
      expect(createAudioPlayer).toHaveBeenCalledTimes(1);
    });
  });

  describe('stopAllAlarms', () => {
    it('silences a sounding alarm', async () => {
      await alarmManager.triggerAlarm(WarningLevel.CRITICAL);
      expect(alarmManager.isAlarmActive()).toBe(true);

      await alarmManager.stopAllAlarms();

      expect(alarmManager.getCurrentAlarmLevel()).toBe(AlarmLevel.NONE);
      expect(alarmManager.isAlarmActive()).toBe(false);
      expect(Speech.stop).toHaveBeenCalled();
    });

    it('is safe to call when nothing is sounding', async () => {
      await expect(alarmManager.stopAllAlarms()).resolves.toBeUndefined();
      expect(alarmManager.isAlarmActive()).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('stops the alarm', async () => {
      await alarmManager.triggerAlarm(WarningLevel.SEVERE);

      alarmManager.cleanup();

      expect(alarmManager.isAlarmActive()).toBe(false);
    });
  });
});