import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { useDriver } from '../state/DriverContext';
import {
  WarningLevel,
  DetectionType,
  WARNING_LABELS,
  DETECTION_LABELS,
  DEFAULT_CONFIG,
} from '../types/SafetyTypes';

const getScoreColor = (score: number): string => {
  if (score >= 80) return '#22c55e';
  if (score >= 50) return '#eab308';
  return '#ef4444';
};

const getWarningColor = (warningLevel: WarningLevel): string => {
  switch (warningLevel) {
    case WarningLevel.MILD:
      return '#84cc16';
    case WarningLevel.MODERATE:
      return '#eab308';
    case WarningLevel.SEVERE:
      return '#f97316';
    case WarningLevel.CRITICAL:
      return '#ef4444';
    case WarningLevel.NORMAL:
    default:
      return '#22c55e';
  }
};

/**
 * Falls back to the warning level when no specific detection is driving it, so
 * an escalated state never reads as a calm "Monitoring...".
 */
const getStatusText = (
  warningLevel: WarningLevel,
  activeDetection: DetectionType | null,
): string => {
  if (activeDetection) {
    return `${DETECTION_LABELS[activeDetection]}!`;
  }
  if (warningLevel > WarningLevel.NORMAL) {
    return `${WARNING_LABELS[warningLevel]} ALERT!`;
  }
  return 'Monitoring...';
};

const formatDuration = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
};

/**
 * Live readout of the raw signals.
 *
 * This exists because detection bugs were invisible: yawning was silently dead
 * (landmarks never resolved) while the dashboard still said "Monitoring...".
 * Showing the actual values, and whether each signal is even available, makes
 * that class of failure obvious instead of mysterious.
 */
const SignalBar: React.FC<{
  label: string;
  value: number | null;
  format: (value: number) => string;
  threshold?: number;
  max: number;
  inverted?: boolean;
}> = ({ label, value, format, threshold, max, inverted = false }) => {
  const unavailable = value === null;
  const ratio = unavailable ? 0 : Math.max(0, Math.min(1, value / max));
  const thresholdRatio =
    threshold === undefined ? null : Math.max(0, Math.min(1, threshold / max));
  // For "lower is worse" signals the bar should look alarming when it is short.
  const fillRatio = inverted ? ratio : 1 - ratio;

  return (
    <View style={styles.signalRow}>
      <Text style={styles.signalLabel}>{label}</Text>
      <View style={styles.signalTrack}>
        <View
          style={[
            styles.signalFill,
            {
              width: `${Math.round(fillRatio * 100)}%`,
              backgroundColor: unavailable
                ? '#4b5563'
                : fillRatio > 0.7
                  ? '#ef4444'
                  : fillRatio > 0.45
                    ? '#eab308'
                    : '#22c55e',
            },
          ]}
        />
        {thresholdRatio !== null && (
          <View style={[styles.signalMarker, { left: `${Math.round(thresholdRatio * 100)}%` }]} />
        )}
      </View>
      <Text
        style={[
          styles.signalValue,
          unavailable && { color: '#f97316' },
        ]}
      >
        {unavailable ? 'n/a' : format(value)}
      </Text>
    </View>
  );
};

/**
 * Full-screen flash on CRITICAL. This is the visual half of the alarm — audio
 * and haptics are owned by the AlarmManager, which is not a component.
 */
const CriticalFlash: React.FC = () => {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 160,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 160,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <Animated.View pointerEvents="none" style={[styles.flashOverlay, { opacity }]} />
  );
};

interface SafetyDashboardProps {
  onStopTrip: () => void;
}

export const SafetyDashboard: React.FC<SafetyDashboardProps> = ({ onStopTrip }) => {
  const { state, getTripDuration } = useDriver();
  const {
    rideSafetyScore,
    warningLevel,
    activeDetection,
    tripStartTime,
    infractions,
    lastMetrics: metrics,
  } = state;

  const scoreColor = getScoreColor(rideSafetyScore);
  const warningColor = getWarningColor(warningLevel);
  const statusText = getStatusText(warningLevel, activeDetection);
  const tripDuration = tripStartTime ? getTripDuration() : 0;

  return (
    <View style={styles.container}>
      {warningLevel === WarningLevel.CRITICAL && <CriticalFlash />}

      <View style={styles.topBar}>
        <View style={[styles.scoreContainer, { backgroundColor: scoreColor }]}>
          <Text style={styles.scoreLabel}>RIDE SAFETY SCORE</Text>
          <Text style={styles.scoreValue}>{Math.round(rideSafetyScore)}</Text>
        </View>

        <View style={[styles.statusContainer, { borderColor: warningColor }]}>
          <Text style={[styles.statusText, { color: warningColor }]}>{statusText}</Text>
        </View>
      </View>

      <View style={styles.metricsContainer}>
        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>TRIP DURATION</Text>
          <Text style={styles.metricValue}>{formatDuration(tripDuration)}</Text>
        </View>

        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>TOTAL INFRACTIONS</Text>
          <Text style={styles.metricValue}>{infractions.length}</Text>
        </View>

        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>WARNING LEVEL</Text>
          <Text style={[styles.metricValue, { color: warningColor }]}>
            {WARNING_LABELS[warningLevel]}
          </Text>
        </View>
      </View>

      <View style={styles.detectionIndicators}>
        <Text style={styles.indicatorsTitle}>Live signals</Text>
        <SignalBar
          label="Eye openness"
          value={metrics?.eyeOpenness ?? null}
          format={(v) => `${Math.round(v * 100)}%`}
          threshold={DEFAULT_CONFIG.eyeClosedThreshold}
          max={1}
        />
        <SignalBar
          label="Mouth opening"
          value={metrics?.mouthOpenness ?? null}
          format={(v) => `${Math.round(v * 100)}%`}
          max={0.8}
        />
        <SignalBar
          label="Head turn"
          value={metrics?.headTurn ?? null}
          format={(v) => `${Math.round(v)}°`}
          threshold={DEFAULT_CONFIG.distractionAngleThreshold}
          max={60}
        />
        <Text style={styles.faceHint}>
          {metrics === null
            ? 'Waiting for camera…'
            : metrics.faceDetected
              ? 'Face tracked'
              : 'No face detected'}
        </Text>
      </View>

      <TouchableOpacity
        style={styles.stopButton}
        onPress={onStopTrip}
        activeOpacity={0.8}
      >
        <Text style={styles.stopButtonText}>■ END TRIP</Text>
      </TouchableOpacity>
    </View>
  );
};

