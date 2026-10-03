// dsh-water-treatment-engineering —— host 插件（cordis 面）。
// 侧边栏「工作台」按钮的宿主侧：/api/workbench/{status,start,stop} 三个路由。
// 契约（与官方 dsh-pack-plugin/src/index.js 一致）：
//   - 第三方 bundle 的宿主→客户端直连路由走 webServer（ctx.connection.rpc.handle 对第三方不可用）；
//   - ctx.profileContext 直接给出 home / 当前 profile 事实（零猜路径）。
// 路径契约：工作台在 <profileDir>/wta/ui/（整合包 overrides/ 落点），由整合包 manifest 声明。
import { resolveRuntime } from './runtime.js';
import { findRunning, startWorkbench, stopWorkbench } from './workbench.js';

export const name = 'dsh-water-treatment-engineering';

export const inject = ['webServer', 'connection'];

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
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
    'dsh-water-treatment-engineering: GET /api/workbench/status',
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
    'dsh-water-treatment-engineering: POST /api/workbench/start',
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
    'dsh-water-treatment-engineering: POST /api/workbench/stop',
  );
}
