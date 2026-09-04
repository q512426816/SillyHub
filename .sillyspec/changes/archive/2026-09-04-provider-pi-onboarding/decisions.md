---
author: qinyi
created_at: 2026-09-04 10:10:00
---

# 决策记录（Decisions）

## D-001@v1: PI 交互式 driver 架构——RPC 长驻（pi --mode rpc JSON-RPC 双向）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: PI 交互式 driver 用什么架构？（A RPC 长驻 / B 每 turn spawn / C 混合降级）
- answer: 方案A RPC 长驻。spawn `pi --mode rpc --session-dir <隔离>` 单进程，JSON-RPC 双向（session/resume/prompt/interrupt/权限交互），事件流经归一化器产 AgentEvent v2。B 折半能力与目标冲突，C 双维护 YAGNI
- normalized_requirement: inject/interrupt/permission_dialog 三能力必须有双向通道；partial 流式实时；对照 CodexAppServerDriver 先例与 multica pi RPC 同款
- impacts: [FR-01, FR-02]
- evidence: 用户 AskUserQuestion 方案轮实答（2026-09-04）；pi --mode rpc 实测可交互

## D-002@v1: 能力差距策略——桥接补齐+如实标记
- type: boundary
- priority: P0
- status: accepted
- source: user
- question: PI 原生缺某项 Claude 能力（如子代理/审批对话）怎么办？
- answer: 设计期逐项 rpc 实测：原生有的全接；缺的用 pi extension/daemon 桥接补齐（如权限对话经 rpc 审批通道桥、子代理若 pi 无 Task 工具则 caps=false 或 extension 方案评估）；实在补不了如实 caps=false 并在交付报告列明——不虚标不丢功能
- normalized_requirement: 8 项 caps 每项三态结论（原生/桥接/暂缺+原因）；caps 表值必须与实测一致
- impacts: [FR-03]
- evidence: 用户 AskUserQuestion 需求澄清轮实答（2026-09-04）
