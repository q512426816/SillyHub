---
id: task-06
title: sillyhub-daemon 模块文档契约更新
priority: P2
wave: W2
depends_on: [task-01, task-03]
blocks: []
requirement_ids: []
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - .sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md
author: qinyi
created_at: 2026-06-25T15:52:00+08:00
---

# task-06: 模块文档契约更新

> 来源：plan.md Wave2 task-06。把 idle 默认禁用 + 完成驱动 end 契约写进模块文档。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | `.sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md` | idle 回收默认禁用 + 完成驱动 end 契约 |

## 实现要求

1. idle 回收契约：默认禁用，env `SESSION_IDLE_TIMEOUT_SEC>0` 逃生口
2. 完成驱动 end 契约：scan/stage lease 完成 → backend 主动 end_session（区别于用户手动 end）
3. 融入既有"注意事项"段落，不加变更索引 section（对齐 scan 重生模块文档格式）

## 验收标准

| 条件 | 预期 |
|---|---|
| 文档与实现一致 | idle 禁用 + 完成驱动 end 均有描述 |
