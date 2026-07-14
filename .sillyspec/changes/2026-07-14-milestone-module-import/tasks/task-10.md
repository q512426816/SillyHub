---
id: task-10
title: importer 解析单测
title_zh: Excel 解析单元测试
author: WhaleFall
created_at: 2026-07-14 19:24:33
priority: P1
depends_on: [task-03]
blocks: []
requirement_ids: [FR-003]
decision_ids: []
allowed_paths:
  - backend/app/modules/ppm/plan/tests/test_importer.py
  - backend/app/modules/ppm/plan/tests/fixtures/

goal: >
  为 importer.parse_workbook 编写单测，覆盖两类 Sheet 解析、合并单元格填充、日期序列号转换、
  多人责任人、空行、表头列位变体、非数字工作量防御。
implementation: |
  - 用 openpyxl 在测试内构造 xlsx fixtures（写 tests/fixtures/ 或 tmp_path），不依赖桌面参考路径
  - 用例① 正常计划 Sheet（含「计划类型」列）解析正确，plan_type="正常计划"
  - 用例② 临时插单 Sheet（无「计划类型」列）解析正确，plan_type="临时计划"
  - 用例③ 序号/平台合并单元格 → 读 merged_cells.ranges 向下填充（R-04）
  - 用例④ Excel 日期序列号（如 46149）经 from_excel 正确转 date（R-08）
  - 用例⑤ 多人责任人（顿号分隔）取首个，原文保留（R-09）
  - 用例⑥ 全空行跳过
  - 用例⑦ 表头列位变体（列顺序打乱）仍按表头文字定位列（R-02）
  - 用例⑧ 非数字工作量（如 "\\"）不崩，视为 0/None
  - 用例⑨ 周历表等非数据 Sheet 忽略
acceptance: |
  - 上述 9 类用例全部通过
  - fixtures 自造，不依赖外部桌面路径
verify: |
  - cd backend && .venv/Scripts/python.exe -m pytest app/modules/ppm/plan/tests/test_importer.py -q
constraints: |
  - 只测 parse_workbook 纯解析，不涉及 DB / 责任人反查（反查在 service.import_preview）
  - 按 design §5 解析规则、§10 R-02/R-04/R-08/R-09 处置；复用 tests/ 风格（asyncio_mode=auto，class 分组，模块 docstring 注明覆盖）
  - fixtures 用 openpyxl 程序生成或提交小型 .xlsx
  - 遵循 pyproject per-file-ignores：tests/* 放宽 N802/N803/N806/E402/B017
---
