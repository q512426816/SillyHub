---
id: task-02
title: Extract ws._images anchored to rows in importer
title_zh: importer 提取 ws._images 按 anchor 关联数据行
author: qinyi
created_at: 2026-07-24 14:20:15
priority: P0
depends_on: [task-01]
blocks: [task-04]
requirement_ids: [FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/ppm/problem/importer.py
provides:
  - contract: ParsedProblemRow
    fields: [project_name, module_name, pro_desc, pro_type, is_urgent, func_name, duty_user_name, find_by, find_time, plan_start_time, plan_end_time, audit_user_name, work_load, work_type, pro_answer, is_delay_plan, remarks, row_index, images]
expects_from: {}
goal: >
  parse_problem_workbook 额外提取 ws._images，按 anchor._from.row 关联数据行；ParsedProblemRow 加 images: list[ImageExtracted]（{data,mime_type,anchor_row}）。
implementation:
  - "importer.py 加 ImageExtracted dataclass（data: bytes, mime_type: str, anchor_row: int）"
  - "ParsedProblemRow 加 images: list[ImageExtracted] = field(default_factory=list)"
  - parse 时遍历 ws._images，读 image.anchor._from.row 关联到该数据行（跨行图归起始行），提取 data（image._data 或 ref）+ mime_type
  - 不做 ≤3 校验（task-03/04 负责）
acceptance:
  - ParsedProblemRow 含 images
  - 嵌图 xlsx 解析出 images + 锚点行正确
verify:
  - cd backend && uv run pytest app/modules/ppm/problem/tests/test_importer.py -q
  - cd backend && uv run ruff check app/modules/ppm/problem/importer.py && uv run mypy app/modules/ppm/problem/importer.py
constraints:
  - 依赖 task-01 Pillow（读 ws._images 需 PIL）
  - 纯解析不碰 DB；不改现有字段解析
---

# TaskCard — task-02：importer 提取 ws._images

## 现状基线（importer.py L1-407，commit c1d26a00）

- `ParsedProblemRow`（`@dataclass(slots=True)`，17 业务字段 + `row_index`）位于 L36-65。
- `_parse_sheet(ws)` L273-380：按「项目名称」表头定位列、合并 forward-fill、跳全空行、逐行产 ParsedProblemRow（`row_index` = 1-based 原始行号）。
- `parse_problem_workbook` L383-407：`load_workbook(data_only=True)`、多 Sheet 拼接、`finally wb.close()`。

本任务仅**扩展**：不动表头定位、合并索引、日期/枚举规范化、全空行跳过逻辑。

## 实现要点

1. **新增 `ImageExtracted`**（dataclass，置 `ParsedProblemRow` 之前）：`data: bytes`、`mime_type: str`、`anchor_row: int`（1-based，与 `row_index` 同基准）。
2. **`ParsedProblemRow` 加 `images`**：`images: list[ImageExtracted] = field(default_factory=list)`，放 `row_index` 之后（末位带默认值，slots=True 兼容，无需重排既有字段）；`from dataclasses import dataclass, field`。
3. **遍历 `ws._images`**（openpyxl 私有属性，task-01 spike 已验 PIL 可用）。每图取 `image.anchor._from.row`——**该值 0-based**，需 `+1` 对齐 1-based 行号；跨行/浮动图统一归 `_from.row` 起始行（不读 `_to.row`）。
4. **图数据读取**：按 openpyxl 实际接口（`image._data()` 返回 bytes，或 `image.ref`/`image.path` 读 zip 内 blob）；`mime_type` 从 `image.format`/扩展名映射（png/jpeg/gif/webp，与 file 模块 validate_upload 白名单对齐）。execute 时核实际接口，必要时 try/except 兜底。
5. **关联挂载**：建议 `_extract_row_images(ws) -> dict[int, list[ImageExtracted]]`（key=1-based anchor_row）；`_parse_sheet` 产 ParsedProblemRow 时按 `row_index` 查 dict 挂 `images`。anchor 落表头/空行/无对应数据行 → **丢弃**（不挂相邻行，避免错配）。
6. **多 Sheet**：每 Sheet 独立提取再拼接，不跨 Sheet。

## 不做（边界）

- 不做 ≤3 张校验（task-03 schema + task-04 service 负责）。
- 不做格式/大小校验（task-04 commit 时 upload_file.validate_upload 负责）。
- 不碰 DB / service / router，不改 17 字段解析与 `__all__` 既有导出（`ImageExtracted` 加入 `__all__`）。

## 测试要点（task-06 落 test_importer）

- 嵌图 xlsx：`ws.add_image(Image(BytesIO(png)), "C2")` → 断言解析出 `images`，`anchor_row==2`、`data==原 bytes`、`mime_type` 正确。
- 跨行图（C2→C3）归 `row_index==2`。
- 多图同行 → `images` 列表顺序稳定。
- 无图 xlsx → `images == []`（零回归，兼容原导入）。

## 依据

design §5 Wave1.1 / §7 ImageExtracted 定义 / §10 R-01（锚点风险）/ §11 D-001@v1 + D-008@v1（Pillow）；plan task-02 + 覆盖矩阵 FR-02/D-001；importer.py L1-22 模块契约（纯解析、无副作用、同步 def 交 service anyio.to_thread 包裹）。
