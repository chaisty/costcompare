import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Playwright specs live in e2e/ and use their own test runner; keep them
    // out of vitest's discovery so `npm test` doesn't try to load Playwright's
    // globals in a jsdom environment.
    exclude: ['node_modules', 'dist', 'e2e/**'],
  },
});
