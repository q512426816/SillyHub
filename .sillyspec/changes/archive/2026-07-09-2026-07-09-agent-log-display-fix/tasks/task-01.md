---
id: task-01
title: cache_creation 恒 0 根因实证 dump
author: qinyi
created_at: 2026-07-09 06:17:11
priority: P1
depends_on: []
blocks: [task-09]
requirement_ids: [FR-07]
decision_ids: [D-004@v2]
allowed_paths:
  - sillyhub-daemon/src/adapters/stream-json.ts
---

## 目标

跑一次真实 Claude run，同时在三处 dump cache_creation 原始值，明确恒 0 的真实根因归属（A1 / A2 / B），为 task-09 选定修复分支提供实证依据。

## 实现步骤

1. `extractResultStats` 入口（stream-json.ts ~1092-1162）临时加 `console.error` dump `result.usage` 原始 JSON（看是否含 `cache_creation_input_tokens`）。
2. dump `this._accumulatedUsage` 终值（看 `cache_creation_tokens` 聚合结果）。
3. `parseAssistant` / `usage_update` 处（stream-json.ts 678-683 / 548-553 周边）dump 每条 assistant 事件 `message.usage` 是否含 `cache_creation_input_tokens` 字段。
4. 跑一次真实 Claude run（含工具调用），收集三处 console 输出。
5. 对照三分支判定：A1（result.usage 返回且 accumulated 有）→ 修映射/聚合；A2（accumulated 漏采，assistant 事件 usage 无 cache 维度）→ 修 parseAssistant/usage_update 采集；B（都没有）→ 前端占位。

## 测试

本 task 是 spike 实证，不写单测；产出实证记录（三处 dump 输出 + 归属判定），写入 task-09 依据。

## 验收标准

- AC-07（据本 task 结果，task-09 选定分支后 cache_creation 显示真实值或"—/未知"占位）

## 依赖说明

无前置依赖。结果阻塞 task-09（cache_creation 分支落地按本实证择一）。