interface TripSummaryProps {
  score: number;
  duration: number;
  infractions: Record<DetectionType, number>;
  onClose: () => void;
}

export const TripSummary: React.FC<TripSummaryProps> = ({
  score,
  duration,
  infractions,
  onClose,
}) => {
  const scoreColor = getScoreColor(score);
  const entries = Object.entries(infractions).filter(([, count]) => count > 0);

  return (
    <View style={styles.summaryContainer}>
      <Text style={styles.summaryTitle}>TRIP SUMMARY</Text>

      <View style={[styles.summaryScore, { backgroundColor: scoreColor }]}>
        <Text style={styles.summaryScoreLabel}>Final Score</Text>
        <Text style={styles.summaryScoreValue}>{Math.round(score)}</Text>
      </View>

      <View style={styles.summaryDetails}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Trip Duration:</Text>
          <Text style={styles.summaryValue}>{formatDuration(duration)}</Text>
        </View>

        <View style={styles.divider} />

        <Text style={styles.infractionTitle}>Infractions:</Text>
        {entries.length === 0 ? (
          <Text style={styles.summaryLabel}>None — clean trip.</Text>
        ) : (
          entries.map(([type, count]) => (
            <View key={type} style={styles.infractionRow}>
              <Text style={styles.infractionType}>
                {DETECTION_LABELS[type as DetectionType] ?? type}:
              </Text>
              <Text style={styles.infractionCount}>{count}</Text>
            </View>
          ))
        )}
      </View>

      <TouchableOpacity
        style={styles.closeButton}
        onPress={onClose}
        activeOpacity={0.8}
      >
        <Text style={styles.closeButtonText}>CLOSE</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
  },
  flashOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#ef4444',
    zIndex: 20,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  scoreContainer: {
    borderRadius: 14,
    padding: 10,
    alignItems: 'center',
    minWidth: 120,
  },
  scoreLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: 'white',
    marginBottom: 2,
  },
  scoreValue: {
    fontSize: 34,
    fontWeight: 'bold',
    color: 'white',
  },
  statusContainer: {
    borderWidth: 2,
    borderRadius: 12,
    padding: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  statusText: {
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  metricsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  metricBox: {
    backgroundColor: 'rgba(75, 75, 75, 0.6)',
    borderRadius: 10,
    padding: 8,
    alignItems: 'center',
    flex: 1,
    marginHorizontal: 3,
  },
  metricLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: '#9ca3af',
    marginBottom: 2,
  },
  metricValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: 'white',
  },
  detectionIndicators: {
    backgroundColor: 'rgba(75, 75, 75, 0.6)',
    borderRadius: 10,
    padding: 10,
  },
  indicatorsTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9ca3af',
    marginBottom: 8,
  },
  signalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  signalLabel: {
    width: 96,
    fontSize: 11,
    color: '#9ca3af',
    fontWeight: '500',
  },
  signalTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#374151',
    overflow: 'hidden',
    marginRight: 8,
  },
  signalFill: {
    height: '100%',
    borderRadius: 4,
  },
  signalMarker: {
    position: 'absolute',
    top: -2,
    width: 2,
    height: 12,
    backgroundColor: '#e5e7eb',
  },
  signalValue: {
    width: 42,
    fontSize: 11,
    fontWeight: '700',
    color: 'white',
    textAlign: 'right',
  },
  faceHint: {
    fontSize: 10,
    color: '#9ca3af',
    marginTop: 2,
  },
  stopButton: {
    marginTop: 10,
    backgroundColor: '#ef4444',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  stopButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
    letterSpacing: 2,
  },
  summaryContainer: {
    flex: 1,
    padding: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
  },
  summaryTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
    textAlign: 'center',
    marginBottom: 32,
  },
  summaryScore: {
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    marginBottom: 32,
  },
  summaryScoreLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.8)',
  },
  summaryScoreValue: {
    fontSize: 72,
    fontWeight: 'bold',
    color: 'white',
  },
  summaryDetails: {
    backgroundColor: 'rgba(75, 75, 75, 0.4)',
    borderRadius: 16,
    padding: 20,
    marginBottom: 32,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  summaryLabel: {
    fontSize: 16,
    color: '#9ca3af',
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginVertical: 16,
  },
  infractionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    marginBottom: 12,
  },
  infractionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  infractionType: {
    fontSize: 14,
    color: '#9ca3af',
  },
  infractionCount: {
    fontSize: 14,
    fontWeight: 'bold',
    color: 'white',
  },
  closeButton: {
    backgroundColor: '#3b82f6',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
  },
});