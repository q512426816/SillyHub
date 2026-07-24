---
id: task-05
title: Add import_preview/import_commit to problem/service.py
title_zh: problem/service.py 增 import_preview(反查+严格校验) + import_commit(重查+date转换+字段映射+原子单次事务)
author: qinyi
created_at: 2026-07-24 09:51:30
priority: P0
depends_on: [task-02, task-03]
blocks: [task-06]
requirement_ids: [FR-03, FR-04, FR-05, FR-06, FR-07, FR-08, FR-09, FR-10]
decision_ids: [D-002@v1, D-004@v1, D-005@v1, D-006@v1, D-007@v1, D-008@v1, D-009@v1, D-010@v1, D-011@v1, D-012@v1, D-014@v1]
allowed_paths:
  - backend/app/modules/ppm/problem/service.py
provides: []
expects_from:
  task-02:
    - contract: ParsedProblemRow
      needs: [project_name, module_name, pro_desc, pro_type, is_urgent, func_name, duty_user_name, find_by, find_time, plan_start_time, plan_end_time, audit_user_name, work_load, work_type, pro_answer, is_delay_plan, remarks, row_index]
  task-03:
    - contract: ProblemImportPreviewRow
      needs: [valid, error, project_id, module_id, duty_user_id, audit_user_id]
    - contract: ProblemImportPreviewResp
      needs: [rows, parse_errors, valid_count, invalid_count]
    - contract: ProblemImportCommitReq
      needs: [rows]
    - contract: ProblemImportResultResp
      needs: [created, skipped, failed_rows]
goal: >
  实现导入核心：preview 批量反查+严格校验+标红；commit 不信任前端UUID重查+date转换+
  字段映射+原子单次事务入库。
implementation:
  - import_preview(file_bytes,user)：anyio.to_thread 包 parse_problem_workbook；批量反查（project=PpmProjectMaintenance.project_name→id；module=复用 PlanService.list_modules_by_project(project_id) 范围内按 module_name 取 PlanNodeModule.id；duty/audit=该项目 PpmProjectMember 按姓名→user_id，对齐 plan _resolve_duty_user 范式）；逐行严格校验（project_name 必填且须匹配 D-009，未匹配→valid=false；module/duty/audit 填了须匹配 D-004，project 匹配失败即短路不再查 module D-004×D-006）；填 valid/error/反查UUID；date→datetime 构建 PreviewRow(D-010，preview 也要转)
  - import_commit(req,user)：不信任前端回传UUID，按原文重新反查+data_scope 校验 project 可访问(D-011)；重算失败行剔除计 failed_rows；date→datetime；显式字段映射 module_name→ORM.model_name + module_id(D-012)，不用 **dict；status="新建"/created_by=user.id/file_urls=[](D-007)；session.add_all+单次 commit 原子(D-008，不逐行 _Crud.create)；不查重(D-005)
acceptance:
  - import_preview 返回 PreviewResp，未匹配/必填缺失行 valid=false+error
  - import_commit 单次事务原子，全成或全回滚
  - 前端篡改 UUID 无效（commit 重查）
  - module_name 入库为 model_name，date 正确转 datetime
  - duty/audit 反查限该项目成员
verify:
  - cd backend && uv run pytest app/modules/ppm/problem/tests/test_import_flow.py -q
  - cd backend && uv run ruff check app/modules/ppm/problem/service.py && uv run mypy app/modules/ppm/problem/service.py
constraints:
  - 不改现有 create_problem/_backfill_names/_Crud
  - 复用 list_modules_by_project 与 data_scope，不自己拼 module SQL
  - 反查字段名用 project_name 非 .name（D-002 修正）
  - 不查重；原子单次 commit
---

# task-05 — problem/service.py 增 import_preview / import_commit

> 依据：design.md §5 Wave1 step5、§7（DTO/字段映射表/`import_preview`/`import_commit` 签名）、§10 R-01/R-06/R-07、§11 D-002/D-004~D-012/D-014；
> plan.md task-05（本任务）+ 关键路径 task-02 → **task-05** → task-06；
> decisions.md D-002@v1（`project_name` 反查）/D-004（严格匹配）/D-005（不查重）/D-006（反查源）/D-007（系统字段）/D-008（原子单次 commit）/D-009（必填=项目名+问题描述）/D-010（date→datetime）/D-011（commit 重查防篡改）/D-012（module_name→model_name+module_id）/D-014（duty/audit 限项目成员）。

## 复用范式（对照源码，不改这些文件）

