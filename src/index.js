// dsh-engineering-workbench —— host 插件（cordis 面）。
// 路由：/api/workbench/{status,start,stop}（工作台进程管理）+ /api/workbench/proxy/*（反向代理到 Python 后端）。
// 契约（与官方 dsh-pack-plugin/src/index.js 一致）：
//   - 第三方 bundle 的宿主→客户端直连路由走 webServer（ctx.connection.rpc.handle 对第三方不可用）；
//   - ctx.profileContext 直接给出 home / 当前 profile 事实（零猜路径）。
// 路径契约：工作台在 <profileDir>/wta/ui/（整合包 overrides/ 落点），由整合包 manifest 声明。
import { resolveRuntime } from './runtime.js';
import { findRunning, startWorkbench, stopWorkbench } from './workbench.js';

export const name = 'dsh-engineering-workbench';

export const inject = ['webServer', 'connection'];

const PROXY_PREFIX = '/api/workbench/proxy';
const MAX_BODY = 50 * 1024 * 1024; // 50 MB（工具调用为 JSON 或文件路径，足够）

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      chunks.push(c);
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// 过滤 hop-by-hop 头（反向代理不应原样转发这些）
const HOP_HEADERS = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'te', 'proxy-authorization', 'proxy-authenticate']);

function filterHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!HOP_HEADERS.has(String(k).toLowerCase())) out[k] = v;
  }
  return out;
}

export function apply(ctx) {
  const runtime = resolveRuntime(ctx);
  const connection = Reflect.get(ctx, 'connection');
  const rejected = (req, res) => {
    const rejection = connection?.requestRejection?.(req);
    if (rejection === undefined) return false;
    res.statusCode = rejection;
    res.end();
    return true;
  };
  const guardPost = (req, res) => {
    if (rejected(req, res)) return true;
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('allow', 'POST');
      res.end();
      return true;
    }
    return false;
  };

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: '/api/workbench/status',
      handler: async (req, res) => {
        if (rejected(req, res)) return;
        const port = await findRunning();
        sendJson(res, 200, { running: port !== null, port });
      },
    }),
    'dsh-engineering-workbench: GET /api/workbench/status',
  );

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: '/api/workbench/start',
      handler: async (req, res) => {
        if (guardPost(req, res)) return;
        const already = await findRunning();
        if (already) { sendJson(res, 200, { ok: true, port: already }); return; }
        const result = await startWorkbench(runtime.profileDir);
        if (result.error) { sendJson(res, 500, { ok: false, error: result.error }); return; }
        sendJson(res, 200, { ok: true, port: result.port });
      },
    }),
    'dsh-engineering-workbench: POST /api/workbench/start',
  );

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: '/api/workbench/stop',
      handler: async (req, res) => {
        if (guardPost(req, res)) return;
        await stopWorkbench();
        sendJson(res, 200, { ok: true });
      },
    }),
    'dsh-engineering-workbench: POST /api/workbench/stop',
  );

  // 反向代理：/api/workbench/proxy/* → http://127.0.0.1:<port>/*（Python 后端）
  // 让 DSH 内部 UI 与 Python 后端同源通信，避免跨端口 CORS。
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: PROXY_PREFIX,
      handler: async (req, res) => {
        if (rejected(req, res)) return;
        const port = await findRunning();
        if (!port) { sendJson(res, 503, { ok: false, error: '工作台未运行，请先启动。' }); return; }
        // 剥离 /api/workbench/proxy 前缀，剩余路径转发给 Python 后端
        const target = (req.url || '/').slice(PROXY_PREFIX.length) || '/';
        const upstream = `http://127.0.0.1:${port}${target}`;
        let body;
        try {
          body = (req.method !== 'GET' && req.method !== 'HEAD') ? await readBody(req) : null;
        } catch (err) {
          sendJson(res, 413, { ok: false, error: String(err.message || err) });
          return;
        }
        try {
          const r = await fetch(upstream, {
            method: req.method,
            headers: filterHeaders(req.headers),
            body: body && body.length ? body : undefined,
          });
          const data = Buffer.from(await r.arrayBuffer());
          res.statusCode = r.status;
          for (const [k, v] of r.headers) {
            if (!HOP_HEADERS.has(k.toLowerCase())) res.setHeader(k, v);
          }
          res.end(data);
        } catch (err) {
          sendJson(res, 502, { ok: false, error: '后端转发失败：' + String(err.message || err) });
        }
      },
    }),
    'dsh-engineering-workbench: /api/workbench/proxy/*',
  );
}
