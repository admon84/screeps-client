import globals from 'globals';
import js from '@eslint/js'
import ts from 'typescript-eslint'
import solid from 'eslint-plugin-solid/configs/recommended'

export default [
  js.configs.recommended,
  ...ts.configs.recommended,
  solid,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'solid/no-react-specific-props': 'error',
    },
  },
  {
    files: ['src/roomRenderer/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{
          name: 'pixi.js',
          message: 'src/roomRenderer runs the PIXI 7 bundled inside @screeps/renderer (window.PIXI, via pixi7.ts); importing pixi.js v8 here would mix two PIXI versions in one scene graph.',
        }],
      }],
    },
  },
  {
    ignores: ['dist/', 'node_modules/'],
  },
]
