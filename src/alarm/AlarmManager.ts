import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import type { AudioPlayer } from 'expo-audio';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { Vibration } from 'react-native';
import { WarningLevel, DetectionType } from '../types/SafetyTypes';
import * as Device from 'expo-device';

/**
 * Visual alerting is owned by the Dashboard, which can actually render it.
 * The alarm manager only owns what a non-component can drive: audio and haptics.
 */
export enum AlarmLevel {
  NONE = 0,
  VOICE_ALERT = 1,
  HAPTIC_FEEDBACK = 2,
  SIREN = 3,
}

const VOICE_MESSAGES: Record<WarningLevel, string> = {
  [WarningLevel.NORMAL]: 'Monitoring active. Stay safe.',
  [WarningLevel.MILD]: 'Please keep your eyes on the road.',
  [WarningLevel.MODERATE]: 'Warning! Eyes on the road now!',
  [WarningLevel.SEVERE]: 'Danger! Pull over immediately!',
  [WarningLevel.CRITICAL]: 'CRITICAL ALERT! Please wake up!',
};

const DETECTION_MESSAGES: Record<DetectionType, string> = {
  [DetectionType.EYES_CLOSED]: 'Eyes closed. Stay awake!',
  [DetectionType.YAWN]: 'Yawning detected. Stay alert!',
  [DetectionType.DISTRACTION]: 'Looking away from road!',
  [DetectionType.SEVERE_DROWSINESS]: 'Severe drowsiness! Pull over now!',
  [DetectionType.FACE_UNSEEN]: 'Your face is not visible! Pull over!',
};

const ALARM_LEVEL_BY_WARNING: Record<WarningLevel, AlarmLevel> = {
  [WarningLevel.NORMAL]: AlarmLevel.NONE,
  [WarningLevel.MILD]: AlarmLevel.VOICE_ALERT,
  [WarningLevel.MODERATE]: AlarmLevel.HAPTIC_FEEDBACK,
  [WarningLevel.SEVERE]: AlarmLevel.SIREN,
  [WarningLevel.CRITICAL]: AlarmLevel.SIREN,
};

export class AlarmManager {
  private currentAlarmLevel: AlarmLevel = AlarmLevel.NONE;
  private sirenSound: AudioPlayer | null = null;
  private isSpeaking = false;
  private lastVoiceAlert = 0;
  private voiceAlertCooldownMs = 5000;

  constructor() {
    void this.configureAudio();
  }

  private async configureAudio(): Promise<void> {
    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        interruptionMode: 'duckOthers',
      });
    } catch (error) {
      console.warn('Failed to configure audio mode:', error);
    }
  }

  /**
   * Idempotent by warning level: re-arming an alarm that is already sounding at
   * the same level is a no-op, so a sustained condition does not restart speech
   * or churn native audio resources once per detection frame.
   */
  async triggerAlarm(
    warningLevel: WarningLevel,
    detectionType?: DetectionType,
  ): Promise<void> {
    const alarmLevel = ALARM_LEVEL_BY_WARNING[warningLevel] ?? AlarmLevel.NONE;

    if (alarmLevel === this.currentAlarmLevel) {
      return;
    }

    this.currentAlarmLevel = alarmLevel;

    if (alarmLevel === AlarmLevel.NONE) {
      await this.stopAllAlarms();
      return;
    }

    const now = Date.now();
    if (now - this.lastVoiceAlert >= this.voiceAlertCooldownMs) {
      await this.speak(
        detectionType
          ? DETECTION_MESSAGES[detectionType]
          : VOICE_MESSAGES[warningLevel],
      );
      this.lastVoiceAlert = now;
    }

    if (alarmLevel >= AlarmLevel.HAPTIC_FEEDBACK) {
      await this.triggerHaptics(warningLevel);
    }

    if (alarmLevel >= AlarmLevel.SIREN) {
      this.playSiren();
    }
  }

  private async speak(message: string): Promise<void> {
    if (this.isSpeaking) {
      await Speech.stop();
    }

    try {
      this.isSpeaking = true;
      await Speech.speak(message, {
        language: 'en',
        rate: 0.9,
        pitch: 1.0,
        onDone: () => {
          this.isSpeaking = false;
        },
        onError: () => {
          this.isSpeaking = false;
        },
      });
    } catch (error) {
      console.warn('Speech error:', error);
      this.isSpeaking = false;
    }
  }

  private async triggerHaptics(warningLevel: WarningLevel): Promise<void> {
    try {
      if (!Device.isDevice) {
        Vibration.vibrate([0, 500, 200, 500]);
        return;
      }

      switch (warningLevel) {
        case WarningLevel.MODERATE:
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          break;
        case WarningLevel.SEVERE:
        case WarningLevel.CRITICAL:
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          await new Promise((resolve) => setTimeout(resolve, 300));
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          break;
        default:
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      }
    } catch (error) {
      console.warn('Haptics error:', error);
      Vibration.vibrate(500);
    }
  }

  /**
   * Creates at most one siren player for the lifetime of the alarm and reuses
   * it. `createAudioPlayer` allocates a native resource, so recreating it on
   * every detection frame leaks and glitches the audio.
   *
   * The tone is a bundled asset so the alarm still works with no network — this
   * is precisely the moment the driver most needs it.
   */
  private playSiren(): void {
    if (this.sirenSound?.playing) {
      return;
    }

    try {
      if (!this.sirenSound) {
        this.sirenSound = createAudioPlayer(require('../../assets/siren.wav'));
        this.sirenSound.loop = true;
        this.sirenSound.volume = 1.0;
      }
      this.sirenSound.play();
    } catch (error) {
      console.error('Siren playback failed, using fallback alert:', error);
      this.sirenSound = null;
      try {
        void this.speak('Critical alert! Please pull over immediately!');
        Vibration.vibrate([0, 500, 200, 500, 200, 500]);
      } catch (fallbackError) {
        console.error('Fallback alert also failed:', fallbackError);
      }
    }
  }

  async stopAllAlarms(): Promise<void> {
    this.currentAlarmLevel = AlarmLevel.NONE;

    if (this.sirenSound) {
      try {
        this.sirenSound.pause();
        this.sirenSound.remove();
      } catch (error) {
        console.error('Error releasing siren sound:', error);
      }
      this.sirenSound = null;
    }

    try {
      await Speech.stop();
    } catch (error) {
      console.error('Error stopping speech:', error);
    }

    this.isSpeaking = false;
  }

  getCurrentAlarmLevel(): AlarmLevel {
    return this.currentAlarmLevel;
  }

  isAlarmActive(): boolean {
    return this.currentAlarmLevel > AlarmLevel.NONE;
  }

  cleanup(): void {
    void this.stopAllAlarms();
  }
}

let alarmManagerInstance: AlarmManager | null = null;

export const getAlarmManager = (): AlarmManager => {
  if (!alarmManagerInstance) {
    alarmManagerInstance = new AlarmManager();
  }
  return alarmManagerInstance;
};

export const resetAlarmManagerForTests = (): void => {
  alarmManagerInstance = null;
};