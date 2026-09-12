import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 相对路径:同一构建可部署到 GitHub Pages 子路径或任意静态托管
  base: './',
  server: { port: 5300 },
});
