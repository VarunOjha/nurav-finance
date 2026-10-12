/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev: `npm run dev` on :5180 proxies /api to a backend on :8020 (the compose app
// or a bare uvicorn). Production: the FastAPI container serves the built files.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    proxy: { '/api': process.env.VITE_API_PROXY ?? 'http://localhost:8020' },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-query': ['@tanstack/react-query', 'axios'],
          'vendor-charts': ['recharts'],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
