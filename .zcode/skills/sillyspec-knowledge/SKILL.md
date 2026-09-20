---
name: sillyspec:knowledge
description: Agent-safe knowledge base commands for SillySpec repositories. Search, inspect, validate, refresh, and propose knowledge entries.
argument-hint: "search --query \"<text>\" --limit N | inspect --id \"<id>\" | validate | refresh | propose --title \"<title>\" --category <name>"
version: "3.19.2"
---

## 何时使用此技能

任务可能依赖项目既有知识（known issues / patterns / scan 结论 / `.sillyspec/knowledge`）时。**实现前先 search，避免重复踩坑。**

## 命令速查

所有命令输出均为 stdout 纯 JSON（`ok` 顶层字段 + 失败 `code` 错误码），以实际输出为准——参数细节跑 `sillyspec knowledge <子命令>` 无参可见用法，勿背示例。

| 命令 | 用途 | 关键参数 |
|---|---|---|
| `sillyspec knowledge search --query "<任务关键词>" --limit 5` | 任务前搜知识库（与 execute 阶段同款匹配引擎） | `--query` 必填 |
| `sillyspec knowledge inspect --id "<id>"` | 读命中条目全文 | id 形如 `patterns` / `known-issues/xxx` / `generated/xxx` |
| `sillyspec knowledge validate` | commit/archive 前校验健康度 | errors（broken_reference/empty_file 等）须先修复 |
| `sillyspec knowledge refresh` | scan/archive 后从 scan 文档刷新自动知识 | 仅写 `generated/`，不碰 manual/ |
| `sillyspec knowledge propose --title "..." --category <分类> --body "..."` | 提议新知识 | 仅写 `proposed/` 供人工审核；`--from` 标来源 |

zone 语义：`manual`（人工维护，可直接信任）/ `generated`（自动提取，需人工审核）/ `proposed`（待审，未合并）。

## Agent 使用指南

1. **任务前必查**：实现/改代码/排错前 `search` → 命中则 `inspect` → 遵循其中约定与避坑建议。
2. **发现新知识**：可复用模式或新坑用 `propose` 提议，不直接编辑 manual/。
3. **提交前校验**：commit/archive 前 `validate`，有 errors 先修复。
4. **扫描后刷新**：scan 完成后 `refresh`，`generated/` 中有用的条目待人工合并。

## 禁止事项

- ❌ 不要直接编辑 `manual/` 或 `generated/`——新知识走 `propose`，自动知识走 `refresh`
- ❌ 不要用 `grep`/`cat` 直接读知识文件——用 `search`/`inspect`（同款匹配引擎，索引语义一致）
- ❌ 不要自动审核合并 `proposed/` 条目——提议供人工审核，仅用户明确要求才合并

## 用户指令
$ARGUMENTS
