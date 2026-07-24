---
id: task-06
title: Backend tests test_importer.py + test_import_flow.py
title_zh: 后端测试 新增 test_importer.py + test_import_flow.py
author: qinyi
created_at: 2026-07-24 09:51:47
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05]
blocks: []
requirement_ids: [FR-02, FR-03, FR-04, FR-05, FR-06, FR-09, FR-10, FR-11]
decision_ids: [D-004@v1, D-008@v1, D-009@v1, D-011@v1]
allowed_paths:
  - backend/app/modules/ppm/problem/tests/test_importer.py
  - backend/app/modules/ppm/problem/tests/test_import_flow.py
provides: []
expects_from: {}
goal: >
  覆盖 importer 解析与导入端点：表头容错/合并填充/日期/枚举、未匹配标红、
  必填缺失、原子性、防篡改、权限。
implementation:
  - test_importer.py：构造 xlsx bytes（openpyxl Workbook 序列化），断言按表头文字定位列、合并单元格 forward-fill、日期序列号转 date、is_urgent 是/否→1/0、跳全空行
  - test_import_flow.py：client 调 import-preview/import-commit；用例含 未匹配项目名/责任人/模块→valid=false标红、pro_desc 空→valid=false、正常行入库 created、原子性(构造DB异常→整批回滚)、commit 重查防篡改(前端伪造project_id无效)、无权限403
acceptance:
  - test_importer.py 覆盖解析各分支
  - test_import_flow.py 覆盖标红/必填/原子/防篡改/权限
  - 全部通过
verify:
  - cd backend && uv run pytest app/modules/ppm/problem/tests/test_importer.py app/modules/ppm/problem/tests/test_import_flow.py -q
constraints:
  - problem/tests/ 无 test_router.py，两个文件均新建
  - 不改现有 problem 测试
---

# TaskCard — 后端测试 test_importer.py + test_import_flow.py

## 依据

- design.md §5 Wave1 step6（本任务条目「后端测试」）、§10 R-02（严格校验误杀→预览标红+error 文案）、§10 R-07（原子提交单行异常→整批回滚）、§10 R-05（verify PPM 前端关联 ppm 后端超时→`SILLYSPEC_TEST_TIMEOUT_MS=900000` 重跑，属变更级 verify 注意点）、§12 全局验收（严格校验/原子/防篡改/权限/字段映射）
- decisions D-004@v1（严格匹配标红）、D-008@v1（原子单次 commit）、D-009@v1（必填=项目名+pro_desc）、D-011@v1（commit 重查防篡改+data_scope）
- plan.md task-06（本任务）+ 任务总表（task-06 依赖 task-01~05）+ 全局验收标准 + 覆盖矩阵（D-004/D-008/D-009/D-011、FR-03~06/09/10/11 的验收证据落 task-06）
- 参考源：`backend/app/modules/ppm/plan/tests/test_importer.py`（openpyxl+BytesIO 构造 xlsx 的 9 类解析用例范式）、`backend/app/modules/ppm/plan/tests/test_router.py`（import-preview/import-commit 端点集成测试 + 原子回滚 monkeypatch + 未匹配行跳过）、`problem/tests/test_problem_flow.py`（problem 子域 db_session fixture 风格 + 路由透传用例）、`problem/tests/conftest.py`（已注册 problem+project 模型到 BaseModel.metadata）

## 两文件分工

- `test_importer.py`：纯解析单测，**不碰 DB/不反查**，直测 `parse_problem_workbook(file_bytes)`；fixture 用 openpyxl `Workbook()` + `BytesIO` 在测试内程序构造 xlsx bytes（不落盘、不依赖模板路径）。
- `test_import_flow.py`：端点集成测试，用根 conftest 的 `client`（platform_admin 全权限）+ `auth_headers` + `db_session`（三者共享同一 in-memory SQLite engine），经 httpx 走 `POST /api/ppm/problem-list/import-preview` 与 `/import-commit`。

## test_importer.py 用例（对齐 plan/tests/test_importer.py 9 类骨架，裁剪 problem 单 Sheet 单层表头）

1. 正常行：17 列中文表头 + 1 数据行 → 各字段映射正确（project_name/module_name/pro_desc/pro_type/duty_user_name…）。
2. 表头列顺序打乱 → 仍按表头文字定位（R-04），非硬编码列号。
3. 合并单元格（如项目名称合并两行）→ forward-fill 到空格行。
4. Excel 日期序列号（如 46149）→ `date`，文本日期（`2026-05-07`/`2026/05/08`）也兼容。
5. `is_urgent`/`is_delay_plan`「是」→`"1"`、「否」→`"0"`、空→`None`；`pro_type`（bug/change/其他）原样保留。
6. 全空行 → 跳过（不计入结果）。

## test_import_flow.py 用例（对齐 plan/tests/test_router.py 原子/未匹配范式）

1. 未匹配标红（D-004）：DB 无该项目名/责任人/模块名 → preview 行 `valid=false`、`error` 有文案、`invalid_count` 计数（R-02）。
2. 必填缺失（D-009）：`pro_desc` 空 → `valid=false`。
3. 正常行入库：preview 全 valid → commit 返回 `created>=1`，`db_session` 直查 `PpmProblemList` 落库（status="新建"、created_by、model_name=module_name 原文、date→datetime）。
4. 原子性（D-008/R-07）：`monkeypatch.setattr(ProblemService, "<入库 helper>", _boom)` 注入异常 → httpx ASGITransport 异常冒泡 + DB 无脏数据（断言 0 条）。
5. 防篡改（D-011）：commit body 前端伪造 `project_id`（DB 不存在的 UUID）→ service 按原文重查/data_scope 校验失败 → 该行进 `failed_rows`，不入库。
6. 权限（FR-11）：无 `auth_headers` → 403（沿用 problem 创建权限）。

## 复用与约束

- fixture 全部用根 conftest（`client`/`auth_headers`/`db_session`/`db_engine`）+ `problem/tests/conftest.py` 的模型注册，不新增 conftest。
- 造数据 helper 可仿 `test_problem_flow.py:_make_project` 建项目+成员；仿 `test_router.py` 的 `_build_workbook`/`_preview_row_dict`/`_commit_body` 构造 xlsx 与 commit body。
- 不改 `test_problem_flow.py`/`test_schema.py`/`test_list_by_date_range.py`（constraint）；`problem/tests/` 无 `test_router.py`，故端点用例落 `test_import_flow.py` 不补 test_router。
- 断言不绑死 SQL 方言函数名；落库查询用独立 session 避免长生命周期 db_session 复用陈旧对象（对齐 `test_router_execute_problem_passes_file_urls`）。
