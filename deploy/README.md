# 部署说明

## 字幕识别模型代理(在线版必需)

字幕识别的 Whisper 模型从 hf-mirror 下载,但其重定向链的 CORS 头只允许自身域,
浏览器无法直接跨域下载。解决方式:部署一个同源(或支持 CORS)的代理。

### 方式一:Cloudflare Worker(免费额度足够)

```bash
cd deploy
npm install -g wrangler
wrangler login        # 需要你自己的 Cloudflare 账号
wrangler deploy
```

部署后会得到 `https://cutforge-model-proxy.<你的子域>.workers.dev`。
让用户在应用控制台执行一次:

```js
localStorage.setItem('cutforge.asr.host', 'https://cutforge-model-proxy.<你的子域>.workers.dev/hf-proxy')
```

或在代码里把默认值写入(见 src/asr/subtitles.ts 的 resolveModelHost)。

### 方式二:自建静态服务器反代(nginx 示例)

```nginx
location /hf-proxy/ {
    proxy_pass https://hf-mirror.com/;
    proxy_set_header Host hf-mirror.com;
    add_header Access-Control-Allow-Origin * always;
}
```

### 本地开发

无需配置——`vite.config.ts` 已内置 `/hf-proxy` 开发中间件。
