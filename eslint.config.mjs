import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import prettier from 'eslint-config-prettier'

/**
 * Keys that must never reach the browser bundle. `src/lib/env/server.ts` is the
 * single place allowed to read them, and it imports `server-only` so any client
 * component that pulls it in fails the build rather than leaking at runtime.
 */
const SERVER_ONLY_ENV = ['SUPABASE_SECRET_KEY', 'DEEPGRAM_API_KEY', 'DEEPSEEK_API_KEY']

const serverEnvRules = SERVER_ONLY_ENV.map((name) => ({
  selector: `MemberExpression[object.object.name='process'][object.property.name='env'][property.name='${name}']`,
  message: `${name} is server only. Read it from @/lib/env/server, never from process.env directly.`,
}))

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    rules: {
      'no-restricted-syntax': ['error', ...serverEnvRules],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // The one module allowed to touch the server-only keys.
    files: ['src/lib/env/server.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    /*
     * The rule protects the browser bundle. Inspection scripts are run by hand
     * from a terminal, are never bundled, and cannot import the app's env module
     * because it is server-only by construction.
     */
    files: ['scripts/**'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'coverage/**', 'next-env.d.ts', 'supabase/**']),
])

export default eslintConfig
