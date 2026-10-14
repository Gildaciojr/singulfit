'use strict';
const js = require('@eslint/js');
const globals = require('globals');
module.exports = [
  js.configs.recommended,
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
];
