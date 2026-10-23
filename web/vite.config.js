import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Em desenvolvimento, as chamadas /api vão para a API na porta 3001
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:3001' } },
  preview: { port: 5173, proxy: { '/api': 'http://localhost:3001' } },
});
