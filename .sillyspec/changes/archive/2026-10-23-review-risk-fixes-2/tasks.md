---
author: flow-machine-draft
created_at: 2026-10-22T23:55:20.073Z
---
# 任务注册表（Tasks）— 2026-10-23-review-risk-fixes-2

- [x] task-01: 同根新 workspaceId 的采集不再被旧探针的淘汰条目静默跳过（竞态测试钉住），skip 命中有一次性 warn 日志
- [x] task-02: 跑马灯追平目标后 rAF 停排，新内容到达或重新可见时恢复动画
- [x] task-03: diff 阶段非 timeout git 错误落结构化 warn 日志（stage+错误归类），不再无痕消失
- [x] task-04: requestBatch 响应处理异常时该批回退原文并入退避，Promise 不再悬挂
