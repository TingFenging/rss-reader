/**
 * server.js — 简易 RSS 代理服务器
 *
 * 前端 fetch RSS 有跨域限制，这个 server 做中转，
 * 自动处理 http / https，支持重定向，返回 CORS 头。
 *
 * 启动：node server.js
 * 访问：http://localhost:3000
 */

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const STATIC_DIR = __dirname;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
};

// ----- 静态文件服务 -----
function serveStatic(res, urlPath) {
  const filePath = path.join(STATIC_DIR, urlPath === '/' ? 'index.html' : urlPath);
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
    res.end(data);
  });
}

// ----- 智能 fetch（自动选 http / https）-----
function smartGet(targetUrl, callback, onError) {
  const mod = targetUrl.startsWith('https') ? https : http;
  mod.get(targetUrl, callback).on('error', onError);
}

// ----- 代理处理 -----
function handleProxy(req, res, parsedUrl) {
  const targetUrl = parsedUrl.searchParams.get('url');
  if (!targetUrl) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '缺少 url 参数' }));
    return;
  }

  const doFetch = (url) => {
    try {
    smartGet(url,
      (proxyRes) => {
        // 重定向
        if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
          // FeedBurner 常见：重定向 URL 可能是相对路径
          const redirectUrl = proxyRes.headers.location.startsWith('http')
            ? proxyRes.headers.location
            : new URL(proxyRes.headers.location, url).href;
          doFetch(redirectUrl);
          return;
        }

        let data = '';
        proxyRes.on('data', chunk => data += chunk);
        proxyRes.on('end', () => {
          res.writeHead(200, {
            'Content-Type': 'application/xml; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
          });
          res.end(data);
        });
      },
      (err) => {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '代理抓取失败: ' + err.message }));
      }
    );
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '无效的 URL: ' + err.message }));
    }
  };

  doFetch(targetUrl.trim());
}

// ----- AI API 代理 -----
function handleAIProxy(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const { endpoint, key, model, messages, format } = JSON.parse(body);

      if (!endpoint || !key) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '缺少 endpoint 或 key' }));
        return;
      }

      const apiUrl = endpoint.replace(/\/+$/, '') + '/v1/chat/completions';
      const postData = JSON.stringify({
        model: model || 'deepseek-chat',
        messages,
      });

      const parsed = new URL(apiUrl);
      const mod = parsed.protocol === 'https:' ? https : http;

      console.log('AI 代理请求:', { hostname: parsed.hostname, path: parsed.pathname, model });

      const options = {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + key,
          'Content-Length': Buffer.byteLength(postData),
        },
      };

      const proxyReq = mod.request(options, (proxyRes) => {
        console.log('AI API 返回状态:', proxyRes.statusCode, 'URL:', apiUrl.slice(0, 60));
        let data = '';
        proxyRes.on('data', chunk => data += chunk);
        proxyRes.on('end', () => {
          if (proxyRes.statusCode >= 400) {
            console.log('AI API 错误体:', data.slice(0, 300));
          }
          res.writeHead(proxyRes.statusCode, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          });
          res.end(data);
        });
      });

      proxyReq.on('error', (err) => {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'AI API 请求失败: ' + err.message }));
      });

      proxyReq.write(postData);
      proxyReq.end();
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '请求解析失败: ' + err.message }));
    }
  });
}

// ----- 服务器 -----
const server = http.createServer((req, res) => {
  // 预检请求
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': '*',
    });
    res.end();
    return;
  }

  let parsedUrl;
  try { parsedUrl = new URL(req.url, `http://localhost:${PORT}`); }
  catch { res.writeHead(400); res.end('Bad Request'); return; }
  const pathname = parsedUrl.pathname;

  if (pathname === '/api/fetch' && req.method === 'GET') {
    handleProxy(req, res, parsedUrl);
    return;
  }

  // ---- API: AI 代理（POST）----
  if (pathname === '/api/ai' && req.method === 'POST') {
    handleAIProxy(req, res);
    return;
  }

  serveStatic(res, pathname);
});

// 全局异常兜底，不因一个坏请求而崩溃
process.on('uncaughtException', (err) => {
  console.error('未捕获异常:', err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('未捕获 Promise 拒绝:', err.message);
});

server.listen(PORT, () => {
  console.log(`RSS 阅读器已启动 → http://localhost:${PORT}`);
});