- **原子单次 commit**：`plan/service.py:1617-1723` `PlanService.import_commit` —— `session.add(...)` 批量挂对象 + 末尾**单次** `await self._session.commit()`，**不复用** `_Crud.create`（其每次单独 commit 破坏原子性，见 problem/service.py:163-169）。异常冒泡不 commit 即整体回滚（R-07）。
- **解析线程化**：`plan/service.py:1490` `await anyio.to_thread.run_sync(parse_workbook, file_bytes)` —— 同步 openpyxl 丢线程池，不阻塞事件循环（R-03）。
- **姓名反查范式（即 _resolve_duty_user）**：`plan/service.py:1514-1533` `PlanService._build_member_name_map` —— 查 `PpmProjectMember`(where `pm_project_id`) 全量，建 `{user_name: user_id}` 反查表，`user_name` 为空者不进表。problem 复用此范式分别建 duty/audit 两张表（D-014：限该项目成员）。
- **模块反查**：`plan/service.py:393-409` `PlanService.list_modules_by_project(project_id)` —— 关联链 project→ps_project_plan→ps_plan_node→plan_node_module 已自洽（R-01，grill X-010 核验），**直接复用不在 problem 自拼 SQL**；在其返回的 `PlanNodeModule` 列表里按 `module_name` 取 `.id`。
- **date→datetime**：`plan/service.py:161-170` `_date_to_datetime(value)` —— `datetime.combine(value, time.min, tzinfo=UTC)`；preview 与 commit **两段都要转**（D-010，DTO 时间字段为 `datetime|None`）。
- **现有可复用**：本文件已有 `_safe_uuid`(L129)、`_now`(L116)、`_Crud`(L150)、`PpmProjectMaintenance`/`PpmProjectMember` import(L67)、`data_scope` 的 `manager_project_ids`/`is_super_admin`(L41-47)；`create_problem` 默认 `status=ProblemStatus.NEW.value`(L305) 与 `created_by`(L306-307) 写法即 D-007 系统字段赋值参考。

## import_preview 关键步骤

1. `rows_parsed = await anyio.to_thread.run_sync(parse_problem_workbook, file_bytes)`（task-02 契约）。
2. 逐行反查 + 严格校验（**短路**：project 未匹配即 `valid=False`，不再查 module/duty/audit，D-004×D-006）：
   - **project**：`select(PpmProjectMaintenance.id).where(PpmProjectMaintenance.project_name == row.project_name)`（D-002，字段名 `project_name` 非 `.name`）；建议先一次性 `select(project_name, id)` 全量建 `{name: id}` 表避免 N+1。`project_name` 空/未匹配 → `valid=False, error="项目名未匹配"`（D-009 必填维度）。
   - **module**：命中 project 后调 `PlanService(self._session).list_modules_by_project(project_id)`，在返回列表按 `module_name` 取 id；填了 `module_name` 但未命中 → `valid=False`（D-004）。
   - **duty/audit**：命中 project 后建该项目成员 `{user_name: user_id}` 表（_build_member_name_map 范式）；填了姓名未命中 → `valid=False`（D-004×D-014）。**不拆分多人**（problem 单责任人，与 plan 多人拆分不同）。
   - **pro_desc 必填**：空 → `valid=False`（D-009）。
3. 时间三列经 `_date_to_datetime` 转换后填入 `ProblemImportPreviewRow`（D-010）；填反查到的 `project_id`/`module_id`/`duty_user_id`/`audit_user_id`（仅供前端展示，commit 不信）。
4. 组装 `ProblemImportPreviewResp(rows=..., parse_errors=[], valid_count=N, invalid_count=M)`。

## import_commit 关键步骤（D-008/D-011/D-012）

1. **重查防篡改**：遍历 `req.rows`，**按原文（project_name/module_name/duty_user_name/audit_user_name）重新反查**，忽略前端回传 UUID（D-011/R-06）；重查失败的行剔除不入库，诊断文案入 `failed_rows: list[str]`。
2. **data_scope 校验**：重查到的 `project_id` 须在 `manager_project_ids(session,user)` 集合内，或 `is_super_admin`，否则该行计入 `failed_rows`（D-011 防越权导入他人项目）。
3. **显式字段映射（D-012，不用 `**dict`）**：每行 `PpmProblemList(id=uuid.uuid4(), project_id=..., project_name=row.project_name, model_name=row.module_name, module_id=..., pro_desc=..., pro_type=..., is_urgent=row.is_urgent, func_name=..., duty_user_id=..., duty_user_name=row.duty_user_name, audit_user_id=..., audit_user_name=row.audit_user_name, find_by=..., find_time=_date_to_datetime(...), plan_start_time=_date_to_datetime(...), plan_end_time=_date_to_datetime(...), work_load=..., work_type=..., pro_answer=..., is_delay_plan=row.is_delay_plan, remarks=..., status=ProblemStatus.NEW.value, created_by=user.id, file_urls=[], created_at=_now(), updated_at=_now())`。
4. `self._session.add_all(objs)` + 末尾**单次** `await self._session.commit()`（D-008）；异常冒泡 → 不 commit → 整体回滚。
5. 返回 `ProblemImportResultResp(created=len(objs), skipped=<preview invalid 未回传数, 前端统计可置 0>, failed_rows=[...])`；**不查重**（D-005）。

## 边界 / 不做

- 不改 `create_problem` / `_backfill_names` / `_Crud` / 导出 / 3 态执行流（constraints）。
- 不在本任务写测试（归 task-06 `test_import_flow.py`）；本任务仅落 `problem/service.py` 两方法 + 私有反查/转换 helper。
- 不自拼 module 反查 SQL（复用 `list_modules_by_project`，R-01）；不引 plan 私有 `_validate_upload`（上传校验归 task-01/04）。
- 责任人**不拆分多人**（problem `duty_user_name` 单值语义，区别于 plan 的顿号拆分）。
