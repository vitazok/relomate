import next from 'eslint-config-next';

const config = [
  {
    ignores: ['.next', 'node_modules', 'drizzle', 'coverage'],
  },
  ...next,
  {
    name: 'visa/typescript-overrides',
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'warn',
    },
  },
];

export default config;
