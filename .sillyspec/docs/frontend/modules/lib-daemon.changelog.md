---
author: qinyi
created_at: 2026-09-04 03:08:00
---

# lib_daemon 模块变更索引

- ql-20260904-004-d218 | SSE 三订阅 resync 阶段永久性错误停连补口——streamSession/streamGroupChat/streamShadowSession 的 resyncAndReconnect catch 经 isPermanentRestError（ApiError.status ∈ PERMANENT_SSE_ERROR_STATUSES）分流，会话中途被删/权限收回后不再每 30s 一轮必败 resync 永久循环（onerror 停连分支建连前走不到，ql-20260903-021 只覆盖建连后路径）；新增「连接中会话被删→断连→resync 404 停连」回归用例（5 用例绿+相邻 39 绿+tsc 0）
