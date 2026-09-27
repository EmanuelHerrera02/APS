import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

/**
 * Config de ESLint (formato plano, el de ESLint 9).
 *
 * Ojo con dos cosas que quedaron desactualizadas en el repo y que esta config
 * corrige:
 *
 * - El script de lint era `eslint src --ext .js,.jsx`. En ESLint 9 el flag
 *   --ext se eliminó: los patrones salen de acá. Por eso el script es
 *   `eslint .` y no `eslint src`.
 *
 * - `react/prop-types` está apagado. El proyecto no usa PropTypes, documenta
 *   los props con JSDoc (MainLayout es el ejemplo), y con la regla activada cada
 *   componente de función del repo da error.
 */
export default [
  {
    // Por defecto eslint solo mira .js. Acá se le agregan los .jsx, que es lo
    // que hacía el --ext eliminado.
    files: ['**/*.{js,jsx}'],
    ignores: ['dist/**', 'node_modules/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: '18.2' },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
    },
  },
];
