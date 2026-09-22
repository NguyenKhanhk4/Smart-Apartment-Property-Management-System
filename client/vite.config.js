import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Dev: gọi /api cùng origin, Vite chuyển tiếp sang backend nên không vướng CORS
    proxy: {
      '/api': { target: 'http://localhost:5000', changeOrigin: true },
    },
  },
  build: {
    // antd khá nặng; các trang nghiệp vụ nên lazy-load trong config/menu.js để tách chunk
    chunkSizeWarningLimit: 1200,
  },
});
