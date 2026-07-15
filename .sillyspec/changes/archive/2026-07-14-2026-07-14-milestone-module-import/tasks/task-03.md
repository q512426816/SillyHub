---
id: task-03
title: python-multipart 依赖 + importer.py Excel 解析模块
title_zh: Excel 解析模块（按表头名匹配列）
author: WhaleFall
created_at: 2026-07-14 19:24:33
priority: P0
depends_on: [task-01]
blocks: [task-05, task-10]
requirement_ids: [FR-003]
decision_ids: [D-007@v1]
allowed_paths:
  - backend/pyproject.toml
  - backend/app/modules/ppm/plan/importer.py
provides:
  - contract: parse_workbook
    fields: [sheets, rows, module_name, detailed_stage, task_theme, task_description, plan_workload, duty_user_name, plan_begin_time, plan_complete_time]

goal: >
  新建后端 Excel 解析模块，用 openpyxl 按表头文字定位列（非列号），处理合并单元格向下填充、Excel 日期序列号转换，识别正常/临时两类 Sheet，输出结构化预览行；并补 python-multipart 依赖。
implementation: |
  - pyproject.toml dependencies 加 "python-multipart>=0.0.9"
  - 新建 importer.py，定义 parse_workbook(file_bytes: bytes) -> list[解析后的 sheet 结构]：load_workbook(data_only=True)
  - Sheet 识别：表头行（前 5 行内找）含「计划类型」列→正常计划(plan_type="正常计划")；无「计划类型」但有「任务分类+平台/子系统」→临时插单(plan_type="临时计划")；其余（如周历表）忽略
  - 按表头文字定位列号（trim、忽略换行符 \n，容错）；两类 Sheet 列位不同（正常：平台在计划类型后；临时：无计划类型列）——分别按表头定位
  - 序号/平台/子系统合并单元格：读 ws.merged_cells.ranges，对合并区域向下填充
  - 日期用 openpyxl.utils.datetime.from_excel 转换（兼容序列号与文本日期）
  - 跳过全空行；忽略周次/状态/执行情况/备注列
  - parse_workbook 为同步 def（供 anyio.to_thread 调用，X-002）
acceptance: |
  - python-multipart 写入 pyproject.toml
  - parse_workbook 对参考 xlsx（正常+临时 Sheet）正确识别、列定位准确、合并单元格填充正确、日期转换正确
  - 非数据 Sheet（周历表）被忽略
verify: |
  - cd backend && .venv/Scripts/python.exe -m pip install -e '.[dev]'
  - cd backend && .venv/Scripts/python.exe -m pytest app/modules/ppm/plan/tests/test_importer.py -q
constraints: |
  - 按表头文字匹配列，不硬编码列号（D-007）
  - parse_workbook 纯解析，不做责任人反查（反查在 task-05 service 层）
  - 不读写 DB
  - 兼容 Windows/Linux/macOS
---
