# dsh-engineering-workbench

水处理与电气自动化整合包的工作台插件（DSH bundle）。

作者：moqsting（[GitHub](https://github.com/moqsting)）

## 功能

以 DSH 原生主面板承载工作台界面，与官方「插件」面板同机制、同位置：

- 侧栏顶部注入「工作台」图标，与官方「插件」按钮并排；点击切换到工作台面板，再次点击折叠回对话；
- 文件页：从「文件区」目录开始浏览，点击文件调用 DSH 原生右侧栏文档预览（文本 / Markdown / 图片 / PDF / Excel / Office）；
- 设置页：设定「文件区」路径（图纸、报价表的存放目录），支持调用系统文件夹对话框或应用内目录浏览器；
- 工具 / 资源 / 环境：整合包增强页，仅在检测到 `<profileDir>/wta` 后端时显示。

「文件区」是本插件对工作目录的称呼，避免与 DSH 自身的会话工作区概念混淆。

## 架构

```
src/index.js        host 插件（cordis）：工作台进程管理 + 文件区/目录浏览等 host 路由 + 反向代理
src/runtime.js      profile 事实来源（ctx.profileContext，官方契约）
src/workbench.js    工作台进程管理（启动/停止/探测 + pythonw 探测）
src/client.js       浏览器 bundle（主面板 + 侧栏图标 + 各页面）
cordis.patch.yml    bundle 注入 patch
```

核心能力（文件区路径、目录浏览、文件预览）由 host 路由与 DSH 本体直接提供，不依赖整合包后端；整合包相关的工具/资源/环境接口经 host 反向代理访问，保持同源。

## 路径契约

本插件不硬编码任何绝对路径。工作台位置由整合包 manifest 声明、导入器落盘：

- 工作台：`<profileDir>/wta/ui/server.py`（整合包 `overrides/wta/` 落点）
- Python 依赖：`<profileDir>/pydeps/`（整合包 `files[]` 落点）

`profileDir` 取自 `ctx.profileContext`（DSH 0.1.7+），缺失时回退 `DSH_HOME` 环境变量。

## 环境要求

- DSH 0.2.0-rc.2；
- Python 3.12（勾选 py launcher）——本机环境限制，未装时相关页面报错并提示；
- Windows（工作台为本地 Python 服务）。

文件预览依赖 DSH 本体的右侧栏文档预览能力，需要存在活动会话；文件定位由原生预览面板承担，本插件不再自行调起系统文件管理器。

## 开发

```bash
npm test           # node --test test/
```

## 版本与坐标

整合包通过 git 依赖引用本仓库（manifest v5 契约）：

```json
"dependencies": { "dsh-engineering-workbench": "github:moqsting/dsh-engineering-workbench#<commit sha>" }
```

变更记录见 [CHANGELOG.md](./CHANGELOG.md)。
