# Netra Driver Guardian

**Real-time AI-powered driver drowsiness and distraction detection for Android.**

Netra Driver Guardian is a React Native (Expo) mobile app that uses **Google ML Kit on-device face detection** to monitor a driver's alertness in real time and prevent accidents caused by drowsiness, yawning, and distraction.

## How it works

- **Live camera monitoring** with a front/back camera toggle — the app continuously analyzes the driver's face through on-device ML (no cloud, works offline, no privacy concerns).
- **Drowsiness detection** — tracks eye-openness; sustained eye-closure triggers escalating alerts.
- **Yawn detection** — monitors mouth opening to catch fatigue.
- **Distraction detection** — measures head-turn angle to detect when the driver looks away from the road.

## Safety engine

The core `SafetyEngine` scores every trip and escalates alerts by severity (MILD → MODERATE → SEVERE → CRITICAL), triggering:

- 🔊 Voice alerts (text-to-speech)
- 📳 Haptic/vibration feedback
- 🚨 Siren + visual strobe for critical drowsiness
- 📊 Live safety score with a trip summary and infraction report

| Event | Points Deducted |
|-------|-----------------|
| Distraction | -2 |
| Eyes Closed (per event) | -2 |
| Yawn | -5 |
| Severe Drowsiness | -15 |

**Score Ranges:** Green (80-100) safe · Yellow (50-79) mild concern · Red (0-49) critical

## Tech stack

- **React Native + Expo** (SDK 57), TypeScript
- **Google ML Kit** face detection (landmarks, contours, classification)
- **expo-camera** for live video capture
- **expo-audio / expo-speech / expo-haptics** for alerts
- React Context + useReducer for state management

## Getting started

```bash
# Install dependencies
npm install

# Start Metro (JS bundler)
npx expo start

# Run on Android (device or emulator with API 24+)
npm run android
```

> Requires **Android 7.0+ (API 24)**. Camera permission is required for live monitoring.

## Project structure

```
src/
├── driverSignals.ts        # ML Kit face data → driver metrics extraction
├── types/SafetyTypes.ts    # TypeScript types, enums, thresholds
├── safety/SafetyEngine.ts  # Core detection logic (drowsiness, yawn, distraction)
├── alarm/AlarmManager.ts   # Escalating alarm system (TTS, haptics, siren, strobe)
├── state/DriverContext.tsx # React Context for global state
├── components/Dashboard.tsx# Live dashboard, trip summary
└── components/ErrorBoundary.tsx
App.tsx                     # Camera integration, detection loop, flow control
```

## Why it matters

Driver fatigue is a leading cause of road accidents. Netra Driver Guardian runs **fully on-device** — private, fast, and works anywhere — giving drivers a real-time guardian that catches the signs of fatigue before a crash happens.

**"Your co-driver that never sleeps."** 👁️

---

*For demo purposes only. Always drive safely.*
