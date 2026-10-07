import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Cho phép mở dev server qua tunnel ngrok để demo/review từ xa
    allowedHosts: ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app'],
    // Dev: gọi /api cùng origin, Vite chuyển tiếp sang backend nên không vướng CORS
    proxy: {
      // Đổi port backend khi 5000 bị chiếm: VITE_PROXY_TARGET=http://localhost:5050 npm run dev
      '/api': { target: process.env.VITE_PROXY_TARGET || 'http://localhost:5000', changeOrigin: true },
    },
  },
  build: {
    // antd khá nặng; các trang nghiệp vụ nên lazy-load trong config/menu.js để tách chunk
    chunkSizeWarningLimit: 1200,
  },
});
