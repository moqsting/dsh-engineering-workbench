// dsh-engineering-workbench —— host 插件（cordis 面）。
// 路由：/api/workbench/{status,start,stop}（工作台进程管理）+ /api/workbench/proxy/*（反向代理到 Python 后端）。
// 契约（与官方 dsh-pack-plugin/src/index.js 一致）：
//   - 第三方 bundle 的宿主→客户端直连路由走 webServer（ctx.connection.rpc.handle 对第三方不可用）；
//   - ctx.profileContext 直接给出 home / 当前 profile 事实（零猜路径）。
// 路径契约：工作台在 <profileDir>/wta/ui/（整合包 overrides/ 落点），由整合包 manifest 声明。
import { resolveRuntime } from './runtime.js';
import { findRunning, startWorkbench, stopWorkbench } from './workbench.js';
import { readdirSync, statSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

export const name = 'dsh-engineering-workbench';

export const inject = ['webServer', 'connection'];

// Windows 现代文件夹选择器（Vista+ 的 IFileOpenDialog / Common Item Dialog，与资源管理器同款），
// 以「前台窗口」为 owner 弹出，保证置顶在当前浏览器之上；FOS_PICKFOLDERS 进入“选择文件夹”模式。
const PICKDIR_PS = [
  "$code = @'",
  "using System;",
  "using System.Runtime.InteropServices;",
  "",
  "public static class ModernFolderPicker {",
  '    [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
  "    interface IFileDialog {",
  "        [PreserveSig] int Show(IntPtr parent);",
  "        void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);",
  "        void SetFileTypeIndex(uint iFileType);",
  "        void GetFileTypeIndex(out uint piFileType);",
  "        void Advise(IntPtr pfde, out uint pdwCookie);",
  "        void Unadvise(uint dwCookie);",
  "        void SetOptions(uint fos);",
  "        void GetOptions(out uint pfos);",
  "        void SetDefaultFolder(IShellItem psi);",
  "        void SetFolder(IShellItem psi);",
  "        void GetFolder(out IShellItem ppsi);",
  "        void GetCurrentSelection(out IShellItem ppsi);",
  "        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);",
  "        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);",
  "        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);",
  "        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);",
  "        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);",
  "        void GetResult(out IShellItem ppsi);",
  "        void AddPlace(IShellItem psi, int fdap);",
  "        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);",
  "        void Close(int hr);",
  "        void SetClientGuid(ref Guid guid);",
  "        void ClearClientData();",
  "        void SetFilter(IntPtr pFilter);",
  "    }",
  "",
  '    [ComImport, Guid("d57c7288-d4ad-4768-be02-9d969532d960"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
  "    interface IFileOpenDialog : IFileDialog {",
  "        void GetResults(out IntPtr ppenum);",
  "        void GetSelectedItems(out IntPtr ppsai);",
  "    }",
  "",
  '    [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]',
  "    class FileOpenDialogRCW { }",
  "",
  '    [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
  "    interface IShellItem {",
  "        void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);",
  "        void GetParent(out IShellItem ppsi);",
  "        void GetDisplayName(uint sigdnName, out IntPtr ppszName);",
  "        void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);",
  "        void Compare(IShellItem psi, uint hint, out int piOrder);",
  "    }",
  "",
  '    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();',
  '    [DllImport("ole32.dll")] static extern void CoTaskMemFree(IntPtr pv);',
  "",
  "    public static string Pick() {",
  "        var dlg = (IFileOpenDialog)new FileOpenDialogRCW();",
  "        dlg.SetOptions(0x20 | 0x40);",
  '        dlg.SetTitle("选择文件区目录");',
  "        int hr = dlg.Show(GetForegroundWindow());",
  "        if (hr != 0) return null;",
  "        IShellItem item;",
  "        dlg.GetResult(out item);",
  "        IntPtr psz;",
  "        item.GetDisplayName(0x80058000, out psz);",
  "        string path = Marshal.PtrToStringUni(psz);",
  "        CoTaskMemFree(psz);",
  "        return path;",
  "    }",
  "}",
  "'@",
  "Add-Type -TypeDefinition $code",
  "[ModernFolderPicker]::Pick()",
].join("\n");

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
        const server = runtime.profileDir ? path.join(runtime.profileDir, 'wta', 'ui', 'server.py') : null;
        const backend = !!(server && existsSync(server));
        sendJson(res, 200, { running: port !== null, port, backend });
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

  // 应用内目录浏览（自包含、跨平台，不依赖 server.py / directoryPicker 后端）：
  // POST /api/workbench/browse {"path": "<绝对路径>"}
  //   - 空 path → 返回「盘符/根」列表（Windows 各盘符；类 Unix 为 /），作为自由起点；
  //   - 有 path → 返回该目录的子目录列表 + 父目录（可一路向上到根）。
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: '/api/workbench/browse',
      handler: async (req, res) => {
        if (guardPost(req, res)) return;
        let body;
        try {
          body = await readBody(req);
        } catch (err) {
          sendJson(res, 413, { ok: false, error: String(err.message || err) });
          return;
        }
        let p = '';
        try { p = (JSON.parse(body.toString('utf8') || '{}').path) || ''; } catch { p = ''; }

        // 空路径 → 盘符/根列表（不固定从 profile 目录起，用户可自由选择任意位置）
        if (!p) {
          const roots = [];
          if (process.platform === 'win32') {
            for (let c = 65; c <= 90; c++) {
              const drive = String.fromCharCode(c) + ':\\';
              try { if (statSync(drive).isDirectory()) roots.push(drive); } catch { /* 盘符不存在 */ }
            }
          } else {
            roots.push('/');
          }
          sendJson(res, 200, { path: '', parent: null, roots, entries: [] });
          return;
        }

        const base = path.isAbsolute(p) ? p : path.join(os.homedir(), p);
        try {
          const dirents = readdirSync(base, { withFileTypes: true });
          const entries = dirents
            .filter((d) => !d.name.startsWith('.'))
            .map((d) => {
              const full = path.join(base, d.name);
              let isDir = d.isDirectory();
              if (d.isSymbolicLink()) { try { isDir = statSync(full).isDirectory(); } catch { /* 忽略 */ } }
              return { name: d.name, path: full, isDir };
            })
            .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, 'zh-CN') : (a.isDir ? -1 : 1)));
          const parent = path.dirname(base);
          sendJson(res, 200, { path: base, parent: parent !== base ? parent : null, roots: [], entries });
        } catch (err) {
          sendJson(res, 500, { ok: false, error: '无法读取目录：' + String(err.message || err) });
        }
      },
    }),
    'dsh-engineering-workbench: POST /api/workbench/browse',
  );

  // 文件区路径（插件自管，不依赖整合包 server.py）：
  // 配置存 <profileDir>/wta/config/ui-workspace.json —— 与 server.py 同路径，
  // 有整合包时两边共享同一份配置；纯插件环境则由本插件自行创建/维护。
  const workspaceConfigPath = () =>
    path.join(runtime.profileDir || runtime.home, 'wta', 'config', 'ui-workspace.json');
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: '/api/workbench/workspace',
      handler: async (req, res) => {
        if (rejected(req, res)) return;
        const cfg = workspaceConfigPath();
        if (req.method === 'GET') {
          let ws = '';
          try {
            const j = JSON.parse(readFileSync(cfg, 'utf8'));
            ws = typeof j.workspace === 'string' ? j.workspace : '';
          } catch { /* 未设置 */ }
          sendJson(res, 200, { workspace: ws });
          return;
        }
        if (req.method !== 'POST') {
          res.statusCode = 405; res.setHeader('allow', 'GET, POST'); res.end(); return;
        }
        let body;
        try {
          body = await readBody(req);
        } catch (err) {
          sendJson(res, 413, { ok: false, error: String(err.message || err) }); return;
        }
        let p = '';
        try { p = (JSON.parse(body.toString('utf8') || '{}').path) || ''; } catch { p = ''; }
        if (!p || !path.isAbsolute(p)) { sendJson(res, 400, { ok: false, error: '需要绝对路径。' }); return; }
        let isDir = false;
        try { isDir = statSync(p).isDirectory(); } catch { /* 不存在 */ }
        if (!isDir) { sendJson(res, 400, { ok: false, error: '目录不存在。' }); return; }
        try {
          mkdirSync(path.dirname(cfg), { recursive: true });
          writeFileSync(cfg, JSON.stringify({ workspace: p }, null, 2), 'utf8');
        } catch (err) {
          sendJson(res, 500, { ok: false, error: '保存失败：' + String(err.message || err) }); return;
        }
        sendJson(res, 200, { ok: true, workspace: p });
      },
    }),
    'dsh-engineering-workbench: /api/workbench/workspace',
  );

  // 现代文件夹选择器（IFileOpenDialog，与资源管理器同款）—— 置顶在当前窗口之上。
  // 非 Windows 或调用失败时，前端回退到应用内目录浏览器。
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: '/api/workbench/pickdir',
      handler: async (req, res) => {
        if (guardPost(req, res)) return;
        if (process.platform !== 'win32') {
          sendJson(res, 501, { ok: false, error: '非 Windows 平台不支持原生目录对话框。' });
          return;
        }
        const encoded = Buffer.from(PICKDIR_PS, 'utf16le').toString('base64');
        execFile('powershell', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
          { windowsHide: true, timeout: 300000, encoding: 'utf8', maxBuffer: 1024 * 1024 },
          (err, stdout) => {
            if (err) {
              sendJson(res, 500, { ok: false, error: '原生对话框调用失败：' + String(err.message || err) });
              return;
            }
            const chosen = String(stdout || '').trim();
            sendJson(res, 200, { ok: true, path: chosen || null });
          });
      },
    }),
    'dsh-engineering-workbench: POST /api/workbench/pickdir',
  );
}
