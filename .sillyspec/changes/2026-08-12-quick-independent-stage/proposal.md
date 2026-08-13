---
title: quick 独立阶段全套适配
change_key: 2026-08-12-quick-independent-stage
status: draft
created_at: 2026-08-12T21:35:00+08:00
author: WhaleFall
---

# Proposal: quick 独立阶段全套适配

## 一句话

让 quick 类型变更作为 SillySpec 独立辅助阶段接入平台（与主线 5 阶段平行），创建即 `current_stage=quick`，派 agent 跑 quick 三步，跑完即完成不归档，前端列表/详情页全套适配。

## 动机

上一轮 ql-20260812-006 把所有新建变更统一设为 brainstorm，但 SillySpec 的 quick 本是独立阶段（`VALID_STAGES` 含 quick，`auxiliary: true`），自己跑三步就结束，不走主线。把 quick 塞进 brainstorm 导致名实不符、详情页操作区错乱。

## 方案概要

- **后端**：StageEnum 加 QUICK（auxiliary，不进 spec_stages）；STAGE_AGENT_CONFIG 加 quick 配置；change_writer 创建时 `change_type=quick` → `current_stage=quick`。
- **前端**：列表页 STAGE_LABEL 加 quick:快速任务；详情页 ChangeStageActions 加 quick 简化分支（隔离主线 UI）。
- **无 DB 迁移**（current_stage 是字符串列）。

## 规模评估

- scale: **large**（跨 backend/change + backend/change_writer + frontend/changes 三模块，涉及枚举/状态机/前端 UI 分支）
- tier: self（≤6 文件，单 agent 自审）

## 不在范围内（Non-Goals）

- 不改主线 5 阶段（brainstorm/plan/execute/verify/archive）任何逻辑
- 不改 quick 分类器关键词（ql-20260812-006 已交付）
- 不处理 explore 阶段（结构与 quick 类似，本次不做）
- 不加 DB 迁移（current_stage 是字符串列）
- 不做 quick 的归档（quick 跑完即完成，不进 archive）

## 依赖

- 无外部依赖。
- 前置 ql-20260812-006（classifier + draft→brainstorm）已合并。

## 详见

- [design.md](./design.md) — 完整技术设计
- [requirements.md](./requirements.md) — 需求与验收
- [tasks.md](./tasks.md) — 实现任务分解
