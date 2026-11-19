import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { buildDefine } from './vite.config.mjs'

export default defineConfig({
  plugins: [react()],
  define: buildDefine,
  test: {
    globals: false,
    // Tests sit next to the code they test: server ones run in node, client
    // ones in jsdom (see `projects`).
    projects: [
      {
        extends: true,
        test: { name: 'server', environment: 'node', include: ['src/server/**/*.test.ts'] },
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
