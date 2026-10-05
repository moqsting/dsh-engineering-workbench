/**
 * dsh-engineering-workbench —— 浏览器侧插件（client bundle）。
 *
 * 工作台内嵌进 DSH 原生主面板（与官方「插件」面板同机制、同位置）：
 *   - 侧栏顶部图标「工作台」与官方「插件」并列（同一 sidebar.panellist slot）；
 *   - 主区域面板含 文件 / 设置（核心页，独立可用），
 *     以及 工具 / 资源 / 环境（整合包增强页，检测到 <profile>/wta 后端才显示）；
 *   - 文件页从文件区目录开始浏览；点击文件调用 DSH 原生右侧栏文档预览。
 *
 * 核心能力（文件区路径、目录浏览、文件预览）由 host 路由与 DSH 本体直接提供，不依赖整合包；
 * 整合包相关的工具/资源/环境接口走 host 的 /api/workbench/proxy/* 反向代理（同源，避免 CORS）。
 */
window.__ModuleLoader__.load({
  id: "dsh-engineering-workbench",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    const e = React.createElement;
    const { useState, useEffect, useCallback } = React;

    // DSH 文件资源地址语法（本地实现，避免跨包 value-import 的 purity 门禁；
    // 与官方 @deepseek-ai/dsh-util-workspace-path 的 fileAddressFor 一致）。
    const FILE_ADDRESS_PREFIX = "dsh-resource://file/";
    const encodeSeg = (s) => encodeURIComponent(s).replace(/%3A/gi, ":");
    function sessionFileAddress(sessionId, p) {
      const normalized = String(p).replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
      return FILE_ADDRESS_PREFIX + "session/" + encodeSeg(sessionId) + "/"
        + normalized.split("/").map(encodeSeg).join("/");
    }

    /* ---------- API helper（走 host 反向代理） ---------- */
    async function api(path, opts) {
      const r = await fetch(path, Object.assign({ credentials: "same-origin" }, opts));
      const j = await r.json().catch(() => null);
      if (!r.ok || !j) throw new Error((j && j.error) ? j.error : `HTTP ${r.status}`);
      return j;
    }
    const get = (p) => api(p);
    const post = (p, body) => api(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });

    // 确保 Python 后端已启动（懒启动）
    var startedPromise = null;
    function ensureStarted() {
      if (!startedPromise) {
        startedPromise = (async () => {
          const s = await get("/api/workbench/status");
          if (!s.running) await post("/api/workbench/start");
        })();
      }
      return startedPromise;
    }

    /* ---------- 8 个工具定义（参数驱动） ---------- */
    const TOOLS = [
      { id: "normalize", label: "报价归一", desc: "招标清单规整为统一设备表",
        params: [{ name: "input", label: "输入文件（相对路径，.xlsx/.csv）", kind: "file" }] },
      { id: "compare", label: "报价比对", desc: "多供应商报价横向比对（2-8 份）",
        params: [{ name: "inputs", label: "输入文件（2-8 个，逗号分隔相对路径）", kind: "files" }] },
      { id: "cost", label: "成本测算", desc: "参数化成本测算（税率/运费/安装/管理/利润）",
        params: [
          { name: "input", label: "输入文件（相对路径）", kind: "file" },
          { name: "tax", label: "税率 %", kind: "number", def: 13 },
          { name: "freight", label: "运费 %", kind: "number", def: 0 },
          { name: "install", label: "安装费 %", kind: "number", def: 0 },
          { name: "admin", label: "管理费 %", kind: "number", def: 5 },
          { name: "profit", label: "利润率 %", kind: "number", def: 8 },
        ] },
      { id: "diff", label: "差异核对", desc: "投标清单 vs 报价清单逐行核对",
        params: [
          { name: "tender", label: "招标清单（相对路径）", kind: "file" },
          { name: "quote", label: "报价清单（相对路径）", kind: "file" },
        ] },
      { id: "dxf_parse", label: "CAD 识图", desc: "DXF 图纸提取设备/仪表位号清单",
        params: [{ name: "dxf", label: "DXF 图纸（相对路径）", kind: "file" }] },
      { id: "cad_env", label: "CAD 探测", desc: "探测 AutoCAD/ODA 转换能力", params: [] },
      { id: "smoke_test", label: "冒烟测试", desc: "整体自检（生成测试图纸/报价表跑通链路）", params: [] },
      { id: "bootstrap", label: "依赖重建", desc: "联网重建 Python 依赖库（pydeps）", params: [] },
    ];

    /* ---------- 通用小样式 ---------- */
    const S = {
      page: { display: "flex", flexDirection: "column", height: "100%", fontSize: 13 },
      nav: { display: "flex", flexWrap: "wrap", gap: 4, padding: "8px 12px", borderBottom: "1px solid rgba(127,127,127,0.18)" },
      body: { flex: 1, overflow: "auto", padding: 16 },
      btn: (active) => ({
        border: "none", borderRadius: 6, padding: "5px 10px", fontSize: 13, cursor: "pointer", lineHeight: 1,
        background: active ? "rgba(99,102,241,0.18)" : "transparent",
        color: active ? "inherit" : "rgba(127,127,127,0.85)", fontWeight: active ? 600 : 400,
      }),
      field: { marginBottom: 12 },
      label: { display: "block", marginBottom: 4, opacity: 0.75, fontSize: 12 },
      input: { width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 6, border: "1px solid rgba(127,127,127,0.3)", background: "transparent", color: "inherit", fontSize: 13 },
      primaryBtn: { border: "none", borderRadius: 6, padding: "7px 14px", cursor: "pointer", fontSize: 13, background: "rgba(99,102,241,0.85)", color: "#fff" },
      mono: { fontFamily: "ui-monospace, Consolas, monospace", whiteSpace: "pre-wrap", fontSize: 12, background: "rgba(127,127,127,0.08)", padding: 10, borderRadius: 6, overflow: "auto" },
      err: { color: "#ef4444", whiteSpace: "pre-wrap", fontSize: 12 },
      ok: { color: "#22c55e", fontSize: 12 },
      muted: { opacity: 0.55, fontSize: 12 },
    };

    /* ---------- 工具页 ---------- */
    function ToolsPage() {
      const [active, setActive] = useState(TOOLS[0].id);
      const tool = TOOLS.find((t) => t.id === active);
      const [form, setForm] = useState({});
      const [running, setRunning] = useState(false);
      const [result, setResult] = useState(null);
      const [error, setError] = useState(null);

      useEffect(() => { setForm({}); setResult(null); setError(null); }, [active]);

      const run = async () => {
        setRunning(true); setResult(null); setError(null);
        try {
          await ensureStarted();
          const params = {};
          for (const p of tool.params) {
            const v = form[p.name];
            if (p.kind === "files") {
              params[p.name] = String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
            } else if (p.kind === "number") {
              params[p.name] = v === "" || v === undefined ? p.def : Number(v);
            } else {
              params[p.name] = v || "";
            }
          }
          const r = await post("/api/workbench/proxy/api/run", { tool: tool.id, params });
          setResult(r);
        } catch (err) {
          setError(err && err.message ? err.message : String(err));
        } finally {
          setRunning(false);
        }
      };

      return e("div", { style: S.page },
        e("div", { style: S.nav },
          TOOLS.map((t) => e("button", { key: t.id, onClick: () => setActive(t.id), style: S.btn(active === t.id) }, t.label)),
        ),
        e("div", { style: S.body },
          e("div", { style: { fontWeight: 600, marginBottom: 4 } }, tool.label),
          e("div", { style: { ...S.muted, marginBottom: 16 } }, tool.desc),
          tool.params.map((p) => e("div", { key: p.name, style: S.field },
            e("label", { style: S.label }, p.label),
            e("input", {
              style: S.input, type: p.kind === "number" ? "number" : "text",
              value: form[p.name] === undefined ? (p.def !== undefined ? p.def : "") : form[p.name],
              onChange: (ev) => setForm(Object.assign({}, form, { [p.name]: ev.target.value })),
            }),
          )),
          e("div", { style: { marginBottom: 16 } },
            e("button", { style: S.primaryBtn, disabled: running, onClick: run }, running ? "运行中…" : "运行"),
          ),
          error ? e("div", { style: S.err }, error) : null,
          result ? e("div", null,
            result.error ? e("div", { style: S.err }, result.error) : null,
            e("div", { style: { ...S.muted, margin: "8px 0" } },
              "状态：" + result.status + (result.exit_code !== undefined ? "（退出码 " + result.exit_code + "）" : "") +
              (result.output ? " · 输出：" + result.output : "")),
            result.stdout ? e("pre", { style: S.mono }, result.stdout) : null,
            result.stderr ? e("pre", { style: S.mono }, result.stderr) : null,
          ) : null,
        ),
      );
    }

    /* ---------- 文件页（从文件区目录开始；预览走 DSH 原生查看器） ---------- */

    // 上级目录（纯字符串运算，不依赖 path 模块）
    function parentDirOf(p) {
      const s = String(p).replace(/[\\/]+$/, "");
      const i = Math.max(s.lastIndexOf("\\"), s.lastIndexOf("/"));
      return i > 0 ? s.slice(0, i) : s;
    }

    // 当前会话 id。两条来源，按可靠性排序：
    //   1) uiSession.adapter.current —— 主视图持有的会话，与主栏显示哪个面板无关
    //      （切到工作台面板不会清空 mainReference，故始终有效）；
    //   2) sidebarRight.mounted —— 仅当「对话占满主栏」(activePanelId === null) 时才有值，
    //      切到工作台面板后必为 undefined，只作兜底。
    function currentSessionId() {
      try {
        const ui = uiSessionService;
        if (ui && ui.adapter && ui.adapter.current) {
          const k = ui.adapter.current.getSnapshot().key;
          if (k) return k;
        }
      } catch { /* 落入兜底 */ }
      try {
        const m = sidebarRight && sidebarRight.mounted ? sidebarRight.mounted.getSnapshot() : void 0;
        if (m) return m;
      } catch { /* 无可用来源 */ }
      return void 0;
    }

    function FilesPage() {
      const [workspace, setWorkspace] = useState(null); // null=加载中；""=未设置
      const [cur, setCur] = useState("");
      const [parent, setParent] = useState(null);
      const [entries, setEntries] = useState([]);
      const [err, setErr] = useState(null);
      const [notice, setNotice] = useState(null);

      const loadDir = useCallback(async (p) => {
        setErr(null);
        try {
          const d = await post("/api/workbench/browse", { path: p });
          setCur(d.path || ""); setParent(d.parent || null); setEntries(d.entries || []);
        } catch (e2) { setErr(e2.message); }
      }, []);

      useEffect(() => {
        (async () => {
          try {
            const d = await get("/api/workbench/workspace");
            setWorkspace(d.workspace || "");
            if (d.workspace) await loadDir(d.workspace);
          } catch (e2) { setWorkspace(""); setErr(e2.message); }
        })();
      }, [loadDir]);

      // 用 DSH 原生文件查看器打开（右侧栏 documentPreview：文本/markdown/图片/PDF/Excel/Office）
      const previewFile = (it) => {
        if (!sidebarRight || typeof sidebarRight.openResource !== "function") { setErr("当前 DSH 环境不提供原生文件预览。"); return; }
        const sessionId = currentSessionId();
        if (!sessionId) {
          setErr("当前没有活动会话，无法使用原生预览；请先在对话中打开或新建一个会话。");
          return;
        }
        try { sidebarRight.openResource(sessionFileAddress(sessionId, it.path)); setErr(null); setNotice(null); }
        catch (e2) { setErr("打开预览失败：" + String(e2 && e2.message ? e2.message : e2)); }
      };

      // 在系统文件管理器中定位；系统不提供文件管理器时（受限/无 shell 环境），
      // 退回工作台内的目录定位，保证任何环境都有确定行为。
      const revealInExplorer = async (it) => {
        const targetDir = it.isDir ? it.path : parentDirOf(it.path);
        let reason = null;
        try {
          const r = await post("/api/workbench/reveal", { path: it.path });
          if (r && r.ok) { setErr(null); setNotice(null); return; }
          reason = (r && r.error) ? r.error : "未知原因";
        } catch (e2) { reason = e2.message; }
        try {
          await loadDir(targetDir);
          setNotice("系统文件管理器不可用（" + reason + "），已在工作台内定位到该目录。");
        } catch (e2) {
          setErr("无法定位：" + reason + "；工作台内跳转也失败：" + e2.message);
        }
      };
      const rowStyle = { display: "flex", gap: 8, padding: "5px 8px", cursor: "pointer", borderRadius: 6, alignItems: "center" };
      const hover = {
        onMouseEnter: (ev) => { ev.currentTarget.style.background = "rgba(127,127,127,0.1)"; },
        onMouseLeave: (ev) => { ev.currentTarget.style.background = "transparent"; },
      };

      if (workspace === null) {
        return e("div", { style: S.page }, e("div", { style: S.body }, e("div", { style: S.muted }, "加载中…")));
      }
      if (!workspace) {
        return e("div", { style: S.page }, e("div", { style: S.body },
          e("div", { style: { fontWeight: 600, marginBottom: 8 } }, "尚未设置文件区"),
          e("div", { style: S.muted }, "请到「设置」页选择文件区目录；设置后这里会显示文件区内的文件与目录。")));
      }
      const atRoot = cur && cur.toLowerCase() === workspace.toLowerCase();
      const relShown = cur && cur.length > workspace.length
        ? cur.slice(workspace.length).replace(/^[\\/]+/, "")
        : "";
      return e("div", { style: S.page },
        e("div", { style: S.nav },
          (!atRoot && parent) ? e("button", { style: S.btn(false), onClick: () => loadDir(parent) }, "↑ 上级") : null,
          e("button", { style: S.btn(false), onClick: () => loadDir(workspace) }, "文件区根"),
          e("span", { style: { ...S.muted, alignSelf: "center", marginLeft: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
            relShown || "（文件区根）"),
        ),
        e("div", { style: S.body },
          err ? e("div", { style: S.err }, err) : null,
          notice ? e("div", { style: { ...S.muted, marginBottom: 8 } }, notice) : null,
          entries.map((it) => e("div", {
            key: it.path, style: rowStyle, ...hover,
            onClick: () => (it.isDir ? loadDir(it.path) : previewFile(it)),
          },
            e("span", null, it.isDir ? "📁" : "📄"),
            e("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, it.name),
            e("button", { style: S.btn(false), onClick: (ev) => { ev.stopPropagation(); revealInExplorer(it); } }, "打开位置"),
          )),
          entries.length === 0 && !err ? e("div", { style: S.muted }, "（空目录）") : null,
        ),
      );
    }

    /* ---------- 资源页 ---------- */
    function ResourcesPage() {
      const [data, setData] = useState(null);
      const [err, setErr] = useState(null);
      useEffect(() => {
        (async () => { try { await ensureStarted(); setData(await get("/api/workbench/proxy/api/resources")); } catch (e2) { setErr(e2.message); } })();
      }, []);
      return e("div", { style: S.page },
        e("div", { style: S.body },
          err ? e("div", { style: S.err }, err) : null,
          data ? e("div", null,
            e("div", { style: { fontWeight: 600, marginBottom: 8 } }, "快捷目录"),
            (data.quickDirs || []).map((q) => e("div", { key: q.rel || "root", style: { padding: "4px 0" } },
              e("span", { style: S.mono }, q.rel || "（文件区）"), " — ", q.name, e("span", { style: S.muted }, "  " + (q.note || "")))),
            (data.groups || []).map((g) => e("div", { key: g.title, style: { marginTop: 16 } },
              e("div", { style: { fontWeight: 600, marginBottom: 4 } }, g.title),
              g.items.map((it) => e("div", { key: it.rel, style: { padding: "3px 0" } },
                e("span", { style: S.mono }, it.rel), " — ", it.name, e("span", { style: S.muted }, "  " + (it.note || "")))),
            )),
          ) : e("div", { style: S.muted }, "加载中…"),
        ),
      );
    }

    /* ---------- 设置页 ---------- */
    /* ---------- 应用内目录浏览器（自包含，Node fs 后端，跨平台） ---------- */
    function DirectoryBrowser(props) {
      const { onSelect, onClose } = props;
      const [cur, setCur] = useState("");
      const [parent, setParent] = useState(null);
      const [roots, setRoots] = useState([]);
      const [entries, setEntries] = useState([]);
      const [err, setErr] = useState(null);
      const loadDir = async (p) => {
        setErr(null);
        try {
          const d = await post("/api/workbench/browse", { path: p || "" });
          setCur(d.path || ""); setParent(d.parent || null);
          setRoots(d.roots || []); setEntries(d.entries || []);
        } catch (e2) { setErr(e2.message); }
      };
      useEffect(() => { loadDir(""); }, []);
      const rowStyle = {
        padding: "5px 8px", cursor: "pointer", borderRadius: 6,
        display: "flex", alignItems: "center", gap: 6,
      };
      const hover = {
        onMouseEnter: (ev) => { ev.currentTarget.style.background = "rgba(127,127,127,0.15)"; },
        onMouseLeave: (ev) => { ev.currentTarget.style.background = "transparent"; },
      };
      return e("div", { style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 } },
        e("div", { style: { background: "#1e1e1e", borderRadius: 10, padding: 16, width: 520, maxHeight: "74vh", display: "flex", flexDirection: "column", color: "#e5e5e5" } },
          e("div", { style: { fontWeight: 600, marginBottom: 8 } }, "选择文件区目录"),
          e("div", { style: { ...S.mono, marginBottom: 8, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, cur || "（选择盘符开始）"),
          err ? e("div", { style: S.err }, err) : null,
          e("div", { style: { flex: 1, overflow: "auto", marginBottom: 8, minHeight: 220 } },
            // 盘符/根列表（自由起点，可切到任意盘）
            roots.length ? e("div", { style: { marginBottom: 6 } },
              e("div", { style: { ...S.muted, padding: "2px 8px" } }, "盘符"),
              roots.map((r) => e("div", { key: r, style: { ...rowStyle, fontWeight: 600 }, onClick: () => loadDir(r), ...hover }, "💽 " + r)),
            ) : null,
            parent ? e("div", { style: rowStyle, onClick: () => loadDir(parent), ...hover }, "⬆ 上级目录") : null,
            entries.map((it) => e("div", { key: it.path, style: rowStyle, onClick: () => loadDir(it.path), ...hover }, "📁 " + it.name)),
            (!roots.length && !parent && entries.length === 0 && !err) ? e("div", { style: S.muted }, "（空目录）") : null,
          ),
          e("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" } },
            e("button", { style: S.btn(false), onClick: () => loadDir("") }, "盘符"),
            e("button", { style: S.btn(false), onClick: onClose }, "取消"),
            e("button", { style: { ...S.primaryBtn, opacity: cur ? 1 : 0.5 }, disabled: !cur, onClick: () => onSelect(cur) }, "选择此目录"),
          ),
        ),
      );
    }

    function SettingsPage() {
      const [ws, setWs] = useState(null);
      const [input, setInput] = useState("");
      const [msg, setMsg] = useState(null);
      const [browsing, setBrowsing] = useState(false);
      const load = useCallback(async () => {
        try { const d = await get("/api/workbench/workspace"); setWs(d); setInput(d.workspace || ""); } catch (e2) { setMsg(e2.message); }
      }, []);
      useEffect(() => { load(); }, [load]);
      const savePath = async (p) => {
        try { const d = await post("/api/workbench/workspace", { path: p }); if (d.ok) { setMsg("已保存：" + d.workspace); setInput(d.workspace); } } catch (e2) { setMsg(e2.message); }
      };
      const save = () => savePath(input);
      const pick = async () => {
        // 优先用 Windows 原生目录对话框（体验与旧网页版一致）；后端不支持或调用失败则回退应用内浏览器
        try {
          const d = await post("/api/workbench/pickdir");
          if (d && d.path) { setInput(d.path); await savePath(d.path); }
          else if (d && d.ok) { setMsg("已取消。"); }
          else { setBrowsing(true); }
        } catch (e2) {
          setBrowsing(true);
        }
      };
      return e("div", { style: S.page },
        e("div", { style: S.body },
          e("div", { style: { fontWeight: 600, marginBottom: 8 } }, "文件区路径"),
          e("div", { style: { ...S.muted, marginBottom: 8 } }, "文件区是你放置图纸/报价表的目录，所有工具的相对路径都相对它解析。"),
          ws ? e("div", { style: { ...S.mono, marginBottom: 12 } }, ws.workspace || "（未设置，默认文件区根）") : null,
          e("div", { style: S.field },
            e("label", { style: S.label }, "新路径（绝对路径）"),
            e("input", { style: S.input, value: input, onChange: (ev) => setInput(ev.target.value) }),
          ),
          e("div", { style: { display: "flex", gap: 8 } },
            e("button", { style: S.primaryBtn, onClick: save }, "保存路径"),
            e("button", { style: S.btn(false), onClick: pick }, "浏览选择…"),
          ),
          msg ? e("div", { style: { marginTop: 12, ...(msg.startsWith("已") ? S.ok : S.muted) } }, msg) : null,
          browsing ? e(DirectoryBrowser, {
            onSelect: (p) => { setBrowsing(false); if (p) { setInput(p); savePath(p); } },
            onClose: () => setBrowsing(false),
          }) : null,
        ),
      );
    }

    /* ---------- 环境页 ---------- */
    function EnvPage() {
      const [data, setData] = useState(null);
      const [err, setErr] = useState(null);
      const load = useCallback(async () => {
        try { await ensureStarted(); setData(await get("/api/workbench/proxy/api/env?refresh=1")); } catch (e2) { setErr(e2.message); }
      }, []);
      useEffect(() => { load(); }, [load]);
      const row = (label, ok, detail) => e("div", { style: { padding: "5px 0" } },
        e("span", null, (ok ? "✅" : "⚠️") + " " + label + "："),
        e("span", { style: S.mono }, " " + (detail || (ok ? "正常" : "异常"))));
      return e("div", { style: S.page },
        e("div", { style: S.body },
          e("div", { style: { marginBottom: 8 } }, e("button", { style: S.btn(false), onClick: load }, "刷新")),
          err ? e("div", { style: S.err }, err) : null,
          data ? e("div", null,
            row("Python", data.python && data.python.ok, data.python && data.python.version),
            row("离线依赖 pydeps", data.pydeps && data.pydeps.ok, data.pydeps && data.pydeps.detail),
            row("CAD 转换", (data.cad && data.cad.dwg_to_dxf !== "unknown") ? data.cad.dwg_to_dxf : false,
              data.cad ? ("AutoCAD:" + data.cad.has_autocad + " ODA:" + data.cad.has_oda) : ""),
            row("技能", data.skills > 0, data.skills + " 个"),
            row("招标日报", data.tender_reports >= 0, data.tender_reports + " 份"),
          ) : e("div", { style: S.muted }, "加载中…"),
        ),
      );
    }

    /* ---------- 工作台面板（一级导航） ---------- */
    // 核心页面：只依赖 DSH 本体 + 本插件，任何环境都可用。
    const CORE_PAGES = [
      { id: "files", label: "文件", component: FilesPage },
      { id: "settings", label: "设置", component: SettingsPage },
    ];
    // 整合包增强页面：需要 <profile>/wta 后端（server.py）才显示。
    const PACK_PAGES = [
      { id: "tools", label: "工具", component: ToolsPage },
      { id: "resources", label: "资源", component: ResourcesPage },
      { id: "env", label: "环境", component: EnvPage },
    ];
    function WorkbenchPanel() {
      const [backend, setBackend] = useState(false);
      const [page, setPage] = useState("files");
      useEffect(() => {
        (async () => {
          try {
            const s = await get("/api/workbench/status");
            setBackend(!!s.backend);
          } catch { /* 探测失败按无后端处理 */ }
        })();
      }, []);
      const pages = backend ? [...CORE_PAGES, ...PACK_PAGES] : CORE_PAGES;
      const current = pages.find((p) => p.id === page) || pages[0];
      return e("div", { style: S.page },
        e("div", { style: S.nav },
          pages.map((p) => e("button", { key: p.id, onClick: () => setPage(p.id), style: S.btn(current.id === p.id) }, p.label)),
        ),
        e("div", { style: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" } },
          e(current.component, {}),
        ),
      );
    }

    /* ---------- 图标（点击切换：已激活则收回会话） ---------- */
    function WorkbenchIcon(props) {
      const size = (props && props.size) || 16;
      return e("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
        strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true,
        onClick: (ev) => { ev.stopPropagation(); toggleWorkbenchPanel(); } },
        e("rect", { key: "r", x: 3, y: 4, width: 18, height: 16, rx: 2 }),
        e("line", { key: "l1", x1: 3, y1: 9, x2: 21, y2: 9 }),
        e("circle", { key: "c", cx: 8, cy: 14, r: 1.5 }),
        e("circle", { key: "c2", cx: 13, cy: 14, r: 1.5 }));
    }

    // 切换工作台主面板：已激活则收回（activePanelId = null 即会话），否则激活。
    function toggleWorkbenchPanel() {
      if (!layoutService || typeof layoutService.selectPanel !== "function") return;
      let active = null;
      try { active = layoutService.panelInfo ? layoutService.panelInfo.getSnapshot().activePanelId : null; }
      catch { active = null; }
      layoutService.selectPanel(active === PANEL_ID ? null : PANEL_ID);
    }

    /* ---------- 侧栏「工作台」图标（与官方「插件」并列） ---------- */
    var sidebarRight = null;
    var layoutService = null;
    var uiSessionService = null;
    const PANEL_ID = "dsh-engineering-workbench";
    const inject = ["slots"];
    function apply(ctx) {
      // 原生文件预览桥（DSH 官方右侧栏 documentPreview；软依赖，缺失仅影响预览）
      ctx.inject(["sidebarRight"], (scoped) => {
        if (scoped.sidebarRight) sidebarRight = scoped.sidebarRight;
      });
      // 会话 UI 服务：提供“主视图持有的会话”id（不随主栏面板切换失效；软依赖）
      ctx.inject(["uiSession"], (scoped) => {
        if (scoped.uiSession) uiSessionService = scoped.uiSession;
      });
      // 布局服务（面板切换；软依赖）
      ctx.inject(["layout"], (scoped) => {
        if (scoped.layout) layoutService = scoped.layout;
      });

      // 主区域面板：与官方「插件」面板完全平行（点击侧栏图标 → 切到此面板）
      ctx.slots.inject("main", () => ctx.slots.register({
        name: "main",
        key: PANEL_ID,
      }, (props) => e(WorkbenchPanel, { ...props })));

      // 侧栏顶部图标：与官方「插件」同一 slot、同一渲染路径（字号/大小/位置一致）
      ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
        name: "sidebar.panellist",
        id: PANEL_ID,
        order: 10,
        label: () => "工作台",
      }, WorkbenchIcon));
    }

    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
