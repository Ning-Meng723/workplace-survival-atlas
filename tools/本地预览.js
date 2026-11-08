/**
 * 本地预览服务器（零依赖，只用 Node 内置模块）
 *
 * 为什么需要：浏览器打开 file:// 时，fetch 读 JSON 会被安全策略拦下（CORS/file 协议限制）。
 * 入口页本身不读 JSON，双击 index.html 也能看；但一到 W06 答题页就要读题库，必须走 http。
 *
 * 用法：
 *   node "30-网页产品/web-v1/tools/本地预览.js"            # 默认 http://127.0.0.1:5173
 *   node "30-网页产品/web-v1/tools/本地预览.js" 8080       # 换端口
 *
 * 只监听 127.0.0.1（本机），不对外开放。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = path.resolve(__dirname, '..');           // 仓库根 = web-v1/
const PORT = parseInt(process.argv[2] || '5173', 10);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.md': 'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(url.parse(req.url).pathname);   // 中文文件名关键
  } catch (e) {
    res.writeHead(400); res.end('Bad Request'); return;
  }

  if (pathname === '/') pathname = '/index.html';

  const target = path.join(ROOT, pathname);
  // 防目录穿越：必须仍在仓库根内
  if (path.relative(ROOT, target).startsWith('..')) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(target, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 找不到：' + pathname);
      console.log('  404 ' + pathname);
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
    console.log('  200 ' + pathname + '  ' + data.length + 'B');
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('本地预览已启动（只监听本机，不对外）');
  console.log('  根目录：' + ROOT);
  console.log('  打开：  http://127.0.0.1:' + PORT + '/index.html');
  console.log('  停止：  Ctrl + C');
  console.log('');
});
