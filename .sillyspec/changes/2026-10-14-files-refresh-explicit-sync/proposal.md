---
author: flow-machine-draft
created_at: 2026-10-14T00:45:14.881Z
---
# 提案书（Proposal）— 2026-10-14-files-refresh-explicit-sync

## 动机

任务原话转写：动机：文件树刷新前置同步的触发面挂在了 GET files 接口本体上——会话悬浮面板 15s 自动轮询、初始加载等非主动读取也周期性触发 daemon CLI 同步并阻塞请求，用户感知为页面一直慢；用户明确要求只有页面上点击「刷新」按钮才触发 CLI 同步，其它一切读取直接秒回平台现有镜像数据。
成功标准：
- GET files 默认（不带 sync 参数）为纯读：不触发 daemon 同步、直接返回平台镜像数据，响应语义与现状一致
- 显式 sync=1（前端刷新按钮点击、错误重试）才触发 daemon 定向上行同步，等待预算从 15s 降到 3s，超时静默降级返回现有镜像数据
- 悬浮面板 autoRefreshMs 轮询、初始挂载加载、保存后刷新均不带 sync（不触发同步）
- backend/daemon typecheck + 聚焦测试全绿，api-types 经 gen:types 再生成

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. GET files 默认（不带 sync 参数）为纯读：不触发 daemon 同步、直接返回平台镜像数据，响应语义与现状一致
2. 显式 sync=1（前端刷新按钮点击、错误重试）才触发 daemon 定向上行同步，等待预算从 15s 降到 3s，超时静默降级返回现有镜像数据
3. 悬浮面板 autoRefreshMs 轮询、初始挂载加载、保存后刷新均不带 sync（不触发同步）
4. backend/daemon typecheck + 聚焦测试全绿，api-types 经 gen:types 再生成

## 成功标准（可验证）

1. GET files 默认（不带 sync 参数）为纯读：不触发 daemon 同步、直接返回平台镜像数据，响应语义与现状一致
2. 显式 sync=1（前端刷新按钮点击、错误重试）才触发 daemon 定向上行同步，等待预算从 15s 降到 3s，超时静默降级返回现有镜像数据
3. 悬浮面板 autoRefreshMs 轮询、初始挂载加载、保存后刷新均不带 sync（不触发同步）
4. backend/daemon typecheck + 聚焦测试全绿，api-types 经 gen:types 再生成
