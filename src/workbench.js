// 工作台进程管理：启动 / 停止 / 状态探测。
// 路径契约（由整合包 manifest 声明、导入器落盘，本模块不硬编码绝对路径）：
//   工作台 = <profileDir>/wta/ui/server.py   （整合包 overrides/ 落点）
//   pydeps = <profileDir>/pydeps/            （整合包 files[] 落点）
// profileDir 由 resolveRuntime 提供（见 runtime.js）。
import { spawn, execFile } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

const START_PORT = 8618;
const END_PORT = 8628;

export function workbenchDir(profileDir) {
  return profileDir ? path.join(profileDir, 'wta', 'ui') : null;
}

/** 探测运行中的工作台（端口范围 + /api/health 指纹）。 */
export async function findRunning() {
  for (let port = START_PORT; port <= END_PORT; port++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 700);
      const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (r.ok) {
        const j = await r.json().catch(() => null);
        if (j && j.name === 'integration-pack-workbench') return port;
      }
    } catch { /* 未运行，继续 */ }
  }
  return null;
}

/** 探测可用的 pythonw.exe 绝对路径（GUI 子系统，不弹控制台）；找不到返回 null。 */
export async function resolvePythonw() {
  const env = process.env.PYTHONW_EXE;
  if (env && existsSync(env)) return env;
  // 扫描 %LOCALAPPDATA%\Programs\Python\<版本>\pythonw.exe（新版本优先）
  const local = process.env.LOCALAPPDATA;
  if (local) {
    const base = path.join(local, 'Programs', 'Python');
    try {
      if (existsSync(base)) {
        for (const d of readdirSync(base).sort().reverse()) {
          const c = path.join(base, d, 'pythonw.exe');
          if (existsSync(c)) return c;
        }
      }
    } catch { /* 忽略扫描失败 */ }
  }
  // 通过 py 启动器推导同目录 pythonw.exe
  try {
    const exe = await new Promise((resolve) => {
      execFile('py', ['-3', '-c', 'import sys;print(sys.executable)'],
        { windowsHide: true },
        (err, stdout) => resolve(err ? null : String(stdout).trim()));
    });
    if (exe && exe.toLowerCase().endsWith('python.exe')) {
      const w = exe.slice(0, -'python.exe'.length) + 'pythonw.exe';
      if (existsSync(w)) return w;
    }
  } catch { /* 忽略 */ }
  return null;
}

/** 后台启动工作台（spawn server.py --port-file），返回 { port } 或 { error }。 */
export async function startWorkbench(profileDir) {
  const dir = workbenchDir(profileDir);
  const server = dir ? path.join(dir, 'server.py') : null;
  if (!server || !existsSync(server)) {
    return { error: '工作台未找到（<profile>/wta/ui/server.py）。请确认整合包已完整导入。' };
  }
  const pyw = await resolvePythonw();
  if (!pyw) {
    return { error: '未找到 Python（pythonw.exe）。请先安装 Python 3.12（勾选 py launcher）后重试。' };
  }
  const portFile = path.join(tmpdir(), `dsh-workbench-${process.pid}-${Date.now()}.port`);
  const proc = spawn(pyw, [server, '--port-file', portFile], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  // 捕获 spawn 失败（如可执行文件不存在），否则未处理异常会崩掉宿主 DSH
  proc.on('error', () => { /* 静默；返回错误由下方超时路径给出 */ });
  proc.unref();
  let port = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (existsSync(portFile)) {
      try { port = parseInt(readFileSync(portFile, 'utf8').trim(), 10); } catch { /* 忽略 */ }
      if (port) break;
    }
    if (proc.exitCode !== null) break;
  }
  if (!port) {
    return { error: '工作台启动超时（15 秒内未就绪）。' };
  }
  return { port };
}

/** 停止工作台（调 /api/shutdown 优雅退出）。 */
export async function stopWorkbench() {
  const port = await findRunning();
  if (port) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST', signal: ctrl.signal });
      clearTimeout(timer);
    } catch { /* 忽略 */ }
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 250));
      if (!(await findRunning())) break;
    }
  }
}
