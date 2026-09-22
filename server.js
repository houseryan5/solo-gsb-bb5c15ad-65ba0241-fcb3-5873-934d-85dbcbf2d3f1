// 零依赖静态服务器：提供原生 HTML/CSS/JS 页面
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function sendFile(res, filePath, statusCode = 200) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(statusCode, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // 开发工具页面，禁用缓存保证刷新即最新
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // 解析请求路径并防止目录穿越
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const safePath = path
    .normalize(path.join(PUBLIC_DIR, pathname))
    .startsWith(PUBLIC_DIR)
    ? path.join(PUBLIC_DIR, pathname)
    : null;

  if (!safePath) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(safePath, (err, stat) => {
    if (err || !stat.isFile()) {
      sendFile(res, path.join(PUBLIC_DIR, 'index.html'), 404);
      return;
    }
    sendFile(res, safePath);
  });
});

server.listen(PORT, () => {
  console.log(`剧场排练走位工具已启动: http://localhost:${PORT}`);
});
