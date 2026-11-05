import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base: './'` keeps the production build relocatable so `dist/` can be
// dropped into any static host or sub-path as a standalone animation.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5173, strictPort: false },
});
