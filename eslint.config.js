const expoConfig = require('eslint-config-expo/flat');
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  {
    ignores: ['node_modules/**', '.expo/**', 'android/**', 'ios/**', 'dist/**'],
  },
  ...expoConfig,
  {
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      // Unused values are a real signal in safety code — a dropped return value
      // or an ignored promise is how alarms silently stop firing.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    files: ['__tests__/**/*.ts?(x)'],
    rules: {
      'no-console': 'off',
    },
  }
);