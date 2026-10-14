---
author: flow-machine-draft
created_at: 2026-10-14T00:45:14.881Z
---
# 任务注册表（Tasks）— 2026-10-14-files-refresh-explicit-sync

- [x] task-01: GET files 默认（不带 sync 参数）为纯读：不触发 daemon 同步、直接返回平台镜像数据，响应语义与现状一致
- [x] task-02: 显式 sync=1（前端刷新按钮点击、错误重试）才触发 daemon 定向上行同步，等待预算从 15s 降到 3s，超时静默降级返回现有镜像数据
- [x] task-03: 悬浮面板 autoRefreshMs 轮询、初始挂载加载、保存后刷新均不带 sync（不触发同步）
- [x] task-04: backend/daemon typecheck + 聚焦测试全绿，api-types 经 gen:types 再生成
