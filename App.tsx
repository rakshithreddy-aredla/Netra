import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  Linking,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { CameraType } from 'expo-camera';
import {
  FaceDetectionProvider,
  useFaceDetection,
} from '@infinitered/react-native-mlkit-face-detection';
import type { RNMLKitFaceDetectorOptions } from '@infinitered/react-native-mlkit-face-detection';
import { DriverProvider, useDriver } from './src/state/DriverContext';
import { SafetyDashboard, TripSummary } from './src/components/Dashboard';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { DetectionType } from './src/types/SafetyTypes';
import { useFaceDetectionLoop } from './src/hooks/useFaceDetectionLoop';
import { DemoSignalSource } from './src/demo/demoSignals';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { setAudioModeAsync } from 'expo-audio';

const FACE_DETECTION_OPTIONS: RNMLKitFaceDetectorOptions = {
  performanceMode: 'fast',
  landmarkMode: true,
  contourMode: true,
  classificationMode: true,
};

const DEMO_INTERVAL_MS = 500;

const AppContent: React.FC = () => {
  const { height: SCREEN_HEIGHT } = useWindowDimensions();
  const [hasPermission, requestPermission] = useCameraPermissions();
  const [showSummary, setShowSummary] = useState(false);
  const [tripDuration, setTripDuration] = useState(0);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [facing, setFacing] = useState<CameraType>('front');
  const [cameraReady, setCameraReady] = useState(false);
  const [infractionSummary, setInfractionSummary] = useState<Record<DetectionType, number>>(
    Object.fromEntries(Object.values(DetectionType).map(t => [t, 0])) as Record<DetectionType, number>
  );
  const { state, startTrip, stopTrip, processDetection, getTripDuration, getInfractionSummary } = useDriver();
  const detector = useFaceDetection();
  const cameraRef = useRef<CameraView | null>(null);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const demoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const demoSourceRef = useRef(new DemoSignalSource());

  const clearTripTimers = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    if (demoIntervalRef.current) {
      clearInterval(demoIntervalRef.current);
      demoIntervalRef.current = null;
    }
  }, []);

  const handleTripStart = useCallback(async () => {
    // Never stack intervals if a start is triggered twice.
    clearTripTimers();

    try {
      await activateKeepAwakeAsync();
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        interruptionMode: 'duckOthers',
      });
    } catch (error) {
      console.warn('Failed to activate keep awake:', error);
    }

    startTrip();
    setShowSummary(false);

    durationIntervalRef.current = setInterval(() => {
      setTripDuration(getTripDuration());
    }, 1000);
  }, [startTrip, getTripDuration, clearTripTimers]);

  const handleTripStop = useCallback(async () => {
    clearTripTimers();

    try {
      await deactivateKeepAwake();
    } catch (error) {
      console.warn('Failed to deactivate keep awake:', error);
    }

    setInfractionSummary(getInfractionSummary());
    setShowSummary(true);
    stopTrip();
  }, [stopTrip, getInfractionSummary, clearTripTimers]);

  const handleFaceDetection = useCallback((metrics: Parameters<typeof processDetection>[0]) => {
    processDetection(metrics);
  }, [processDetection]);

  // The hook additionally pauses itself while the app is backgrounded.
  const { appActive } = useFaceDetectionLoop({
    cameraRef,
    detector,
    enabled:
      state.isMonitoring && !!hasPermission?.granted && !isDemoMode && cameraReady,
    onMetrics: handleFaceDetection,
  });

  const toggleCamera = useCallback(() => {
    setCameraReady(false);
    setFacing((current) => (current === 'back' ? 'front' : 'back'));
  }, []);

  const startDemoMode = useCallback(() => {
    setIsDemoMode(true);
    demoSourceRef.current.reset();
    void handleTripStart();
    demoIntervalRef.current = setInterval(() => {
      handleFaceDetection(demoSourceRef.current.next());
    }, DEMO_INTERVAL_MS);
  }, [handleTripStart, handleFaceDetection]);

  const handleSummaryClose = useCallback(() => {
    setShowSummary(false);
    setIsDemoMode(false);
  }, []);

  useEffect(() => {
    return () => {
      clearTripTimers();
      void deactivateKeepAwake();
      stopTrip();
    };
  }, [stopTrip, clearTripTimers]);

  if (!hasPermission) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionTitle}>Camera Access Required</Text>
        <Text style={styles.permissionText}>
          Netra Driver Guardian needs camera access to monitor your driving safety.
        </Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.permissionButtonText}>Grant Permission</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.permissionButton, styles.demoButton]}
          onPress={startDemoMode}
        >
          <Text style={styles.permissionButtonText}>Try Demo Mode</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!hasPermission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionTitle}>Camera Permission Denied</Text>
        <Text style={styles.permissionText}>
          Please enable camera access in your device settings to use this app.
        </Text>
        <TouchableOpacity style={styles.permissionButton} onPress={() => Linking.openSettings()}>
          <Text style={styles.permissionButtonText}>Open Settings</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.permissionButton, styles.demoButton]}
          onPress={startDemoMode}
        >
          <Text style={styles.permissionButtonText}>Try Demo Mode</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (showSummary) {
    return (
      <TripSummary
        score={state.rideSafetyScore}
        duration={tripDuration}
        infractions={infractionSummary}
        onClose={handleSummaryClose}
      />
    );
  }

  if (!state.isMonitoring) {
    return (
      <View style={styles.startContainer}>
        <View style={styles.logoContainer}>
          <Text style={styles.logoIcon}>👁️</Text>
          <Text style={styles.logoTitle}>NETRA</Text>
          <Text style={styles.logoSubtitle}>Driver Guardian</Text>
        </View>

        <View style={styles.featuresContainer}>
          <FeatureItem icon="😴" text="Drowsiness Detection" />
          <FeatureItem icon="😮" text="Yawn Monitoring" />
          <FeatureItem icon="👋" text="Distraction Alert" />
          <FeatureItem icon="📊" text="Safety Scoring" />
        </View>

        <TouchableOpacity
          style={styles.startButton}
          onPress={handleTripStart}
          activeOpacity={0.8}
        >
          <Text style={styles.startButtonText}>START TRIP</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.startButtonSecondary}
          onPress={startDemoMode}
          activeOpacity={0.8}
        >
          <Text style={styles.startButtonSecondaryText}>START IN DEMO MODE</Text>
        </TouchableOpacity>

        <Text style={styles.disclaimer}>
          The camera feed is analysed on-device and never leaves your phone.
          {'\n'}For research and demonstration purposes. Always drive safely.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.cameraSection}>
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing={facing}
          active={appActive}
          onCameraReady={() => setCameraReady(true)}
        />
        <TouchableOpacity
          style={styles.cameraToggleButton}
          onPress={toggleCamera}
          activeOpacity={0.8}
        >
          <Text style={styles.cameraToggleText}>
            {facing === 'front' ? '⟳ Use Back Camera' : '⟳ Use Front Camera'}
          </Text>
        </TouchableOpacity>
        {isDemoMode && (
          <View style={styles.demoBadge}>
            <Text style={styles.demoBadgeText}>DEMO MODE — SIMULATED SIGNALS</Text>
          </View>
        )}
      </View>
      <View style={[styles.dashboardSection, { height: Math.round(SCREEN_HEIGHT * 0.5) }]}>
        <SafetyDashboard onStopTrip={handleTripStop} />
      </View>
    </View>
  );
};

