import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    proxy: {
      '/auth': 'http://127.0.0.1:8091',
      '/ocorrencias': 'http://127.0.0.1:8091',
      '/midia': 'http://127.0.0.1:8091',
    },
  },
})
