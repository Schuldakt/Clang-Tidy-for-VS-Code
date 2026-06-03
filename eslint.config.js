import js from '@eslint/js';
import globals from 'globals';

export default [
  // 1. Tell ESLint which files to ignore globally
  {
    ignores: ['node_modules/', 'dist/', 'build/'],
  },

  // 2. Apply the recommended JavaScript linting rules
  js.configs.recommended,

  // 3. Configure environments and custom overrides
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
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
];
