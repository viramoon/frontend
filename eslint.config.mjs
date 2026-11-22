import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import { featureBoundaries } from './scripts/feature-boundaries.mjs';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'src/api/generated/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.mjs', 'vite.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: {
      architecture: { rules: { 'feature-boundaries': featureBoundaries } },
    },
    rules: { 'architecture/feature-boundaries': 'error' },
  },
);
