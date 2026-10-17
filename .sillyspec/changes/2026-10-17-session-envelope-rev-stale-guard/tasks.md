---
author: flow-machine-draft
created_at: 2026-10-17T13:14:59.532Z
---
# 任务注册表（Tasks）— 2026-10-17-session-envelope-rev-stale-guard

- [x] task-01: SessionState 新增单调 rev 计数器：setTokens/setUser/clear 三个用户驱动变更加一，storage 回放不自动加一而是采纳远端 rev
- [x] task-02: 回放守卫：远端信封 rev 严格小于本地 rev 时整体忽略（陈旧）；等于时走既有内容比对（同值静默）；大于时采纳内容并同步 rev；内容全等但 rev 更新时仅同步 rev
- [x] task-03: 向后兼容：无 rev 字段的旧形状信封走既有内容比对路径，既有 6+3 用例语义不变
- [x] task-04: 新增单测覆盖：陈旧忽略、新 rev 采纳并同步、同内容仅同步 rev、等值同内容静默、变更加一
- [x] task-05: 既有 token-refresh/session 测试不回归
