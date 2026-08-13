---
title: quick 独立阶段需求
change_key: 2026-08-12-quick-independent-stage
status: draft
created_at: 2026-08-12T21:35:00+08:00
author: WhaleFall
---

# Requirements: quick 独立阶段

## FR-01：创建分流

quick 类型变更创建时，`current_stage` 设为 `quick`（而非 brainstorm）。

- 输入：`classify_change_type(description)` 返回 `"quick"`
- 输出：`Change.current_stage = "quick"`，`stages = {"quick": {"status": "pending"}}`
- 适用：`proxy.py`（daemon-client 路径）+ `service.py`（worktree lease 路径）

## FR-02：StageEnum 扩展

`StageEnum` 加 `QUICK = "quick"`，作为 auxiliary 阶段。

- `spec_stages()` 仍只返回主线 5 阶段（brainstorm/plan/execute/verify/archive）
- 新增 `spec_auxiliary_stages()` 返回 `[QUICK]`
- `TRANSITIONS` 不加 quick 边（quick 无后继）

## FR-03：dispatch 支持 quick

`STAGE_AGENT_CONFIG` 加 quick 配置（prompt_template=`quick.md`，read_only=False）。

- quick 变更通过 `POST /changes/{id}/dispatch`（manual_dispatch）派发
- dispatch 按 `current_stage=quick` 取 STAGE_AGENT_CONFIG[quick] 配置

## FR-04：列表页 quick 标签

变更列表页阶段列对 quick 变更显示「快速任务」。

- `STAGE_LABEL` 加 `quick: "快速任务"`
- `STAGE_KIND` 加 `quick: "warning"`

## FR-05：详情页 quick 操作区

变更详情页对 quick 变更显示简化操作区。

- `ChangeStageActions` 加 quick 早返回分支
- quick 分支：标题「⚡ 快速修复」+ 档案选择器 + 触发智能体按钮 + 完成态
- quick 分支不渲染：主线推进按钮、gate 面板、团队开关

## FR-06：完成态判定

quick 变更跑完 agent 后显示「已完成」。

- 判定：`current_stage==='quick' && !hasActiveRun && 最近 run completed`
- 不加 DB 字段，纯前端从 agentStatus 推导

## NFR-01：向后兼容

主线 5 阶段变更逻辑零改动，现有 brainstorm/plan/execute/verify/archive 变更不受影响。

## NFR-02：无 DB 迁移

`current_stage` 是字符串列，存 'quick' 无需 schema 改动，无迁移脚本。

## 验收

见 [design.md §9](./design.md#9-验收标准)。
