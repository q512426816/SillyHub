---
id: task-03
title: Add attachment_count/exceeded to ProblemImportPreviewRow
title_zh: schema PreviewRow 加 attachment_count/attachment_exceeded
author: qinyi
created_at: 2026-07-24 14:20:30
priority: P0
depends_on: []
blocks: [task-04]
requirement_ids: [FR-03]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/ppm/problem/schema.py
provides:
  - contract: ProblemImportPreviewRow
    fields: [attachment_count, attachment_exceeded]
expects_from: {}
goal: >
  ProblemImportPreviewRow 加 attachment_count: int（附件图片数）+ attachment_exceeded: bool（>3）。
implementation:
  - "schema.py ProblemImportPreviewRow 加 attachment_count: int = 0 + attachment_exceeded: bool = False"
  - 不改其他 DTO 字段
acceptance:
  - PreviewRow 含 attachment_count/attachment_exceeded
verify:
  - cd backend && uv run ruff check app/modules/ppm/problem/schema.py && uv run mypy app/modules/ppm/problem/schema.py
constraints:
  - 字段名用全称 attachment_exceeded（plan 统一）
  - 不改现有 PreviewRow 24 字段
---

# task-03 — schema PreviewRow 加 attachment_count/attachment_exceeded

## 背景
design §5 Wave1.2 + §7 + 决策 D-005：导入预览需展示每行附件图片数，>3 张超额标红。
本任务只动 schema，为 task-04（service 填充/校验）与 task-08（前端预览附件列）提供契约。

## 现状
`backend/app/modules/ppm/problem/schema.py` ProblemImportPreviewRow 现有 24 字段
（row_index + 17 业务 + 4 反查 UUID + valid + error）。本任务在末尾追加 2 字段，不改其余。

## 改动（仅 schema.py）
1. ProblemImportPreviewRow 追加：
   - `attachment_count: int = 0`        # 该行附件图片数
   - `attachment_exceeded: bool = False` # 超过 3 张标记（D-005）
2. 字段位置：放在 `error` 之后，保持「业务 → 反查 UUID → valid/error → 附件计数」分组连贯。
3. 默认值 0/False 保证向后兼容：无附件行（原导入路径）序列化不破。

## 不做
- 不改 ProblemImportPreviewResp / CommitReq / ResultResp。
- 不在 schema 里写 ≤3 校验逻辑（判断在 service.import_preview，task-04）。
- 不动其他 DTO、不改 `__all__` 导出顺序（PreviewRow 已在其中）。

## 验收
- ruff + mypy 通过（verify 命令）。
- PreviewRow 实例化 `attachment_count`/`attachment_exceeded` 可用，默认 0/False。
- 现有 24 字段名/类型/顺序不变。

## 依赖与阻塞
- depends_on: []（可与 task-02 并行，关键路径上独立）。
- blocks: [task-04]（service 填充这两字段）。
