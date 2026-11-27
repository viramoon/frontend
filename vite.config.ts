import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const target = process.env.WEB_PROXY_TARGET ?? 'http://127.0.0.1:8090';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { proxy: { '/api': { target, ws: true }, '/healthz': target } },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    restoreMocks: true,
  },
});
