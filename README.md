# dsh-engineering-workbench

水处理与电气自动化整合包的侧边栏「工作台」按钮插件（DSH bundle）。

> 作者：moqsting（GitHub）

## 功能

在 DSH 侧边栏底部注入「工作台」按钮：

- 点击启动本地工作台，按钮右侧显示 `正在启动中`；
- 就绪后浏览器打开工作台，状态变 `正在运行`；
- 再点关闭工作台，状态 `正在关闭`，随后关闭网页、状态消失。

## 架构

```
src/index.js        host 插件（cordis）：/api/workbench/{status,start,stop}
src/runtime.js      profile 事实来源（ctx.profileContext，官方契约）
src/workbench.js    工作台进程管理（启动/停止/探测 + pythonw 探测）
src/client.js       浏览器 bundle（按钮 + 状态机）
cordis.patch.yml    bundle 注入 patch
```

## 路径契约

本插件不硬编码任何绝对路径。工作台位置由整合包 manifest 声明、导入器落盘：

- 工作台：`<profileDir>/wta/ui/server.py`（整合包 `overrides/wta/` 落点）
- Python 依赖：`<profileDir>/pydeps/`（整合包 `files[]` 落点）

`profileDir` 取自 `ctx.profileContext`（DSH 0.1.7+），缺失时回退 `DSH_HOME` 环境变量。

## 环境要求

- DSH 0.2.0-rc.2（profileContext 事实来源）；
- Python 3.12（勾选 py launcher）——本机环境限制，未装时按钮报错并提示；
- Windows（工作台为本地 Python 服务）。

## 开发

```bash
npm install        # 无运行时依赖，仅安装 devDependencies（如有）
npm test           # node --test test/
```

## 版本与坐标

整合包通过 git 依赖引用本仓库（manifest v5 契约）：

```json
"dependencies": { "github:moqsting/dsh-engineering-workbench": "<commit sha>" }
```
