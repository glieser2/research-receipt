import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ base: './', plugins: [react()], server: { strictPort: true, port: 5173, watch: { usePolling: true, interval: 300, ignored: ['**/*.tmp'] } } });
