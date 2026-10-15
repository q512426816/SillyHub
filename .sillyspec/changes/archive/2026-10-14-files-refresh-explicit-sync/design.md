---
author: flow-machine-draft
created_at: 2026-10-14T00:45:14.881Z
---
# 设计记录（Design Record）— 2026-10-14-files-refresh-explicit-sync

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

上一变更（2026-10-13-change-files-refresh-sync）把同步前置挂在 GET files 接口本体上，导致悬浮面板 15s 自动轮询等非主动读取也周期性触发 daemon CLI 同步并阻塞请求（实测感知为页面一直慢）。本变更收窄触发面：GET files 增加可选查询参数 `sync`（默认 false=纯读，行为回到上一变更之前），仅显式 `sync=1`（前端「刷新」按钮点击、错误重试——用户主动动作）才触发 daemon 定向上行同步；同时把 sync 路径的 RPC 等待预算从 15s 降到 3s——点击刷新多数情况在预算内拿到同步后数据，超时静默降级返回现有镜像数据（daemon 防抖 15s 内再点秒回新数据），任何一次点击都不会长时间卡住。前端改动集中在 change-file-tree.tsx 的 refreshTree 增加来源区分：按钮点击/错误重试带 sync=true，初始挂载、autoRefreshMs 轮询、保存后刷新不带。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `GET /api/workspaces/{ws}/changes/{id}/files` 新增可选查询参数 `sync: bool = False`（FastAPI Query）——默认 False 纯读不触发同步；True 时走 `_sync_change_via_daemon`（RPC 超时 3s）。响应 schema 不变（ChangeFileList）。
- backend 常量 `_FILES_REFRESH_SYNC_RPC_TIMEOUT_S`：15.0 → 3.0。
- 前端 `listChangeFiles(workspaceId, changeId, options?: { sync?: boolean })`（frontend/src/lib/change-files.ts）——sync=true 时 URL 追加 `?sync=1`。
- `refreshTree(sync?: boolean)`（change-file-tree.tsx:441）——刷新按钮 onClick 与 ErrorBanner onRetry 传 true，其余调用点不传。
- api-types.ts 经 `pnpm gen:types` 再生成（backend schema 变更联动，规则 21）。
- daemon 侧零改动（防抖 15s 语义不变）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：sync=1 触发的 RPC 超时（3s）后 daemon CLI 仍在后台跑完——迟到的同步结果经防抖 Map 落 done 态，后续请求命中 15s 防抖秒回；与上一变更 R-05 语义一致。
2. 并发写：多用户同时点刷新 → daemon 侧 in-flight 去重（同 key 第二请求回 skipped），无并发写风险；GET 纯读路径无写。
3. 切换/生命周期：悬浮面板关闭即停轮询（既有行为），无残留定时器触发 sync；请求中途取消不影响 daemon 侧防抖状态机。
4. 作用域：sync 参数按请求粒度透传（change_key + workspace_id 随请求携带），跨工作区/多 daemon 不串台；纯读路径完全不碰 daemon 通道。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：点击刷新在 3s 预算内同步未完成 → 本次返回旧数据（用户可能感知「点了没变化」）。缓解：daemon 防抖窗口内再点秒回且数据已新（两次点击内必见新数据）；后续若体验仍差可前端加「同步中」提示。试过但放弃：①异步触发+前端延时补拉（方案更优但改动面含前端联动逻辑，超 thin 边界——留作后续升级）；②只降超时不动触发面（悬浮面板轮询仍周期性打 CLI，不解决「一直慢」根因）。
