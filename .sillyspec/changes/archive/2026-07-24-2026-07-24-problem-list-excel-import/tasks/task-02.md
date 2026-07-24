---
id: task-02
title: Add problem/importer.py pure Excel parser
title_zh: 新增 problem/importer.py 纯解析 + 枚举规范化
author: qinyi
created_at: 2026-07-24 09:49:23
priority: P0
depends_on: []
blocks: [task-05]
requirement_ids: [FR-02]
decision_ids: [D-001@v1, D-003@v1, D-007@v1]
allowed_paths:
  - backend/app/modules/ppm/problem/importer.py
provides:
  - contract: ParsedProblemRow
    fields: [project_name, module_name, pro_desc, pro_type, is_urgent, func_name, duty_user_name, find_by, find_time, plan_start_time, plan_end_time, audit_user_name, work_load, work_type, pro_answer, is_delay_plan, remarks, row_index]
expects_from: {}
goal: >
  纯解析 .xlsx 为 ParsedProblemRow（不碰 DB/不反查），复用 plan importer 套路，
  并在解析层把 is_urgent/is_delay_plan 的「是/否」规范化为「1/0」。
implementation:
  - 新增 backend/app/modules/ppm/problem/importer.py，定义 ParsedProblemRow dataclass（含上述 18 字段）
  - 实现 parse_problem_workbook(file_bytes)->list[ParsedProblemRow]（同步 def，调用方 anyio.to_thread 包裹）
  - 按表头文字定位列（normalize 去空白换行）、合并单元格 forward-fill、Excel 日期序列号→date、跳过全空行
  - 枚举规范化：is_urgent/is_delay_plan「是」→"1"、「否」→"0"、空→None；pro_type 原样保留
acceptance:
  - parse_problem_workbook 返回 ParsedProblemRow 列表
  - 表头列顺序变化仍正确定位（按文字）
  - 合并单元格向下填充正确
  - Excel 日期序列号转 date 正确
  - is_urgent「是」→"1"
verify:
  - cd backend && uv run pytest app/modules/ppm/problem/tests/test_importer.py -q
  - cd backend && uv run ruff check app/modules/ppm/problem/importer.py
constraints:
  - 纯解析，不 import DB session/ORM，不做姓名反查
  - 不改 plan/importer.py
---

# TaskCard — problem/importer.py 纯解析

## 依据

- design.md §5 Wave1 step2（本任务条目）、§7 importer/ParsedProblemRow（dataclass 18 字段定义 + `parse_problem_workbook` 签名）
- design.md §11 决策：D-001@v1（后端解析+两步式范式）、D-003@v1（全 17 业务字段）、D-007@v1（系统字段不导入、status/created_by 由 service 赋；此层只产原值）
- plan.md task-02（本任务）+ 任务总表/关键路径（task-02 → task-05 → task-06）
- 参考源：`backend/app/modules/ppm/plan/importer.py`（完整复用其范式，不改该文件）

## 复用范式（对照 plan/importer.py）

直接照搬下列助手函数到 problem 命名空间，仅调整列名常量与产出结构：

- `_normalize_header` / `_normalize_cell`：去空白换行/strip，空→None（R-02/R-04 列顺序容错）
- `_to_date`：Excel 序列号（`openpyxl.utils.datetime.from_excel`）+ datetime/date + 文本日期（R-08）
- `_build_merged_index` + `_cell_text`：合并单元格 forward-fill（R-04）
- `parse_workbook` 的骨架：`load_workbook(BytesIO, data_only=True)` → 遍历 Sheet → finally `wb.close()`
- 同步 `def` + 文件头注释声明「调用方 anyio.to_thread.run_sync 包裹」（R-03，对齐 plan）

差异点：单 Sheet、单层表头（problem 模板无 plan 那种两行主/子表头），不需要 plan 的 `_find_header_row`/`_detect_plan_type`/`ParsedSheet`，直接产扁平 `ParsedProblemRow` 列表。

## 字段（ParsedProblemRow，18 个，顺序对齐 design §7）

`project_name` `module_name` `pro_desc` `pro_type` `is_urgent` `func_name`
`duty_user_name` `find_by` `find_time` `plan_start_time` `plan_end_time`
`audit_user_name` `work_load` `work_type` `pro_answer` `is_delay_plan`
`remarks` `row_index`（1-based 原始行号）

注：`module_name` 在本层原文保留；`module_name→model_name` 映射是 task-05 的事（D-012），本层不做。

## 关键步骤

1. 定义表头常量（如「项目名称」「模块」「问题描述」「问题类型」「是否紧急」…），normalize 后匹配列号，不硬编码列位置。
2. 数据行循环：合并填充读单元格 → 跳过全空行 → 组装 `ParsedProblemRow`。
3. 枚举规范化：`is_urgent`/`is_delay_plan` 经 `_normalize_cell` 后，「是」→`"1"`、「否」→`"0"`、空→`None`；`pro_type`（bug/change/其他）原样保留。
4. 日期三列（`find_time`/`plan_start_time`/`plan_end_time`）统一 `_to_date` 转 `date`；`datetime` 转换是 task-05（D-010）。

## 边界

- 不 import DB session / ORM / service / schema（task-05 才反查入库）。
- 不做姓名/项目/模块反查（D-006/D-014 属 task-05）。
- 不改 `plan/importer.py`（constraint）。
- 单测在 task-06 补 `test_importer.py`；本任务先把函数落到 `allowed_paths` 内单文件。
