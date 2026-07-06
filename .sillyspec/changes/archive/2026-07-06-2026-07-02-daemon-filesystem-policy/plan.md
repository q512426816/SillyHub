---
author: WhaleFall
created_at: 2026-07-02T09:00:00
change: 2026-07-02-daemon-filesystem-policy
stage: plan
---

# Plan: Daemon Filesystem Policy Engine

## Wave 分组

| Wave | 主题 | Tasks | 依赖 |
|---|---|---|---|
| 1 | 路径工具 | task-01 path-utils.ts（resolveRealPath/isPathUnderAnyRoot） | 无 |
| 2 | 策略缓存 | task-02 PolicyCache | Wave 1 |
| 3 | 策略引擎 | task-05 PolicyEngine（canWrite/canRead/canCreate/canDelete） | Wave 2 |
| 4 | 装配集成 | task-11 cli.ts 装配 + task-12 _syncAllowedRoots + task-13 WS POLICY_UPDATE | Wave 3 |
| 5 | 写守卫 | task-14 session-manager + task-15 write-guard | Wave 4 |
| 6 | batch 审批 | task-16 TaskRunner policyCache + task-17 codex approval | Wave 5 |
| 7 | 审计 | task-04 AuditSink + task-09 PolicyAuditLog + task-10 审计端点 | Wave 1-6 |
| 8 | 前端 | task-19/20 审计页 + task-21/22 验收 | Wave 7 |

- [x] task-01 path-utils resolveRealPath/isPathUnderAnyRoot
- [x] task-02 PolicyCache 按 runtime_id 隔离
- [x] task-03 normalizeAllowedRoots
- [x] task-04 AuditSink 攒批上报
- [x] task-05 PolicyEngine canWrite/canRead/judgeWrite
- [x] task-06 WS POLICY_UPDATE 推送
- [x] task-07 心跳 _syncAllowedRoots
- [x] task-08 _syncPolicyCache 兜底
- [x] task-09 PolicyAuditLog 后端审计落库
- [x] task-10 审计端点
- [x] task-11 cli.ts 装配 PolicyEngine
- [x] task-12 daemon _syncAllowedRoots
- [x] task-13 WS _handlePolicyUpdate
- [x] task-14 session-manager 写守卫
- [x] task-15 write-guard
- [x] task-16 TaskRunner policyCache 快照
- [x] task-17 codex 带内审批
- [x] task-18 canRead 读自由
- [x] task-19 前端审计页
- [x] task-20 审计页路由
- [x] task-21 真机回归步骤
- [x] task-22 端到端验证报告
