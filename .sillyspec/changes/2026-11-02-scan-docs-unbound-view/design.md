---
author: flow-machine-draft
created_at: 2026-11-02T02:41:51.555Z
---
# 设计记录（Design Record）— 2026-11-02-scan-docs-unbound-view

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

后端零改动：扫描文档 list/get/stats/reparse 全部为纯服务端读取（`backend/app/modules/scan_docs/service.py` 读 scan_documents 表与服务端 spec 镜像，reparse 权限 WORKSPACE_WRITE，全程不触 daemon），「依赖 daemon」只存在于前端门槛。只改前端两文件：

1. `frontend/src/components/daemon-required-notice.tsx`：新增可选 prop `variant?: "blocked" | "degraded"`（缺省 `"blocked"` = 现状渲染不变，runtime 页零影响）。degraded 变体渲染紧凑横幅：文案改为「未绑定守护进程：当前展示的是工作区已有数据（由成员守护进程同步）」口径，保留「配置我的守护进程」按钮 + WorkspaceAccessGuide 内联展开 + onConfigured 回调（复用既有状态机，testid 沿用 `daemon-required-notice`）。
2. `frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx`：进页 effect 去掉 `if (!hasDaemon) return` 门槛——列表无条件拉取、后台 reparse 不再 gate（失败静默既有语义兜住只读 403）；渲染层 `!hasDaemon` 分支从「整页替换 DaemonRequiredNotice」改为「主区照常 + PageHeader 下渲染 degraded 横幅」。顺带修正 222-223 行过时注释（「reparse 经 host_fs 读源码（daemon-client），无 binding 时失败」与 task-09 后服务端镜像事实不符）。

选 variant 复用而非新写组件：配置入口 + WorkspaceAccessGuide 内联展开 + onConfigured 状态机已在 Notice 内，新写即复制粘贴。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `DaemonRequiredNotice` 新增可选 prop `variant?: "blocked" | "degraded"`，缺省 `"blocked"`；既有调用方（runtime 页）与既有 testid（`daemon-required-notice` / `daemon-required-config-btn` / `daemon-required-borrow-hint`）不变，degraded 变体沿用同一组 testid。
- scan-docs 页面无对外签名变化；后端 API 零改动。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

binding 拉取与列表拉取解耦——列表不再依赖 binding 结果（这正是本变更目的），binding 迟到/失败仅影响横幅显隐；`bindingReady` 前主区「加载中…」占位保留，无闪烁面。binding 拉取本身失败 catch 降级 null（既有）→ 等价无绑定横幅态，可接受（有 binding 但接口抖动的用户看到横幅 + 数据照常，无损）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

reparse 服务端幂等（content_hash 跳过未变更行），多成员并发进页触发多次 reparse 安全；本变更只放开绑定门槛、不改变触发时机，并发面与现状同构。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

onConfigured 成功 → 刷新 binding → hasDaemon 翻 true → 横幅消失、主区不动，无状态残留；effect cleanup active 标志既有不变。切换工作区时 workspaceId 变化重拉 binding 与列表（既有依赖数组）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

数据按 workspace_id 隔离（后端既有查询全带 workspace 过滤）；本变更纯前端门槛放开，不触及数据面，无跨工作区串台新风险。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 最大风险：无绑定且该工作区从未被任何成员的 daemon 同步过 → 服务端镜像不存在，reparse 回 DOCS_DIR_MISSING 警告 + 空列表。展示为既有空态 + warnings 横幅（既有渲染面），可接受——本来也无数据可看；不为此加特殊分支。
- 放弃方案①：后端为无绑定用户提供共享 daemon 绑定（把「借用」语义扩到读面）——牵动 runtime 权限模型，改动面大且不为「看存量数据」所需，放弃。
- 放弃方案②：不动 DaemonRequiredNotice、在 scan-docs 页内新写一个降级横幅组件——配置入口与引导展开逻辑得复制一遍，两处漂移风险，放弃（选 variant 复用）。
