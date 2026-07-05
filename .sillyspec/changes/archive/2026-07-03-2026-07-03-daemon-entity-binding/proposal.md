---
author: qinyi
created_at: 2026-07-03 11:14:39
change: 2026-07-03-daemon-entity-binding
stage: brainstorm
---

# Proposal — 守护进程实体化绑定

## 背景

当前工作区（workspace）绑定指向 `daemon_runtimes.id`，一行 = 用户×机器×某智能体的注册。后端无独立「daemon 实体」概念，物理守护进程身份靠它注册出的 N 行 runtime 隐式表达（唯一键 user+provider+hostname）。导致三个真问题：

1. 守护进程无稳定身份：hostname 变即 runtime id 重建、绑定全断；同机双开互相覆盖心跳。
2. 绑定粒度过细：同机跑 claude+codex 需分别绑两次。
3. 智能体维度混进绑定：「连哪台机器」与「用哪个智能体」被 runtime_id 揉成一件。

## 目标

- 引入 `daemon_instances` 实体（稳定身份：本地 uuid + 按 server_url 隔离）。
- `daemon_runtimes` 退化为 daemon×provider 从属清单。
- 工作区 per-member 绑定从 runtime_id 改 daemon_id。
- daemon 注册 / WS Hub / 心跳从 per-runtime 改 per-daemon。
- 派发按 daemon_id + workspace.default_agent 解析。

## 方案（A · 标准实体化）

新建 `daemon_instances` 表（机器级字段归位）；`daemon_runtimes` 加 `daemon_instance_id` + 移除机器级冗余；`workspace_member_runtimes` 加 `daemon_id`；daemon config 按 server_url 分文件隔离；WS Hub 键从 runtime_id 改 daemon_instance_id；placement `_resolve_dispatch_runtime` 改读 daemon_id + default_agent 解析；前端 switcher 选 daemon。

## 影响范围

跨 backend + frontend + sillyhub-daemon 三组件。WS 握手协议 breaking（daemon 与 backend 必须同步升级）。数据策略倾向重置（CLAUDE.md 规则10 允许）。

## 不在范围内 / Non-Goals

- 不改 agent-detector 探测逻辑（仍扫 PATH，`agent-detector.ts:104-180`）。
- 不引入「一成员绑多 daemon」（沿用 per-member 一行）。
- 不改 lease / daemon_change_writes 的 runtime_id 引用（D-003 保留）。
- 不新增 daemon 端 provider 启停 UI（provider 启用由本机探测决定）。
- 不做 runtime_id→daemon_id 历史数据迁移脚本（D-007 重置）。

## 决策

D-001~D-008，详见 `decisions.md` 与 `design.md`。

## 关联

- 复用 `2026-07-01-collaborative-workspace` 的 per-member 表结构。
- 在 `2026-07-02-workspace-config-flow`（已归档，绑 runtime 方案）基础上重构。
