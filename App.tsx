import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Dimensions,
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
import { extractDriverMetrics } from './src/driverSignals';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { setAudioModeAsync } from 'expo-audio';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const FACE_DETECTION_OPTIONS: RNMLKitFaceDetectorOptions = {
  performanceMode: 'fast',
  landmarkMode: true,
  contourMode: true,
  classificationMode: true,
};

const generateDemoMetrics = () => {
  const eyeOpen = 0.2 + Math.random() * 0.8;
  const mouthOpen = Math.random() > 0.95 ? 0.4 + Math.random() * 0.4 : 0.05 + Math.random() * 0.15;
  const headTurn = Math.random() > 0.9 ? 15 + Math.random() * 30 : Math.random() * 10;
  
  return {
    faceDetected: true,
    eyeOpenness: eyeOpen,
    mouthOpenness: mouthOpen,
    headTurn: headTurn,
    headPitch: Math.random() * 5,
    headRoll: Math.random() * 5,
    faceCenterX: 0.5,
    faceCenterY: 0.4,
    faceSizeRatio: 0.6,
  };
};

const AppContent: React.FC = () => {
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
  const detectionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const detectionBusyRef = useRef(false);
  const autoStartedRef = useRef(false);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const handleTripStart = useCallback(async () => {
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

    durationIntervalRef.current = setInterval(() => {
      setTripDuration(getTripDuration());
    }, 1000);
  }, [startTrip, getTripDuration]);

  const handleTripStop = useCallback(async () => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    if (demoIntervalRef.current) {
      clearInterval(demoIntervalRef.current);
      demoIntervalRef.current = null;
    }

    try {
      await deactivateKeepAwake();
    } catch (error) {
      console.warn('Failed to deactivate keep awake:', error);
    }

    setInfractionSummary(getInfractionSummary());
    setShowSummary(true);
    stopTrip();
  }, [stopTrip, getInfractionSummary]);

  const handleFaceDetection = useCallback((metrics: any) => {
    if (!stateRef.current.isMonitoring) return;
    processDetection(metrics);
  }, [processDetection]);

  const runFaceDetection = useCallback(async () => {
    if (detectionBusyRef.current) return;
    const cam = cameraRef.current;
    if (!cam || !stateRef.current.isMonitoring) return;
    detectionBusyRef.current = true;
    try {
      const photo = await cam.takePictureAsync({ quality: 0.4, shutterSound: false });
      if (!photo || !stateRef.current.isMonitoring) return;
      const result = await detector.detectFaces(photo.uri);
      if (!result) return;
      const face = result.faces && result.faces.length > 0 ? result.faces[0] : undefined;
      const metrics = extractDriverMetrics(face, photo.width, photo.height);
      if (face) {
        console.log(`[Netra] Face detected: eye=${metrics.eyeOpenness?.toFixed(2)} mouth=${metrics.mouthOpenness?.toFixed(3)} headTurn=${metrics.headTurn?.toFixed(1)}`);
      }
      handleFaceDetection(metrics);
    } catch (error) {
      console.warn('[Netra] detection error:', error);
    } finally {
      detectionBusyRef.current = false;
    }
  }, [detector, handleFaceDetection]);

  const toggleCamera = useCallback(() => {
    setCameraReady(false);
    setFacing((current) => (current === 'back' ? 'front' : 'back'));
  }, []);

  const startDemoMode = useCallback(() => {
    setIsDemoMode(true);
    handleTripStart();
    demoIntervalRef.current = setInterval(() => {
      const metrics = generateDemoMetrics();
      handleFaceDetection(metrics);
    }, 500);
  }, [handleTripStart, handleFaceDetection]);

  const handleSummaryClose = useCallback(() => {
    setShowSummary(false);
    setIsDemoMode(false);
  }, []);

  useEffect(() => {
    if (autoStartedRef.current) {
      return;
    }
    if (state.isMonitoring) {
      return;
    }
    if (hasPermission?.granted) {
      autoStartedRef.current = true;
      handleTripStart();
    } else if (hasPermission && !hasPermission.granted) {
      autoStartedRef.current = true;
      startDemoMode();
    }
  }, [hasPermission, state.isMonitoring, handleTripStart, startDemoMode]);

  useEffect(() => {
    if (state.isMonitoring && hasPermission?.granted && !isDemoMode && cameraReady) {
      detectionIntervalRef.current = setInterval(() => {
        runFaceDetection();
      }, 1500);
      runFaceDetection();
    } else {
      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
        detectionIntervalRef.current = null;
      }
    }
    return () => {
      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
        detectionIntervalRef.current = null;
      }
    };
  }, [state.isMonitoring, hasPermission?.granted, isDemoMode, cameraReady, runFaceDetection]);

  useEffect(() => {
    return () => {
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
      if (demoIntervalRef.current) {
        clearInterval(demoIntervalRef.current);
      }
      deactivateKeepAwake();
      stopTrip();
    };
  }, [stopTrip]);

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
          onPress={startDemoMode}
          activeOpacity={0.8}
        >
          <Text style={styles.startButtonText}>START TRIP (DEMO)</Text>
        </TouchableOpacity>

        <Text style={styles.disclaimer}>
          For demo purposes only. Always drive safely.
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
      </View>
      <View style={styles.dashboardSection}>
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
  dashboardSection: {
    height: Math.round(SCREEN_HEIGHT * 0.5),
  },
  cameraPlaceholder: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  demoText: {
    fontSize: 20,
    color: '#3b82f6',
    fontWeight: 'bold',
  },
  demoSubtext: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 8,
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
    marginBottom: 48,
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
    marginBottom: 48,
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
    paddingVertical: 20,
    paddingHorizontal: 64,
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
  disclaimer: {
    marginTop: 24,
    fontSize: 12,
    color: '#64748b',
    textAlign: 'center',
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