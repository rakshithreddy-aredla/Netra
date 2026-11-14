import { DemoSignalSource } from '../src/demo/demoSignals';

describe('DemoSignalSource', () => {
  it('produces alert, yawn, distracted and face-unseen scenarios over time', () => {
    let now = 1_000_000;
    const source = new DemoSignalSource(() => now);

    const scenarios = new Set<string>();
    // Long enough to walk the whole scenario rotation several times.
    for (let i = 0; i < 200; i += 1) {
      now += 500;
      source.next();
      scenarios.add(source.currentScenario);
    }

    expect(scenarios).toContain('alert');
    expect(scenarios).toContain('yawn');
    expect(scenarios).toContain('distracted');
    expect(scenarios).toContain('unseen');
  });

  it('holds eye closure long enough to cross the severe-drowsiness threshold', () => {
    let now = 1_000_000;
    const source = new DemoSignalSource(() => now);

    // The severe gate needs 2500ms of sustained shutdown. At one sample per
    // 500ms that is at least six consecutive closed-eye readings.
    let run = 0;
    let longestRun = 0;

    for (let i = 0; i < 400; i += 1) {
      now += 500;
      const { eyeOpenness, faceDetected } = source.next();
      const shut = faceDetected && eyeOpenness !== null && eyeOpenness < 0.15;

      run = shut ? run + 1 : 0;
      longestRun = Math.max(longestRun, run);
    }

    expect(longestRun).toBeGreaterThanOrEqual(6);
  });

  it('never emits a value in the dead zone the old generator produced', () => {
    // The previous generator produced 0.2-1.0, which could never reach the 0.15
    // severe-drowsiness cutoff, so the alarm could never fire in demo mode.
    let now = 1_000_000;
    const source = new DemoSignalSource(() => now);

    let sawSevere = false;
    for (let i = 0; i < 400; i += 1) {
      now += 500;
      const { eyeOpenness, faceDetected } = source.next();
      if (faceDetected && eyeOpenness !== null && eyeOpenness < 0.15) {
        sawSevere = true;
        break;
      }
    }

    expect(sawSevere).toBe(true);
  });

  it('reports faceDetected=false for the unseen scenario', () => {
    let now = 1_000_000;
    const source = new DemoSignalSource(() => now);

    for (let i = 0; i < 400; i += 1) {
      now += 500;
      const metrics = source.next();
      if (source.currentScenario === 'unseen') {
        expect(metrics.faceDetected).toBe(false);
        expect(metrics.eyeOpenness).toBeNull();
      }
    }
  });

  it('always reports a face during normal and alert scenarios', () => {
    let now = 1_000_000;
    const source = new DemoSignalSource(() => now);

    for (let i = 0; i < 400; i += 1) {
      now += 500;
      const metrics = source.next();
      if (source.currentScenario === 'normal' || source.currentScenario === 'alert') {
        expect(metrics.faceDetected).toBe(true);
      }
    }
  });

  it('restarts the rotation on reset', () => {
    let now = 1_000_000;
    const source = new DemoSignalSource(() => now);

    for (let i = 0; i < 100; i += 1) {
      now += 500;
      source.next();
    }

    source.reset();
    now += 500;
    source.next();
    expect(source.currentScenario).toBe('normal');
  });
});