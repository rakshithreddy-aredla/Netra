module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg)'
  ],
  moduleNameMapper: {
    // Metro resolves bundled assets; Jest cannot, so point them at a stub.
    '\\.(wav|mp3|m4a|aac|ogg|png|jpg|jpeg|gif|webp|svg|ttf|otf)$': '<rootDir>/__mocks__/assetMock.js',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  testMatch: ['**/__tests__/**/*.test.ts?(x)'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    // The camera capture hook talks to CameraView and the AppState; testing it
    // needs a heavier integration harness than this suite provides.
    '!src/hooks/**'
  ],
  coverageThreshold: {
    global: {
      statements: 70,
      branches: 70,
      functions: 70,
      lines: 70,
    },
  },
};