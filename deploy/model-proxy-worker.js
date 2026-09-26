// CutForge 字幕识别模型代理(Cloudflare Worker)
// 作用:为在线版(GitHub Pages 等静态部署)提供 hf-mirror 的同源 CORS 代理,
// 让浏览器能下载 Whisper 模型文件。不缓存、不记录任何用户数据。
//
// 部署(免费额度足够个人项目):
//   1. 安装 wrangler:npm install -g wrangler
//   2. 登录:wrangler login
//   3. 部署:在本目录执行 wrangler deploy
//   4. 把得到的 https://<name>.<account>.workers.dev 地址填入应用:
//      localStorage.setItem('cutforge.asr.host', 'https://<name>.<account>.workers.dev/hf-proxy')
//      (或部署后在 Worker 里改 ALLOWED_ORIGIN 常量为你的站点域名)

const UPSTREAM = 'https://hf-mirror.com';
// 可选:限制来源,留空 '*' 表示允许任意站点使用(个人使用建议改成你的站点)
const ALLOWED_ORIGIN = '*';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request),
      });
    }
    // 只代理 /hf-proxy/<path> 到 hf-mirror
    const match = url.pathname.match(/^\/hf-proxy\/(.*)$/);
    if (!match) {
      return new Response('CutForge model proxy. Usage: /hf-proxy/<hf-mirror-path>', { status: 200, headers: corsHeaders(request) });
    }
    const upstreamUrl = `${UPSTREAM}/${match[1]}${url.search}`;
    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers: filterHeaders(request.headers),
      redirect: 'follow',
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    });
    const headers = new Headers();
    for (const [key, value] of upstream.headers) {
      if (!['access-control-allow-origin', 'content-encoding', 'transfer-encoding'].includes(key.toLowerCase())) {
        headers.set(key, value);
      }
    }
    headers.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN === '*' ? '*' : request.headers.get('Origin') ?? ALLOWED_ORIGIN);
    headers.set('X-Proxied-By', 'cutforge-model-proxy');
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};

function corsHeaders(request) {
  const origin = request.headers.get('Origin') ?? '*';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN === '*' ? '*' : origin,
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range',
    'Access-Control-Max-Age': '86400',
  };
}

function filterHeaders(headers) {
  const filtered = new Headers();
  for (const [key, value] of headers) {
    if (['host', 'origin', 'referer', 'cookie'].includes(key.toLowerCase())) continue;
    filtered.set(key, value);
  }
  return filtered;
}
