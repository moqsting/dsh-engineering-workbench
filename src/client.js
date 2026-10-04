/**
 * dsh-engineering-workbench —— 浏览器侧插件（client bundle）。
 *
 * 工作台 UI 内嵌进 DSH（better-sidebar Tab，不再 window.open 单开浏览器页面）：
 *   - 注册一个 better-sidebar Tab（id = "dsh-engineering-workbench:workbench"）作为工作台外壳；
 *   - Tab 内用 React state 做 8 个工具的页面切换；
 *   - 侧边栏底部「工作台」按钮（sidebar.footer.action）点击 → openTab 切到工作台 Tab；
 *   - 工具调用走 host 的 /api/workbench/proxy/* 反向代理（同源，避免 CORS）。
 *
 * better-sidebar 是可选 peer：ctx.inject(['betterSidebar']) 软依赖等待，缺失时按钮优雅降级。
 */
window.__ModuleLoader__.load({
  id: "dsh-engineering-workbench",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    const e = React.createElement;
    const useState = React.useState;

    const TAB_ID = "dsh-engineering-workbench:workbench";

    // 8 个工具（一级导航项；具体页面在 P3 逐步接入）
    const TOOLS = [
      { id: "quote-normalize", label: "报价归一" },
      { id: "quote-compare", label: "报价比对" },
      { id: "quote-cost", label: "成本测算" },
      { id: "quote-diff", label: "差异核对" },
      { id: "cad-reader", label: "CAD 识图" },
      { id: "process-calc", label: "工艺计算" },
      { id: "modbus-sim", label: "Modbus 仿真" },
      { id: "smoke-test", label: "冒烟测试" },
    ];

    // 工作台图标（复用现有 SVG）
    function WorkbenchIcon(props) {
      const size = (props && props.size) || 16;
      return e(
        "svg",
        { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
          strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
        e("rect", { key: "r", x: 3, y: 4, width: 18, height: 16, rx: 2 }),
        e("line", { key: "l1", x1: 3, y1: 9, x2: 21, y2: 9 }),
        e("circle", { key: "c", cx: 8, cy: 14, r: 1.5 }),
        e("circle", { key: "c2", cx: 13, cy: 14, r: 1.5 }),
      );
    }

    // 工作台面板（Tab 内容）：一级工具导航 + 内容区
    function WorkbenchPanel(props) {
      const [activeTool, setActiveTool] = useState(TOOLS[0].id);
      const navStyle = {
        display: "flex", flexWrap: "wrap", gap: 4,
        padding: "8px 12px", borderBottom: "1px solid rgba(127,127,127,0.18)",
      };
      const btn = (active) => ({
        border: "none", borderRadius: 6, padding: "5px 10px", fontSize: 13, cursor: "pointer",
        lineHeight: 1,
        background: active ? "rgba(99,102,241,0.18)" : "transparent",
        color: active ? "inherit" : "rgba(127,127,127,0.85)",
        fontWeight: active ? 600 : 400,
      });
      return e("div", { style: { display: "flex", flexDirection: "column", height: "100%" } },
        e("div", { style: navStyle },
          TOOLS.map((t) => e("button", {
            key: t.id, onClick: () => setActiveTool(t.id), style: btn(activeTool === t.id),
          }, t.label)),
        ),
        e("div", { style: { flex: 1, overflow: "auto", padding: 16, fontSize: 13 } },
          e("div", { style: { opacity: 0.6 } }, "工具内容占位（P3 接入）：" + activeTool),
        ),
      );
    }

    // 侧栏底部「工作台」按钮：点击切到工作台 Tab（不再 window.open）
    function WorkbenchButton(props) {
      const wide = props && props.wide;
      const open = () => {
        if (!betterSidebar || typeof betterSidebar.openTab !== "function") {
          window.alert("工作台需要 dsh-better-sidebar 插件（未检测到）。");
          return;
        }
        if (!betterSidebar.isTabEnabled || betterSidebar.isTabEnabled(TAB_ID)) {
          betterSidebar.openTab({ type: TAB_ID });
        } else {
          window.alert("工作台 Tab 已在设置中被禁用，请先在 better-sidebar 设置页启用。");
        }
      };
      return e(
        "button",
        {
          title: "打开工作台", "aria-label": "工作台", onClick: open,
          style: {
            display: "flex", alignItems: "center", gap: 6, border: "none",
            background: "transparent", color: "inherit", opacity: 0.72, cursor: "pointer",
            padding: "6px 10px", borderRadius: 8, fontSize: 13, lineHeight: 1,
            width: wide ? "100%" : "auto", justifyContent: wide ? "flex-start" : "center",
          },
          onMouseEnter: (ev) => { ev.currentTarget.style.opacity = "1"; ev.currentTarget.style.background = "rgba(127,127,127,0.14)"; },
          onMouseLeave: (ev) => { ev.currentTarget.style.opacity = "0.72"; ev.currentTarget.style.background = "transparent"; },
        },
        e(WorkbenchIcon, { size: 16 }),
        wide ? e("span", { key: "t" }, "工作台") : null,
      );
    }

    var betterSidebar = null;

    const inject = ["slots"];
    function apply(ctx) {
      // 软依赖 better-sidebar（optional peer）：等它就绪后注册工作台 Tab
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

      // 侧栏底部按钮（保持「工作台」名称）
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
