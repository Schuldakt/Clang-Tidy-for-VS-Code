import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  // 1. Tell ESLint which files to ignore globally
  {
    ignores: ['node_modules/', 'dist/', 'build/'],
  },

  // 2. Apply the recommended JavaScript linting rules
  tseslint.configs.recommended,

  // 3. Configure environments and custom overrides
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-console': 'off',
    },
  },
]);
