---
id: task-10
title: 端到端验证 per-runtime 隔离
author: WhaleFall
created_at: 2026-07-06T11:40:00
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09]
blocks: []
allowed_paths:
  - .sillyspec/changes/2026-07-06-allowed-roots-per-runtime/
change: 2026-07-06-allowed-roots-per-runtime
goal: "(见 body)"
implementation: "(见 body)"
acceptance: "(见 body)"
verify: "(见 body)"
constraints: "(见 body)"
---

# task-10

> goal: 真机验证 per-runtime 隔离全链路。全 FR。

## implementation
- 部署：build backend 镜像 + daemon bundle，同步重启（D-006）；迁移 task-01 在 backend 启动跑
- 真机：前端配 CC allowed_roots → DB 查 daemon_runtimes（CC 变 Hermes 不变）→ daemon.log POLICY_UPDATE 仅 CC → 审计页 CC 记录
- 验证 PolicyCache：CC session 写允许/拒绝按其配置，Hermes session 不受影响

## 验收标准
1. 配 CC 可写目录 → Hermes runtime.allowed_roots 不变（DB + 审计页）
2. 删 CC 某目录 → Hermes 不变
3. 新 daemon 注册 → runtime 继承 instance default
4. WS sub-second 下发 per-runtime（配 CC 秒级生效，daemon PolicyCache 仅 CC 变）
5. 审计页 CC 的 ALLOW/DENY 按其独立配置

## 验证
- DB 查询：PUT CC 前后 daemon_runtimes.allowed_roots（CC 变 Hermes 不变）
- daemon.log：POLICY_UPDATE payload_runtime_id=CC_rid
- 前端审计页：CC 记录

## constraints
- 需 admin 凭证 + claude session 真机（e2e 步骤参考 daemon-filesystem-policy）
