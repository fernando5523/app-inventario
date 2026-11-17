import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * `/api` se proxea al backend de ESTE repo (`backend/`, puerto 3000), que no es
 * el de app_pdv. El 5173 por defecto de Vite se cambio a propósito: en esta
 * máquina suele estar tomado por otro cliente, y un puerto ocupado hace que
 * Vite salte al siguiente sin avisar mucho -- mejor fijarlo.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5181,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
