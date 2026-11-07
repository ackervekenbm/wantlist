import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: false,
    // Server and research tests run in node; client tests under src/client
    // run in jsdom (see `projects`).
    projects: [
      {
        extends: true,
        test: { name: 'server', environment: 'node', include: ['tests/**/*.test.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'client',
          environment: 'jsdom',
          include: ['src/client/**/*.test.{ts,tsx}'],
          setupFiles: ['./src/client/test/setup.ts'],
        },
      },
    ],
  },
})
