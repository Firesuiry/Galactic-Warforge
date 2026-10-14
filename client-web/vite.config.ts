import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const proxyTarget = process.env.VITE_SW_PROXY_TARGET ?? 'http://localhost:18080';
const agentProxyTarget = process.env.VITE_SW_AGENT_PROXY_TARGET ?? 'http://localhost:18180';

function createProxyEntry() {
  return {
    target: proxyTarget,
    changeOrigin: true,
  };
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, './src'),
      '@shared': path.resolve(rootDir, '../shared-client/src'),
    },
  },
  server: {
    proxy: {
      '/agent-api': {
        target: agentProxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/agent-api/, ''),
      },
      '/health': createProxyEntry(),
      '/metrics': createProxyEntry(),
      '/state': createProxyEntry(),
      '/world': createProxyEntry(),
      '/catalog': createProxyEntry(),
      '/events': createProxyEntry(),
      '/alerts': createProxyEntry(),
      '/commands': createProxyEntry(),
      '/admin': createProxyEntry(),
      '/save': createProxyEntry(),
      '/replay': createProxyEntry(),
      '/rollback': createProxyEntry(),
      '/audit': createProxyEntry(),
      '/games': createProxyEntry(),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    globals: true,
    // tests/ 是 Playwright 视觉基线，tests-manual/ 是手工截图脚本：都不进 vitest。
    exclude: [...configDefaults.exclude, 'tests/**', 'tests-manual/**'],
  },
});
