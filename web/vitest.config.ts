import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Two test lanes:
//  - "node": the fast pure-function / jsdom suites that run in Node (default).
//  - "workers": the real Worker + RateLimiter Durable Object seam, run inside
//    workerd via @cloudflare/vitest-pool-workers (ADR-0005 / review candidate-2).
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**', 'tests/worker-runtime/**'],
        },
      },
      {
        plugins: [
          cloudflareTest({
            // Run the TypeScript Worker source (with its exported RateLimiter DO)
            // directly, instead of the built dist/worker.js the deploy uses.
            main: './src/worker.ts',
            wrangler: { configPath: './wrangler.toml' },
            miniflare: {
              compatibilityFlags: ['nodejs_compat'],
              // env-level imgchest token, so the Worker's injection path is exercised.
              bindings: { IMGCHEST_API_TOKEN: 'env-imgchest-token' },
            },
          }),
        ],
        test: {
          name: 'workers',
          include: ['tests/worker-runtime/**/*.test.ts'],
        },
      },
    ],
  },
});
