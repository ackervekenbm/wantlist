import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { license?: string }

/**
 * Build facts for the About section. The image build passes COMMIT_SHA,
 * BUILD_TIME and GITHUB_REPOSITORY; a local build falls back to dev values.
 * The license is package.json's `license` field (empty while none is chosen).
 */
export const buildDefine = {
  __BUILD_SHA__: JSON.stringify(process.env.COMMIT_SHA || 'dev'),
  __BUILD_TIME__: JSON.stringify(process.env.BUILD_TIME || ''),
  __REPO__: JSON.stringify(process.env.GITHUB_REPOSITORY || 'ackervekenbm/wantlist'),
  __LICENSE__: JSON.stringify(pkg.license ?? ''),
}

export default defineConfig({
  plugins: [react()],
  define: buildDefine,
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    host: true,
    port: 5174,
    proxy: {
      '/api': 'http://127.0.0.1:3091',
    },
  },
})