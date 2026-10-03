/**
 * dsh-water-treatment-engineering —— 浏览器侧插件（client bundle）。
 * 侧边栏底部按钮，状态机：
 *   空闲 → 点击启动工作台（"正在启动中"）→ 就绪后 window.open（"正在运行"）
 *         → 再点击关闭工作台（"正在关闭"）→ 关闭网页（回到空闲，无字样）
 */
window.__ModuleLoader__.load({
  id: "dsh-water-treatment-engineering",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    let react = require("react");
    const e = react.createElement;

    const store = { state: "idle", listeners: new Set() };
    function setState(next) {
      store.state = next;
      for (const listener of store.listeners) listener();
    }
    function subscribe(listener) {
      store.listeners.add(listener);
      return () => store.listeners.delete(listener);
    }

    let win = null;

    async function api(path) {
      const r = await fetch(path, { method: "POST", credentials: "same-origin" });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || j.ok !== true) {
        throw new Error((j && j.error) ? j.error : `操作失败(HTTP ${r.status})`);
      }
      return j;
    }

    async function toggle() {
      if (store.state === "starting" || store.state === "stopping") return; // 进行中忽略重复点击
      if (store.state === "idle") {
        setState("starting");
        try {
          const j = await api("/api/workbench/start");
          win = window.open(`http://127.0.0.1:${j.port}`, "_blank");
          setState("running");
        } catch (err) {
          window.alert("启动工作台失败：" + (err && err.message ? err.message : String(err)));
          setState("idle");
        }
      } else if (store.state === "running") {
        setState("stopping");
        try {
          await api("/api/workbench/stop");
          if (win && !win.closed) { try { win.close(); } catch {} }
          win = null;
          setState("idle");
        } catch (err) {
          window.alert("关闭工作台失败：" + (err && err.message ? err.message : String(err)));
          setState("running");
        }
      }
    }

    function WorkbenchButton(props) {
      const state = react.useSyncExternalStore(subscribe, () => store.state);
      const wide = props && props.wide;
      const statusText = {
        starting: "正在启动中",
        running: "正在运行",
        stopping: "正在关闭",
      }[state] || null;
      return e(
        "button",
        {
          title: state === "running" ? "关闭工作台" : "打开工作台",
          "aria-label": "工作台",
          onClick: toggle,
          style: {
            display: "flex",
            alignItems: "center",
            gap: 6,
            border: "none",
            background: "transparent",
            color: "inherit",
            opacity: 0.72,
            cursor: "pointer",
            padding: "6px 10px",
            borderRadius: 8,
            fontSize: 13,
            lineHeight: 1,
            width: wide ? "100%" : "auto",
            justifyContent: wide ? "flex-start" : "center",
          },
          onMouseEnter: (ev) => {
            ev.currentTarget.style.opacity = "1";
            ev.currentTarget.style.background = "rgba(127, 127, 127, 0.14)";
          },
          onMouseLeave: (ev) => {
            ev.currentTarget.style.opacity = "0.72";
            ev.currentTarget.style.background = "transparent";
          },
        },
        e(
          "svg",
          {
            width: 16, height: 16, viewBox: "0 0 24 24", fill: "none",
            stroke: "currentColor", strokeWidth: 2,
            strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true,
          },
          e("rect", { key: "r", x: 3, y: 4, width: 18, height: 16, rx: 2 }),
          e("line", { key: "l1", x1: 3, y1: 9, x2: 21, y2: 9 }),
          e("circle", { key: "c", cx: 8, cy: 14, r: 1.5 }),
          e("circle", { key: "c2", cx: 13, cy: 14, r: 1.5 }),
        ),
        wide ? e("span", { key: "t" }, "工作台") : null,
        statusText
          ? e(
              "span",
              {
                key: "s",
                style: { fontSize: 11, opacity: 0.8, marginLeft: wide ? "auto" : 4 },
              },
              statusText,
            )
          : null,
      );
    }

    const inject = ["slots"];
    function apply(ctx) {
      ctx.slots.inject("sidebar.footer.action", () =>
        ctx.slots.register({ name: "sidebar.footer.action", id: "dsh-water-treatment-engineering-button" }, WorkbenchButton),
      );
    }

    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
