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
- 🚨 Bundled siren for severe and critical drowsiness
- ⚡ Full-screen flash for critical drowsiness
- 📊 Live safety score with a trip summary and infraction report

Each signal runs through the same latch: it opens an episode when the metric crosses its
trigger threshold, holds it until the metric moves back past a separate **clear** threshold
(hysteresis, so a metric hovering on the boundary cannot make the alarm flap), and reports the
episode's real elapsed duration when it closes. **Points are deducted at most once per
episode**, never once per frame.

| Event | Points Deducted |
|-------|-----------------|
| Distraction | -2 |
| Eyes Closed (per episode) | -3 |
| Yawn | -5 |
| Face Not Visible | -4 |
| Severe Drowsiness | -15 |

Severe drowsiness supersedes eyes-closed, so a single incident is never charged twice.

**Yawn detection is calibrated per driver.** The raw metric is nose-base-to-lower-lip
distance over face height, which is already ~30–40% of face height with the mouth shut and
scales with face shape and camera distance. A fixed threshold either never fires or fires
constantly, so the engine learns each driver's closed-mouth baseline (a deliberately slow
running mean that a brief yawn barely moves) and triggers at roughly 18% above it.

**Face loss** is bridged by a 3-second grace window: a momentary dropout does not discard
progress, but a driver whose face stays out of frame raises a `FACE_UNSEEN` alert — which is
how "looking fully away" becomes detectable at all, since ML Kit loses the face in that case.

The live dashboard shows the raw eye / mouth / head signals against their thresholds. A
signal that cannot be resolved reads `n/a` in orange rather than silently looking calm —
detection failures are otherwise invisible from the outside.

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

## Development commands

```bash
npm test              # Jest unit + integration suite
npm run test:coverage # with coverage (70% thresholds on the logic layer)
npm run typecheck     # tsc --noEmit
npm run lint          # ESLint
```

## Project structure

```
src/
├── driverSignals.ts        # ML Kit face data → driver metrics extraction
├── types/SafetyTypes.ts    # TypeScript types, enums, thresholds
├── safety/SafetyEngine.ts  # Core detection logic (drowsiness, yawn, distraction)
├── alarm/AlarmManager.ts   # Escalating alarm system (TTS, haptics, siren)
├── state/DriverContext.tsx # React Context for global state
├── hooks/
│   └── useFaceDetectionLoop.ts  # Camera sampling + AppState lifecycle
├── demo/
│   └── demoSignals.ts           # Scripted demo scenarios
├── components/Dashboard.tsx# Live dashboard, trip summary, critical flash
└── components/ErrorBoundary.tsx
assets/
└── siren.wav              # Bundled alert tone — works with no network
App.tsx                     # Camera integration, flow control
```

### A note on ML Kit landmarks

The face-detection library declares camelCase landmark names (`"noseBase"`,
`"bottomMouth"`), but its native Android module emits the landmark as a **numeric
identifier** instead. Matching the declared strings therefore silently yields no landmarks,
which leaves `mouthOpenness` null and makes yawn detection impossible. `driverSignals.ts`
accepts numbers, numeric strings and both naming conventions so it works regardless of what
the bridge hands back.

## Notes on the detection pipeline

Camera v57 exposes no frame-by-frame API, so the app samples with `takePictureAsync` and runs
ML Kit over each captured JPEG. That write-to-disk round trip cannot be removed without native
code. The loop is kept cheap and well-behaved instead: one interval at a time, no overlapping
detections, paused when the app is backgrounded (Android throws if you capture while the preview
is paused), and each captured frame is deleted after analysis so a long trip cannot fill the
cache.

Alarms are idempotent per warning level, so a sustained condition does not restart speech or
re-create the native audio player on every frame.

## Why it matters

Driver fatigue is a leading cause of road accidents. Netra Driver Guardian runs **fully on-device** — private, fast, and works anywhere — giving drivers a real-time guardian that catches the signs of fatigue before a crash happens.

**"Your co-driver that never sleeps."** 👁️

---

*For demo purposes only. Always drive safely.*
