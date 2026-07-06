---
author: WhaleFall
created_at: 2026-07-06 11:31:58
change: 2026-07-06-allowed-roots-per-runtime
stage: decisions
---

# Decisions: allowed_roots per-runtime 隔离

## D-001@v1 机器级 default 保留

**决策**：DaemonInstance.allowed_roots 保留（daemon 上报），作新 runtime 注册初始值。

**理由**：保留 daemon 本机配置能力（不丢失）；新 agent 有合理初始值，无需手配。

**否决**：方案 B（废弃机器级）丢失 daemon 本机配置；方案 C（运行时合并）语义是覆盖非独立演化。

## D-002@v1 runtime 独立演化

**决策**：PUT 写 runtime.allowed_roots，CC/Hermes 互不影响。

**理由**：用户核心诉求；恢复 daemon-filesystem-policy D-002 per-runtime 隔离初衷。

## D-003@v1 新 runtime 注册 copy instance.default

**决策**：register_daemon 新建 runtime 时 copy instance.allowed_roots → runtime.allowed_roots。

**理由**：新 agent 有合理初始值；机器级 default 作为新 agent 的 source of truth。

## D-004@v1 daemon 重配不覆盖已演化 runtime

**决策**：daemon 本机重配（instance.default 变）只影响新注册 runtime，不覆盖已独立演化的 runtime。

**理由**：独立演化保证；已配的 runtime 不被机器级变更回退。

## D-005@v1 空 allowed_roots fail-closed deny

**决策**：runtime.allowed_roots=[] → 写拦截 fail-closed deny。

**理由**：安全优先；与 ql-20260702-008 行为一致。

## D-006@v1 schema breaking 同步部署

**决策**：心跳响应改 per-runtime map + register 响应加 allowed_roots，backend + daemon 同步部署。

**理由**：daemon-entity-binding D-007 已建立 breaking 同步机制；项目未上线允许同步重启。旧 daemon 解析新响应失败 → 要求同步升级。

## 覆盖关系

| 决策 | 来源 | 覆盖 FR |
|---|---|---|
| D-001@v1 | 本变更 | FR-02 |
| D-002@v1 | 继承 daemon-filesystem-policy D-002 | FR-01, FR-03, FR-04 |
| D-003@v1 | 本变更 | FR-02 |
| D-004@v1 | 本变更 | FR-03 |
| D-005@v1 | 继承 ql-008 | FR-06 |
| D-006@v1 | 继承 daemon-entity-binding D-007 | NFR breaking |
