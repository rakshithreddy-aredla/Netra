import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';
import type { CameraView } from 'expo-camera';
import type { RNMLKitFaceDetector } from '@infinitered/react-native-mlkit-face-detection';
import { File } from 'expo-file-system';
import { extractDriverMetrics } from '../driverSignals';
import type { DriverMetrics } from '../driverSignals';

/** How often to sample the camera. */
export const DETECTION_INTERVAL_MS = 1000;

/** JPEG quality for the analysis frame. Lower is cheaper to encode and decode. */
const CAPTURE_QUALITY = 0.3;

type Options = {
  cameraRef: React.RefObject<CameraView | null>;
  detector: RNMLKitFaceDetector;
  enabled: boolean;
  onMetrics: (metrics: DriverMetrics) => void;
  intervalMs?: number;
};

/**
 * Drives periodic face analysis from the live camera.
 *
 * Camera v57 exposes no frame-by-frame API, so this samples with
 * `takePictureAsync`. That write-to-disk round trip is unavoidable without
 * native code, so the loop is kept cheap and well-behaved instead: one interval
 * at a time, no overlapping detections, paused whenever the app is backgrounded
 * (a driver has the app foregrounded, but a background timer would burn battery
 * and fight other apps for the camera), and each captured frame is deleted after
 * analysis so a long trip cannot fill the cache.
 */
export function useFaceDetectionLoop({
  cameraRef,
  detector,
  enabled,
  onMetrics,
  intervalMs = DETECTION_INTERVAL_MS,
}: Options) {
  const busyRef = useRef(false);
  const [appActive, setAppActive] = useState(
    () => AppState.currentState === 'active',
  );

  const disposeCapture = useCallback((uri: string | undefined) => {
    if (!uri) return;
    // Cache files accumulate at ~1/second, so clean up as we go.
    // `File.delete()` is the current SDK 57 API; `deleteAsync` is deprecated.
    try {
      new File(uri).delete();
    } catch {
      // A frame we cannot delete is not worth interrupting detection for.
    }
  }, []);

  const runDetection = useCallback(async () => {
    if (busyRef.current) return;

    const camera = cameraRef.current;
    if (!camera) return;

    busyRef.current = true;
    try {
      const photo = await camera.takePictureAsync({
        quality: CAPTURE_QUALITY,
        shutterSound: false,
      });

      if (!photo) return;

      try {
        const result = await detector.detectFaces(photo.uri);
        const face = result?.faces?.length ? result.faces[0] : undefined;
        onMetrics(extractDriverMetrics(face, photo.width, photo.height));
      } finally {
        disposeCapture(photo.uri);
      }
    } catch (error) {
      console.warn('[Netra] detection error:', error);
    } finally {
      busyRef.current = false;
    }
  }, [cameraRef, detector, onMetrics, disposeCapture]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      setAppActive(next === 'active');
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!enabled || !appActive) {
      return;
    }

    void runDetection();
    const interval = setInterval(() => {
      void runDetection();
    }, intervalMs);

    return () => {
      clearInterval(interval);
    };
  }, [enabled, appActive, intervalMs, runDetection]);

  return { isDetecting: busyRef, appActive };
}