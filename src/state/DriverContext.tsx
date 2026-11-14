import React, { createContext, useContext, useReducer, useCallback, useRef, useEffect } from 'react';
import { SafetyEngine, safetyEngine } from '../safety/SafetyEngine';
import { getAlarmManager } from '../alarm/AlarmManager';
import type { DriverMetrics } from '../driverSignals';
import type { SafetyState, Infraction, WarningLevel, DetectionType } from '../types/SafetyTypes';
import { SCORE_DEDUCTIONS, WarningLevel as WarningLevelEnum } from '../types/SafetyTypes';

export type DriverAction =
  | { type: 'START_TRIP' }
  | { type: 'STOP_TRIP' }
  | {
      type: 'UPDATE_WARNING';
      payload: { warningLevel: WarningLevel; activeDetection: DetectionType | null };
    }
  | { type: 'SET_METRICS'; payload: DriverMetrics }
  | { type: 'DEDUCT_SCORE'; payload: { detectionType: DetectionType } }
  | { type: 'ADD_INFRACTION'; payload: Infraction }
  | {
      type: 'CLOSE_INFRACTION';
      payload: { id: string; duration: number; severity: WarningLevel };
    }
  | { type: 'RESET_STATE' };

export const INITIAL_STATE: SafetyState = {
  warningLevel: WarningLevelEnum.NORMAL,
  activeDetection: null,
  rideSafetyScore: 100,
  isMonitoring: false,
  tripStartTime: null,
  infractions: [],
  lastMetrics: null,
};

export const MAX_SCORE = 100;
export const MIN_SCORE = 0;

export function driverReducer(state: SafetyState, action: DriverAction): SafetyState {
  switch (action.type) {
    case 'START_TRIP':
      return {
        ...INITIAL_STATE,
        isMonitoring: true,
        tripStartTime: Date.now(),
        rideSafetyScore: MAX_SCORE,
      };

    case 'STOP_TRIP':
      return {
        ...state,
        isMonitoring: false,
        warningLevel: WarningLevelEnum.NORMAL,
        activeDetection: null,
      };

    case 'UPDATE_WARNING':
      if (
        state.warningLevel === action.payload.warningLevel &&
        state.activeDetection === action.payload.activeDetection
      ) {
        return state;
      }
      return {
        ...state,
        warningLevel: action.payload.warningLevel,
        activeDetection: action.payload.activeDetection,
      };

    case 'SET_METRICS':
      return { ...state, lastMetrics: action.payload };

    case 'DEDUCT_SCORE': {
      const deduction = SCORE_DEDUCTIONS[action.payload.detectionType] ?? 5;
      return {
        ...state,
        rideSafetyScore: Math.max(MIN_SCORE, state.rideSafetyScore - deduction),
      };
    }

    case 'ADD_INFRACTION':
      return { ...state, infractions: [...state.infractions, action.payload] };

    case 'CLOSE_INFRACTION':
      return {
        ...state,
        infractions: state.infractions.map((infraction) =>
          infraction.id === action.payload.id
            ? {
                ...infraction,
                duration: action.payload.duration,
                severity: action.payload.severity,
              }
            : infraction,
        ),
      };

    case 'RESET_STATE':
      return INITIAL_STATE;

    default:
      return state;
  }
}

type DriverContextType = {
  state: SafetyState;
  startTrip: () => void;
  stopTrip: () => void;
  processDetection: (metrics: DriverMetrics) => void;
  getTripDuration: () => number;
  getInfractionSummary: () => Record<DetectionType, number>;
};

const DriverContext = createContext<DriverContextType | null>(null);

/** Ignore duplicate frames arriving faster than the camera can produce them. */
const MIN_PROCESS_INTERVAL_MS = 100;

export const DriverProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(driverReducer, INITIAL_STATE);
  const engineRef = useRef<SafetyEngine>(safetyEngine);
  const alarmManagerRef = useRef(getAlarmManager());
  const lastProcessTimeRef = useRef<number>(0);
  const isMonitoringRef = useRef<boolean>(false);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
    isMonitoringRef.current = state.isMonitoring;
  }, [state]);

  const startTrip = useCallback(() => {
    if (isMonitoringRef.current) {
      return;
    }
    engineRef.current.reset();
    isMonitoringRef.current = true;
    dispatch({ type: 'START_TRIP' });
  }, []);

  const stopTrip = useCallback(() => {
    isMonitoringRef.current = false;
    alarmManagerRef.current.stopAllAlarms();
    dispatch({ type: 'STOP_TRIP' });
  }, []);

  const processDetection = useCallback((metrics: DriverMetrics) => {
    if (!isMonitoringRef.current) return;

    const now = Date.now();
    if (now - lastProcessTimeRef.current < MIN_PROCESS_INTERVAL_MS) return;
    lastProcessTimeRef.current = now;

    const result = engineRef.current.processMetrics(metrics, now);

    dispatch({ type: 'SET_METRICS', payload: metrics });

    dispatch({
      type: 'UPDATE_WARNING',
      payload: {
        warningLevel: result.warningLevel,
        activeDetection: result.activeDetection,
      },
    });

    // Idempotent inside the manager: this both raises the alarm and silences it
    // once the driver recovers, which is what stops a siren looping forever.
    void alarmManagerRef.current.triggerAlarm(
      result.warningLevel,
      result.activeDetection ?? undefined,
    );

    for (const deduction of result.deductions) {
      dispatch({ type: 'DEDUCT_SCORE', payload: { detectionType: deduction.type } });
      dispatch({
        type: 'ADD_INFRACTION',
        payload: {
          id: deduction.id,
          type: deduction.type,
          timestamp: deduction.startedAt,
          severity: deduction.severity,
          duration: 0,
        },
      });
    }

    for (const episode of result.closedEpisodes) {
      dispatch({
        type: 'CLOSE_INFRACTION',
        payload: {
          id: episode.id,
          duration: episode.durationMs,
          severity: episode.peakSeverity,
        },
      });
    }
  }, []);

  const getTripDuration = useCallback((): number => {
    if (!stateRef.current.tripStartTime) return 0;
    return Date.now() - stateRef.current.tripStartTime;
  }, []);

  const getInfractionSummary = useCallback((): Record<DetectionType, number> => {
    const summary = {
      DISTRACTION: 0,
      YAWN: 0,
      EYES_CLOSED: 0,
      SEVERE_DROWSINESS: 0,
      FACE_UNSEEN: 0,
    } as Record<DetectionType, number>;

    stateRef.current.infractions.forEach((infraction) => {
      summary[infraction.type]++;
    });

    return summary;
  }, []);

  useEffect(() => {
    const alarmManager = alarmManagerRef.current;
    return () => {
      alarmManager.cleanup();
    };
  }, []);

  return (
    <DriverContext.Provider
      value={{
        state,
        startTrip,
        stopTrip,
        processDetection,
        getTripDuration,
        getInfractionSummary,
      }}
    >
      {children}
    </DriverContext.Provider>
  );
};

export const useDriver = (): DriverContextType => {
  const context = useContext(DriverContext);
  if (!context) {
    throw new Error('useDriver must be used within a DriverProvider');
  }
  return context;
};