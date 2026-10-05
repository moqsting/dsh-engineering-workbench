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

    /* ---------- 列表行与原生预览（文件页 / 资源页共用，保证两页观感与行为一致） ---------- */
    const ROW_STYLE = { display: "flex", gap: 8, padding: "5px 8px", cursor: "pointer", borderRadius: 6, alignItems: "center" };
    const ROW_HOVER = {
      onMouseEnter: (ev) => { ev.currentTarget.style.background = "rgba(127,127,127,0.1)"; },
      onMouseLeave: (ev) => { ev.currentTarget.style.background = "transparent"; },
    };

    // 用 DSH 原生文件查看器打开（右侧栏 documentPreview：文本/markdown/图片/PDF/Excel/Office）
    // 失败经 onError(msg) 回调返回——可能同步，也可能在切回对话后异步触发。
    function openNativePreview(filePath, onError) {
      const fail = (m) => { if (typeof onError === "function") onError(m); };
      if (!sidebarRight || typeof sidebarRight.openResource !== "function") {
        fail("当前 DSH 环境不提供原生文件预览。"); return;
      }
      const sessionId = currentSessionId();
      if (!sessionId) {
        fail("当前没有活动会话，无法使用原生预览；请先在对话中打开或新建一个会话。"); return;
      }
      const address = sessionFileAddress(sessionId, filePath);
      const open = () => {
        try { sidebarRight.openResource(address); }
        catch (e2) { fail("打开预览失败：" + String(e2 && e2.message ? e2.message : e2)); }
      };
      // 原生预览在右侧栏，属于“对话视图”。openResource 内部 require() 依赖 onScreen（mounted）
      // 非空，而 onScreen 只在主栏显示对话（activePanelId === null）时才有值。
      // 因此若当前正显示工作台面板，先切回对话让右侧栏挂载，再打开预览。
      let active = null;
      try { active = layoutService && layoutService.panelInfo ? layoutService.panelInfo.getSnapshot().activePanelId : null; } catch { active = null; }
      if (active === PANEL_ID) {
        try { if (layoutService && typeof layoutService.selectPanel === "function") layoutService.selectPanel(null); } catch { /* 切回失败则直接尝试 */ }
        setTimeout(open, 0);
        return;
      }
      open();
    }

    function FilesPage() {
      const [workspace, setWorkspace] = useState(null); // null=加载中；""=未设置
      const [cur, setCur] = useState("");
      const [parent, setParent] = useState(null);
      const [entries, setEntries] = useState([]);
      const [err, setErr] = useState(null);

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

      const previewFile = (it) => { setErr(null); openNativePreview(it.path, setErr); };

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
          relShown ? e("span", { style: { ...S.muted, alignSelf: "center", marginLeft: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, relShown) : null,
        ),
        e("div", { style: S.body },
          err ? e("div", { style: S.err }, err) : null,
          entries.map((it) => e("div", {
            key: it.path, style: ROW_STYLE, ...ROW_HOVER,
            onClick: () => (it.isDir ? loadDir(it.path) : previewFile(it)),
          },
            e("span", null, it.isDir ? "📁" : "📄"),
            e("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, it.name),
          )),
          entries.length === 0 && !err ? e("div", { style: S.muted }, "（空目录）") : null,
        ),
      );
    }

    /* ---------- 资源页 ---------- */
    /* 随包资源：快捷目录 + 分类清单。行样式与文件页一致（图标 + 名称 + 悬停），
       目录可点进浏览、文件可点开 DSH 原生预览。
       两种标识的分工：abs（绝对路径）用于浏览与原生预览，rel（@pack/...）仅作列表键。 */
    function ResourcesPage() {
      const [data, setData] = useState(null);
      const [err, setErr] = useState(null);
      const [cur, setCur] = useState(null);        // null=快捷总览；否则为正在浏览的目录绝对路径
      const [listing, setListing] = useState(null);
      const [busy, setBusy] = useState(false);

      useEffect(() => {
        (async () => {
          try { await ensureStarted(); setData(await get("/api/workbench/proxy/api/resources")); }
          catch (e2) { setErr(e2.message); }
        })();
      }, []);

      const openDir = useCallback(async (abs) => {
        setErr(null); setBusy(true);
        try {
          const d = await get("/api/workbench/proxy/api/dirs?path=" + encodeURIComponent(abs == null ? "" : abs));
          if (!d.exists) { setErr("目录不存在：" + (abs || "文件区")); return; }
          setListing(d); setCur(abs == null ? "" : abs);
        } catch (e2) { setErr("无法打开目录：" + e2.message); }
        finally { setBusy(false); }
      }, []);

      const preview = (abs, fallback) => { setErr(null); openNativePreview(abs || fallback, setErr); };

      const row = (key, icon, label, note, onClick) => e("div", {
        key, style: ROW_STYLE, ...ROW_HOVER, onClick,
      },
        e("span", null, icon),
        e("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, label),
        note ? e("span", { style: { ...S.muted, flex: "0 0 auto" } }, note) : null);

      const fmtSize = (n) => (typeof n === "number" ? (n < 1024 ? n + " B" : (n / 1024).toFixed(1) + " KB") : "");
      const parentOf = (p) => {
        const s = String(p || "").replace(/[\\/]+$/, "");
        if (!s) return null;
        const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
        if (i <= 1) return null;
        const par = s.slice(0, i);
        return /^[a-zA-Z]:$/.test(par) ? par + "/" : par;
      };

      if (cur !== null) {
        const items = (listing && listing.entries) || [];
        const up = parentOf(cur);
        return e("div", { style: S.page },
          e("div", { style: S.nav },
            up ? e("button", { style: S.btn(false), onClick: () => openDir(up) }, "↑ 上级") : null,
            e("button", { style: S.btn(false), onClick: () => openDir(cur) }, "刷新"),
            e("button", { style: S.btn(false), onClick: () => { setCur(null); setListing(null); setErr(null); } }, "← 快捷目录"),
            e("span", { style: { ...S.muted, alignSelf: "center", marginLeft: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
              cur || "文件区"),
          ),
          e("div", { style: S.body },
            err ? e("div", { style: S.err }, err) : null,
            busy ? e("div", { style: S.muted }, "加载中…") : null,
            items.map((it) => (it.type === "dir"
              ? row(it.rel, "📁", it.name, "", () => openDir(it.abs || it.rel))
              : row(it.rel, "📄", it.name, fmtSize(it.size), () => preview(it.abs, it.rel)))),
            !busy && items.length === 0 && !err ? e("div", { style: S.muted }, "（空目录）") : null,
          ),
        );
      }

      return e("div", { style: S.page },
        e("div", { style: S.body },
          err ? e("div", { style: S.err }, err) : null,
          data ? e("div", null,
            e("div", { style: { fontWeight: 600, marginBottom: 4 } }, "快捷目录"),
            (data.quickDirs || []).map((q) => row("q:" + (q.rel || "root"), q.rel ? "📁" : "🗂",
              q.rel ? q.name : q.name + "（文件区）", q.note || "", () => openDir(q.abs))),
            (data.groups || []).map((g) => e("div", { key: g.title, style: { marginTop: 14 } },
              e("div", { style: { fontWeight: 600, marginBottom: 4 } }, g.title),
              g.items.map((it) => row("i:" + it.rel, "📄", it.name, it.note || "", () => preview(it.abs, it.rel)))),
            ),
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
    /* ---------- 环境页 ---------- */
    // 三态自检卡片。判据必须是显式三态：CAD 一项曾用「dwg_to_dxf !== "unknown"」当可用判据，
    // 而该字段是字符串，"none"（完全没装）也是非空字符串 → 恒为真 → 未安装 CAD 也打勾。
    const ENV_TONES = {
      ok: { fg: "#22c55e", bg: "rgba(34,197,94,0.12)", border: "rgba(34,197,94,0.40)", text: "正常" },
      warn: { fg: "#f59e0b", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.40)", text: "部分可用" },
      bad: { fg: "#ef4444", bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.40)", text: "不可用" },
    };
    const ENV_CARD = {
      flex: "1 1 240px", minWidth: 220, display: "flex", flexDirection: "column", gap: 6,
      border: "1px solid rgba(127,127,127,0.22)", borderRadius: 10, padding: "12px 14px",
      background: "rgba(127,127,127,0.04)",
    };
    const CAD_MODE_DESC = {
      autocad: "AutoCAD 核心控制台（accoreconsole.exe）可批量转换 DWG→DXF",
      oda: "ODA File Converter 可批量转换 DWG→DXF",
      "autocad-acad": "仅检测到 acad.exe（缺核心控制台），需用 AutoCAD 手动另存为 DXF",
      none: "未检测到 AutoCAD 或 ODA File Converter，DWG 图纸无法自动转换",
      unknown: "未执行探测（探测脚本未返回结果）",
    };

    function EnvPage() {
      const [data, setData] = useState(null);
      const [err, setErr] = useState(null);
      const [busy, setBusy] = useState(false);
      const [at, setAt] = useState("");

      const load = useCallback(async () => {
        setBusy(true); setErr(null);
        try {
          await ensureStarted();
          setData(await get("/api/workbench/proxy/api/env?refresh=1"));
          setAt(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
        } catch (e2) { setErr(e2.message); }
        finally { setBusy(false); }
      }, []);
      useEffect(() => { load(); }, [load]);

      const pill = (tone) => {
        const t = ENV_TONES[tone] || ENV_TONES.warn;
        return e("span", {
          style: {
            fontSize: 11, padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap",
            color: t.fg, background: t.bg, border: "1px solid " + t.border,
          },
        }, t.text);
      };
      const card = (key, icon, title, tone, value, desc) => e("div", { key, style: ENV_CARD },
        e("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
          e("span", { style: { fontSize: 15 } }, icon),
          e("span", { style: { flex: 1, fontWeight: 600 } }, title),
          pill(tone)),
        value ? e("div", { style: { fontSize: 16, fontWeight: 600, fontFamily: "ui-monospace, Consolas, monospace" } }, value) : null,
        desc ? e("div", { style: { ...S.muted, lineHeight: 1.55 } }, desc) : null);

      const cad = (data && data.cad) || {};
      const mode = cad.dwg_to_dxf || "unknown";
      const cadTone = (mode === "autocad" || mode === "oda") ? "ok" : (mode === "none" ? "bad" : "warn");
      const hints = (cad.hints || []).slice(0, 4);
      const found = [];
      if (cad.has_autocad) found.push("AutoCAD" + (cad.autocad_version ? " " + cad.autocad_version : "") + (cad.core_console ? "（含核心控制台）" : ""));
      if (cad.has_oda) found.push("ODA File Converter");

      return e("div", { style: S.page },
        e("div", { style: S.body },
          e("div", { style: { display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14 } },
            e("div", { style: { fontSize: 16, fontWeight: 600 } }, "环境自检"),
            e("div", { style: { ...S.muted, flex: 1 } }, at ? ("上次检测 " + at) : "本机 Python、离线依赖与 CAD 图纸转换能力"),
            e("button", {
              style: { ...S.primaryBtn, opacity: busy ? 0.6 : 1 },
              disabled: busy, onClick: load,
            }, busy ? "检测中…" : "重新检测")),
          err ? e("div", { style: { ...S.err, marginBottom: 10 } }, err) : null,
          !data
            ? e("div", { style: S.muted }, busy ? "正在检测…" : "暂无数据")
            : e("div", null,
              e("div", { style: { display: "flex", flexWrap: "wrap", gap: 12 } },
                card("python", "🐍", "Python 运行时",
                  data.python && data.python.ok ? "ok" : "bad",
                  (data.python && data.python.version) || "",
                  data.python && data.python.ok ? "解释器可用，包内工具脚本可执行" : "未找到可用解释器，工具页无法运行"),
                card("pydeps", "📦", "离线依赖",
                  data.pydeps && data.pydeps.ok ? "ok" : "bad",
                  data.pydeps && data.pydeps.ok ? "已就绪" : "缺失",
                  data.pydeps && data.pydeps.ok
                    ? "openpyxl / pandas / ezdxf 均可导入"
                    : ((data.pydeps && data.pydeps.detail) || "依赖导入失败")),
                card("skills", "🧩", "对话技能",
                  data.skills > 0 ? "ok" : "warn",
                  (data.skills || 0) + " 个",
                  data.skills > 0 ? "已注册到 DSH 技能目录" : "未发现技能，请检查 $DSH_HOME/skills"),
                card("tender", "📄", "招标日报",
                  data.tender_reports > 0 ? "ok" : "warn",
                  (data.tender_reports || 0) + " 份",
                  data.tender_reports > 0 ? "reports/tender 下已有日报" : "尚未生成日报，可在工具页运行")),
              e("div", { style: { ...ENV_CARD, flex: "1 1 100%", marginTop: 12 } },
                e("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
                  e("span", { style: { fontSize: 15 } }, "📐"),
                  e("span", { style: { flex: 1, fontWeight: 600 } }, "CAD 图纸转换"),
                  pill(cadTone)),
                e("div", { style: { fontSize: 13, fontWeight: 600 } }, CAD_MODE_DESC[mode] || mode),
                e("div", { style: S.muted },
                  "AutoCAD：" + (cad.has_autocad ? (cad.autocad_dir || "已检测到") : "未找到")
                  + "　|　ODA：" + (cad.has_oda ? (cad.oda_dir || "已检测到") : "未找到")),
                found.length ? e("div", { style: { ...S.muted, color: "#22c55e" } }, "已就绪：" + found.join("、")) : null,
                hints.length
                  ? e("div", { style: { marginTop: 2, display: "flex", flexDirection: "column", gap: 4 } },
                    hints.map((h, i) => e("div", {
                      key: "hint" + i,
                      style: { fontSize: 12, lineHeight: 1.6, display: "flex", gap: 6 },
                    }, e("span", null, "💡"), e("span", { style: { flex: 1 } }, h))))
                  : null),
            ),
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
