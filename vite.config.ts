import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 开发环境的 hf-mirror 同源代理:模型下载(Node 侧 fetch 跟随重定向,无 CORS 问题)。
 * 生产部署需在静态服务器/边缘函数上提供等价代理(如 nginx 把 /hf-proxy/ 反代到
 * https://hf-mirror.com/ 并追加 CORS 头),或通过 localStorage `cutforge.asr.host`
 * 指向任意支持 CORS 的镜像。
 */
function hfMirrorProxy(): Plugin {
  return {
    name: 'hf-mirror-proxy',
    configureServer(server) {
      server.middlewares.use('/hf-proxy', (req, res) => {
        const target = `https://hf-mirror.com${req.url ?? ''}`;
        void fetch(target, { redirect: 'follow' })
          .then(async (upstream) => {
            res.statusCode = upstream.status;
            res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/octet-stream');
            res.setHeader('Access-Control-Allow-Origin', '*');
            const body = await upstream.arrayBuffer();
            res.end(Buffer.from(body));
          })
          .catch((error: unknown) => {
            res.statusCode = 502;
            res.end(`hf proxy error: ${error instanceof Error ? error.message : String(error)}`);
          });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), hfMirrorProxy()],
  // 相对路径:同一构建可部署到 GitHub Pages 子路径或任意静态托管
  base: './',
  server: { port: 5300 },
});
