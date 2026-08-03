---
author: qinyi
created_at: 2026-08-02 18:09:30
---

# 提案 — AgentProfile 配置层

## 背景

当前 daemon（执行算力）经 `WorkspaceMemberRuntime` 直接服务 workspace，缺少独立、可复用、可管理的「智能体配置/人格」实体。现状"人格"是 dispatch 时临时拼装的 `spec_bundle`（CLAUDE.md），用完即弃，无法保存、复用、版本管理。代码已埋 `AgentRun.profile_version`/`spec_strategy` 字段但未落地。

经两组独立多代理分析 + 代码级地基核实（见 `memory/agent-profile-layer-decision.md`），收敛为：**引入 AgentProfile 配置增强层**，而非全量三层改造或运行时实例。

## 目标

- 提供「创建一套配置、多处复用」的智能体档案（AgentProfile）。
- 让不同场景（代码审查 / 快速扫描 / 深度重构）用不同模型+提示词+工具组合，不必每次 dispatch 手动传参。
- 解锁多 agent 协作（MissionService 子 agent 按角色用不同档案）的配置来源。
- 全程向后兼容（PPM 已上线零回归）、不存密钥、不破坏现有绑定。

## 方案选择

采用**方案 A：全人设 profile**（见 design §2）。AgentProfile 管「大脑（模型+提示词）+ 挑工具（MCP/技能/工具策略引用）」；`spec_bundle` 只管 spec 上下文，正交不互斥；`build_spec_bundle` 零改动。

## 在范围内（In Scope）

1. `agent_profiles` 表 + 三级可见范围（个人/工作区/平台）+ 版本号
2. 档案 CRUD API + 前端管理页（三组表单）
3. 平台预置两个默认档案（Claude Code 默认 + Codex 默认）
4. placement provider-aware 改造（档案 provider ∩ daemon 能力）
5. dispatch 注入档案快照；AgentRun 绑 profile_id + snapshot
6. 软约束兜底链（run→工作区默认→平台默认→原路径）
7. MCP/技能引用透传到 daemon（取子集 + 过 whitelist + 仅 stdio）
8. system_prompt 经 lease 注入，与 spec CLAUDE.md 合并
9. 配置三层取交集（allowed_roots agent 只收紧）

## 不在范围内（Non-Goals）

- **不改** daemon-entity-binding、不动 WorkspaceMemberRuntime 绑定结构（runtime_id 134 文件引用，不大爆炸解耦）
- **不引入** AgentInstance 运行时实体（避免与 AgentSession 重叠）
- **不做** N:N 活引用式跨工作区共享（用 visibility 受限共享 + 复制，业界共识）
- **agent 层不存**任何密钥（API Key/MCP 凭证）
- **不重写** build_spec_bundle 渲染管线（保护所有现有 run）
- **不做** agent 模板市场、跨工作区配额计费、agent 执行统计（留后续）
- **不做** MCP 调用的跨 workspace 数据串隔离（记为后续安全项）

## 验收标准概要

- 能创建/编辑/删除档案，三级可见范围权限正确
- 发起任务能选档案并按其配置执行（模型/提示词/工具/技能子集）
- 未选档案时走兜底链，行为与今天一致（PPM 零回归）
- agent 层无任何密钥落库（grep 验证）
- local.yaml module 级 verify 通过（agent/workspace/daemon/frontend 子模块）
