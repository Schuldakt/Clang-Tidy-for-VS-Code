import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  // 1. Tell ESLint which files to ignore globally
  {
    ignores: ['node_modules/', 'dist/', 'build/', 'out/'],
  },

  // 2. Apply the recommended JavaScript linting rules
  tseslint.configs.recommended,

  {
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

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
