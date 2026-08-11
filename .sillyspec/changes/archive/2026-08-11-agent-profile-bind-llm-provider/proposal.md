---
author: WhaleFall
created_at: 2026-08-11T10:06:13
change: 2026-08-11-agent-profile-bind-llm-provider
---

# 提案：智能体档案绑定供应商配置

## 背景

智能体档案（`AgentProfile`）现有 `provider` 字段（claude/codex），前端表单 label 为「供应商偏好（决定选哪台 daemon）」。该 label 描述错误：`provider` 不决定选哪台 daemon（daemon 由工作区 binding 决定），只决定在选中 daemon 上匹配哪个 `DaemonRuntime`。同时，档案与实际 API 凭证脱节——任务运行时用哪条凭证由 `daemon/lease/context.py::_inject_provider_config` 按「用户默认 `LlmProvider`」决定，与档案无关，用户无法让「不同档案用不同供应商」。

## 目标

- **G1** 修正字段语义：`provider` 在 UI 显示为「智能体引擎」（后端字段名/取值不变）。
- **G2** 档案级供应商绑定：档案可绑定一条 claude 类 `LlmProvider`（`llm_provider_id`，可选），任务启动优先用绑定那条凭证。
- **G3** 跨用户安全（方案A）：共享档案绑的供应商只对「daemon 登记者==provider owner」的执行上下文生效，其余静默回退，不泄露密钥。
- **G4** 零回归：未绑定时凭证注入与现状逐字一致。

## 方案概述

档案新增 `llm_provider_id`（FK→`llm_providers.id`，`ondelete=SET NULL`，nullable）。任务派发时 `_apply_profile_to_lease` 把该 id 写入 `lease.metadata`；`_inject_provider_config` 装配 payload 时按四级优先级取凭证：绑定且归属校验通过且引擎类型一致 → 用绑定；否则回退用户默认 → 用户无默认则不注入（D-007）→ daemon 本机。前端表单「大脑」区第一层改名为「智能体引擎」，第二层新增「供应商配置」联动下拉（数据源 `/llm-providers`，按 `agent_kind` 过滤，可选）。

## 不在范围内（Non-Goals）

- **不开放 codex 类供应商**：`agent_kind` 仍 `Literal["claude"]`，第二层选 Codex 引擎时无选项。
- **不改运行中会话热切换**：`PROVIDER_CONFIG_CHANGED` 推送行为不变（R-04）。
- **不在档案存任何 API Key**：R-02 红线不变。
- **不做 `workspaces.default_agent_profile_id` 的设置 UI**。
- **不补 mission 前端 `agent_profile_id` gap**。

## 影响范围

- **后端**：`agent/profile`（模型/DTO/service）、`agent/service.py`（lease 透传）、`daemon/lease/context.py`（注入逻辑）、新迁移。
- **前端**：`agent-profile-form.tsx`（改名+第二层下拉）、`agent-profile/*` 卡片/预览、`api-types.ts` 重生成。
- **用户感知**：新建/编辑档案时可额外绑定一条供应商；不改任何现有档案行为。