const FeatureItem: React.FC<{ icon: string; text: string }> = ({ icon, text }) => (
  <View style={styles.featureItem}>
    <Text style={styles.featureIcon}>{icon}</Text>
    <Text style={styles.featureText}>{text}</Text>
  </View>
);

export default function App() {
  return (
    <ErrorBoundary>
      <FaceDetectionProvider options={FACE_DETECTION_OPTIONS}>
        <DriverProvider>
          <AppContent />
        </DriverProvider>
      </FaceDetectionProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  cameraSection: {
    flex: 1,
  },
  camera: {
    flex: 1,
  },
  cameraToggleButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: 'rgba(59, 130, 246, 0.85)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    zIndex: 10,
  },
  cameraToggleText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: 'white',
  },
  demoBadge: {
    position: 'absolute',
    bottom: 16,
    alignSelf: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.9)',
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 14,
    zIndex: 10,
  },
  demoBadgeText: {
    color: 'white',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  dashboardSection: {
    // Height is supplied inline from useWindowDimensions.
  },
  startContainer: {
    flex: 1,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logoIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  logoTitle: {
    fontSize: 42,
    fontWeight: 'bold',
    color: '#3b82f6',
    letterSpacing: 8,
  },
  logoSubtitle: {
    fontSize: 18,
    color: '#94a3b8',
    marginTop: 8,
  },
  featuresContainer: {
    width: '100%',
    marginBottom: 40,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  featureIcon: {
    fontSize: 24,
    marginRight: 16,
  },
  featureText: {
    fontSize: 16,
    color: 'white',
    fontWeight: '500',
  },
  startButton: {
    backgroundColor: '#3b82f6',
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 56,
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  startButtonText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
    letterSpacing: 2,
  },
  startButtonSecondary: {
    marginTop: 12,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#10b981',
    paddingVertical: 12,
    paddingHorizontal: 32,
  },
  startButtonSecondaryText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#10b981',
    letterSpacing: 1,
  },
  disclaimer: {
    marginTop: 24,
    fontSize: 12,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 18,
  },
  permissionContainer: {
    flex: 1,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  permissionTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 16,
    textAlign: 'center',
  },
  permissionText: {
    fontSize: 16,
    color: '#94a3b8',
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 24,
  },
  permissionButton: {
    backgroundColor: '#3b82f6',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 32,
    marginBottom: 16,
  },
  demoButton: {
    backgroundColor: '#10b981',
  },
  permissionButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: 'white',
  },
});