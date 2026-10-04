/**
 * dsh-engineering-workbench —— 浏览器侧插件（client bundle）。
 *
 * 工作台 UI 内嵌进 DSH（better-sidebar Tab），完整对齐原先工作台的功能页面：
 *   - 一级导航 5 页：工具 / 文件 / 资源 / 设置 / 环境；
 *   - 工具页：8 个工具（报价归一/比对/成本/差异、CAD 识图、CAD 探测、冒烟测试、依赖重建）；
 *   - 文件页：目录浏览 + 文本预览 + 资源管理器打开 + 建目录；
 *   - 资源页：模板/数据/文档快捷直达；
 *   - 设置页：工作区路径（显示/选择/修改）；
 *   - 环境页：Python/pydeps/CAD/技能/招标日报状态。
 *
 * 后端 API 全部走 host 的 /api/workbench/proxy/* 反向代理（同源，避免 CORS）。
 * better-sidebar 是可选 peer：ctx.inject(['betterSidebar']) 软依赖等待，缺失时按钮优雅降级。
 */
window.__ModuleLoader__.load({
  id: "dsh-engineering-workbench",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    const e = React.createElement;
    const { useState, useEffect, useCallback } = React;

    const TAB_ID = "dsh-engineering-workbench:workbench";

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

    /* ---------- 文件页 ---------- */
    function FilesPage() {
      const [rel, setRel] = useState("");
      const [entries, setEntries] = useState(null);
      const [preview, setPreview] = useState(null);
      const [err, setErr] = useState(null);

      const loadDir = useCallback(async (p) => {
        setErr(null); setPreview(null);
        try {
          await ensureStarted();
          const d = await get("/api/workbench/proxy/api/dirs?path=" + encodeURIComponent(p || ""));
          setRel(d.rel || p || "");
          setEntries(d.entries || []);
        } catch (e2) { setErr(e2.message); }
      }, []);
      useEffect(() => { loadDir(""); }, [loadDir]);

      const openFile = async (frel) => {
        try {
          await ensureStarted();
          const d = await get("/api/workbench/proxy/api/file?path=" + encodeURIComponent(frel));
          setPreview(d);
        } catch (e2) { setErr(e2.message); }
      };
      const openExplorer = async (frel) => {
        try { await ensureStarted(); await post("/api/workbench/proxy/api/explorer", { path: frel }); } catch (e2) { setErr(e2.message); }
      };

      return e("div", { style: S.page },
        e("div", { style: S.nav },
          e("button", { style: S.btn(false), onClick: () => loadDir(rel.split("/").slice(0, -1).join("/") || "") }, "↑ 上级"),
          e("button", { style: S.btn(false), onClick: () => loadDir("") }, "工作区根"),
          e("span", { style: { ...S.muted, alignSelf: "center", marginLeft: 8 } }, rel || "（工作区根）"),
        ),
        e("div", { style: S.body },
          err ? e("div", { style: S.err }, err) : null,
          e("div", { style: { display: "flex", gap: 16 } },
            e("div", { style: { flex: 1, minWidth: 0 } },
              (entries || []).map((it) => e("div", {
                key: it.name,
                style: { display: "flex", gap: 8, padding: "5px 8px", cursor: "pointer", borderRadius: 6, alignItems: "center" },
                onMouseEnter: (ev) => { ev.currentTarget.style.background = "rgba(127,127,127,0.1)"; },
                onMouseLeave: (ev) => { ev.currentTarget.style.background = "transparent"; },
                onClick: () => it.type === "dir" ? loadDir(it.rel) : openFile(it.rel),
              },
                e("span", null, it.type === "dir" ? "📁" : "📄"),
                e("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, it.name),
                it.size != null ? e("span", { style: S.muted }, Math.round(it.size / 1024) + " KB") : null,
                e("button", { style: S.btn(false), onClick: (ev) => { ev.stopPropagation(); openExplorer(it.rel); } }, "打开"),
              )),
              (!entries || entries.length === 0) ? e("div", { style: S.muted }, "（空目录）") : null,
            ),
            e("div", { style: { flex: 1, minWidth: 0 } },
              preview ? (preview.previewable
                ? e("pre", { style: S.mono }, preview.content)
                : e("div", { style: S.muted }, preview.reason || "不可预览"))
                : e("div", { style: S.muted }, "点击左侧文件预览内容"),
            ),
          ),
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
              e("span", { style: S.mono }, q.rel || "（工作区）"), " — ", q.name, e("span", { style: S.muted }, "  " + (q.note || "")))),
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
    function SettingsPage() {
      const [ws, setWs] = useState(null);
      const [input, setInput] = useState("");
      const [msg, setMsg] = useState(null);
      const load = useCallback(async () => {
        try { await ensureStarted(); const d = await get("/api/workbench/proxy/api/workspace"); setWs(d); setInput(d.workspace || ""); } catch (e2) { setMsg(e2.message); }
      }, []);
      useEffect(() => { load(); }, [load]);
      const savePath = async (p) => {
        try { await ensureStarted(); const d = await post("/api/workbench/proxy/api/workspace", { path: p }); if (d.ok) { setMsg("已保存：" + d.workspace); setInput(d.workspace); } } catch (e2) { setMsg(e2.message); }
      };
      const save = () => savePath(input);
      const pick = async () => {
        try {
          if (!directoryPicker || typeof directoryPicker.pick !== "function") { setMsg("当前 DSH 环境不提供目录选择器。"); return; }
          const path = await directoryPicker.pick();
          if (path) await savePath(path); else setMsg("已取消。");
        } catch (e2) { setMsg(e2.message); }
      };
      return e("div", { style: S.page },
        e("div", { style: S.body },
          e("div", { style: { fontWeight: 600, marginBottom: 8 } }, "工作区路径"),
          e("div", { style: { ...S.muted, marginBottom: 8 } }, "工作区是你放置图纸/报价表的目录，所有工具的相对路径都相对它解析。"),
          ws ? e("div", { style: { ...S.mono, marginBottom: 12 } }, ws.workspace || "（未设置，默认工作区根）") : null,
          e("div", { style: S.field },
            e("label", { style: S.label }, "新路径（绝对路径）"),
            e("input", { style: S.input, value: input, onChange: (ev) => setInput(ev.target.value) }),
          ),
          e("div", { style: { display: "flex", gap: 8 } },
            e("button", { style: S.primaryBtn, onClick: save }, "保存路径"),
            e("button", { style: S.btn(false), onClick: pick }, "浏览选择…"),
          ),
          msg ? e("div", { style: { marginTop: 12, ...(msg.startsWith("已") ? S.ok : S.muted) } }, msg) : null,
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
    const PAGES = [
      { id: "tools", label: "工具", component: ToolsPage },
      { id: "files", label: "文件", component: FilesPage },
      { id: "resources", label: "资源", component: ResourcesPage },
      { id: "settings", label: "设置", component: SettingsPage },
      { id: "env", label: "环境", component: EnvPage },
    ];
    function WorkbenchPanel(props) {
      const [page, setPage] = useState("tools");
      const current = PAGES.find((p) => p.id === page);
      return e("div", { style: S.page },
        e("div", { style: S.nav },
          PAGES.map((p) => e("button", { key: p.id, onClick: () => setPage(p.id), style: S.btn(page === p.id) }, p.label)),
        ),
        e("div", { style: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" } },
          e(current.component, {}),
        ),
      );
    }

    /* ---------- 图标 ---------- */
    function WorkbenchIcon(props) {
      const size = (props && props.size) || 16;
      return e("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
        strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
        e("rect", { key: "r", x: 3, y: 4, width: 18, height: 16, rx: 2 }),
        e("line", { key: "l1", x1: 3, y1: 9, x2: 21, y2: 9 }),
        e("circle", { key: "c", cx: 8, cy: 14, r: 1.5 }),
        e("circle", { key: "c2", cx: 13, cy: 14, r: 1.5 }));
    }

    /* ---------- 侧栏「工作台」按钮 ---------- */
    function WorkbenchButton(props) {
      const wide = props && props.wide;
      const open = () => {
        if (!betterSidebar || typeof betterSidebar.openTab !== "function") {
          window.alert("工作台需要 dsh-better-sidebar 插件（未检测到）。"); return;
        }
        if (!betterSidebar.isTabEnabled || betterSidebar.isTabEnabled(TAB_ID)) {
          betterSidebar.openTab({ type: TAB_ID });
        } else {
          window.alert("工作台 Tab 已在设置中被禁用，请先在 better-sidebar 设置页启用。");
        }
      };
      return e("button", {
        title: "打开工作台", "aria-label": "工作台", onClick: open,
        style: { display: "flex", alignItems: "center", gap: 6, border: "none", background: "transparent",
          color: "inherit", opacity: 0.72, cursor: "pointer", padding: "6px 10px", borderRadius: 8,
          fontSize: 13, lineHeight: 1, width: wide ? "100%" : "auto", justifyContent: wide ? "flex-start" : "center" },
        onMouseEnter: (ev) => { ev.currentTarget.style.opacity = "1"; ev.currentTarget.style.background = "rgba(127,127,127,0.14)"; },
        onMouseLeave: (ev) => { ev.currentTarget.style.opacity = "0.72"; ev.currentTarget.style.background = "transparent"; },
      },
        e(WorkbenchIcon, { size: 16 }),
        wide ? e("span", { key: "t" }, "工作台") : null);
    }

    var betterSidebar = null;
    var directoryPicker = null;
    const inject = ["slots", "remote.directoryPicker"];
    function apply(ctx) {
      directoryPicker = ctx.remote ? ctx.remote.directoryPicker : null;
      ctx.inject(["betterSidebar"], (scoped) => {
        const service = scoped.betterSidebar;
        if (!service || typeof service.registerTab !== "function") return;
        betterSidebar = service;
        scoped.effect(() => service.registerTab({
          id: TAB_ID,
          title: "工作台",
          description: "水处理与电气自动化工程工具台：报价/CAD/工艺计算/Modbus 仿真",
          icon: (size) => e(WorkbenchIcon, { size }),
          order: 50,
          single: true,
          component: (tabProps) => e(WorkbenchPanel, { ...tabProps }),
        }), "dsh-engineering-workbench: register workbench tab");
      });

      ctx.slots.inject("sidebar.footer.action", () =>
        ctx.slots.register(
          { name: "sidebar.footer.action", id: "dsh-engineering-workbench-button" },
          WorkbenchButton,
        ),
      );
    }

    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
