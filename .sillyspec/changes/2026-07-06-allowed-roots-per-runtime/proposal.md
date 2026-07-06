---
author: WhaleFall
created_at: 2026-07-06 11:31:58
change: 2026-07-06-allowed-roots-per-runtime
stage: proposal
---

# Proposal: allowed_roots per-runtime 隔离恢复

## 动机

用户报：只配 CC（claude）的可写目录，Hermes 也跟着变（新增/删除同步）。期望各 agent 独立配置互不影响。

根因：daemon-entity-binding（2026-07-03）把 allowed_roots 从 DaemonRuntime 上提到 DaemonInstance（机器级 per-instance，D-006）。同一 daemon 的所有 provider runtime（CC + Hermes）绑定同一 instance，共享 allowed_roots。这违背了更早的 daemon-filesystem-policy（2026-07-02）per-runtime 隔离初衷（D-002，line 34 批评"取并集违背 per-runtime 隔离意图"）。

## 关键问题（为什么现有方案不够）

- 当前 instance 级共享 = 配 CC 影响 Hermes，违背用户期望 + daemon-filesystem-policy 设计
- 纯废弃机器级（方案 B）丢失 daemon 本机配置能力
- 运行时合并（方案 C）语义是"覆盖"非"独立演化"，复杂且违背用户决策

## 变更范围

- DaemonRuntime 加回 allowed_roots 列（per-runtime 持久化）
- DaemonInstance.allowed_roots **保留**作机器级 default
- 注册：新 runtime copy instance.default；register/heartbeat 响应返 per-runtime allowed_roots
- backend：update_allowed_roots 写 runtime 级；_runtime_read 读 runtime 级
- daemon：_syncAllowedRoots per-runtime；PolicyCache 已 per-runtime（不变）
- WS push：roots 来源改 runtime 级（payload_runtime_id 已支持）
- 迁移：加列 + copy instance→runtime

## 不在范围内

- 前端 UI 改动（runtimes 页已是 per-runtime 入口）
- daemon-entity-binding 的 per-daemon 架构（注册/心跳/WS 路由不变）
- PolicyEngine 内部逻辑（已 per-runtime）
- 审计落库（已 per-runtime runtimeId）

## 成功标准（可验证）

1. 配 CC 可写目录，Hermes runtime.allowed_roots 不变（DB 查询验证）
2. 删 CC 某目录，Hermes 不变
3. 新 daemon 注册，runtime 继承 instance default
4. WS sub-second 下发 per-runtime（配 CC 秒级生效，daemon PolicyCache 仅 CC 变）
5. 审计页 CC 的记录按其独立配置
