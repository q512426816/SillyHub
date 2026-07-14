---
id: task-06
title: service.import_commit 原子入库
title_zh: 导入提交服务（分组/合并/汇总/原子事务）
author: WhaleFall
created_at: 2026-07-14 19:24:33
priority: P0
depends_on: [task-04]
blocks: [task-07, task-11]
requirement_ids: [FR-001, FR-006, FR-007, FR-009, FR-010]
decision_ids: [D-001@v1, D-004@v1, D-005@v1, D-008@v1]
allowed_paths:
  - backend/app/modules/ppm/plan/service.py
expects_from:
  task-04:
    - contract: ImportCommitReq
      needs: [sheets]
    - contract: ImportCommitSheet
      needs: [name, plan_type, rows]
    - contract: ImportPreviewRow
      needs: [module_name, detailed_stage, task_theme, task_description, plan_workload, duty_user_id, duty_matched, plan_begin_time, plan_complete_time]
    - contract: ImportResultResp
      needs: [created_modules, merged_modules, created_details, skipped_rows, failed_rows]

provides:
  - contract: import_commit
    fields: [ImportResultResp]

goal: >
  实现导入提交：按平台/子系统分组，模块新建或同名合并，模块层自动汇总（min/max/求和/首个），
  明细逐行创建 status=draft，全部用 session.add + 末尾单次 commit 原子提交
  （不复用 _Crud.create，D-008）。依据 design.md §7.3、§8、§10 R-07。

implementation: |
  - "PlanService 新增 async import_commit(self, req: ImportCommitReq, plan_node_id: str) -> ImportResultResp"
  - "不复用 _Crud.create / create_module / create_detail（其逐条 commit 破坏原子性，service.py L139-145、L369）；改 session.add() + 末尾单次 commit()（D-008@v1）"
  - "遍历 req.sheets（每 sheet.rows）→ 按 module_name（平台/子系统，空名归到一个 None 组或跳过）分组，组内保留行顺序"
  - "每组：查 plan_node_id + module_name 是否已有 PlanNodeModule（select where plan_node_id==safe_uuid(plan_node_id) and module_name==?）→ 命中则合并复用其 id（merged_modules++），未命中则 new PlanNodeModule(id, plan_node_id, module_name, plan_type, ...汇总)（created_modules++）"
  - "模块汇总（D-005@v1 / design §7.3 C1-C2）：
    plan_begin_time = 组内非空「开始」min（全空→NULL）；
    plan_complete_time = 组内非空「结束」max（全空→NULL）；
    plan_workload = 组内工作量经 _to_decimal 求和，非数字/空→按 0 累加（不致该行失败），全组无有效数字→NULL；
    duty_user_id = 组内首个 duty_matched=True 行的 duty_user_id"
  - "每行建 PsPlanNodeDetail(id, plan_node_id=safe_uuid(plan_node_id), module_id=组模块id, detailed_stage, task_theme, task_description, plan_workload(原样str), plan_begin_time, plan_complete_time, execute_user_id=duty_user_id, status=\"draft\")，created_details++"
  - "所有对象 session.add() → 末尾 await self._session.commit()（仿 service.py change_process L647-649 模式）；任一异常 → await self._session.rollback()，记录 failed_rows 行描述后继续或整体抛出（按可测定义，单事务整体回滚）"
  - "skipped_rows：preview 阶段 valid=False 的行已被前端剔除，若 commit 仍收到则计入 skipped_rows 不入库"

acceptance: |
  - "同名模块（plan_node_id + module_name）追加明细，不重复建模块（merged_modules 正确，D-004）"
  - "模块汇总值正确：开始取 min / 结束取 max；工作量非数字按 0 参与求和，全组无有效数字为 NULL（C1/C2 可测定义）"
  - "明细 status=\"draft\" 固定，不触发状态机；module_id 正确关联所属模块（Grill X-010）"
  - "中途任一异常整体回滚，无脏数据（D-008 / R-07）"
  - "返回 ImportResultResp(created_modules, merged_modules, created_details, skipped_rows, failed_rows) 字段齐全"

verify: |
  - "cd backend && .venv/Scripts/python.exe -m pytest app/modules/ppm/plan/tests/test_router.py -k import_commit -q"

constraints: |
  - "禁止复用 _Crud.create / create_module / create_detail（D-008 硬约束）"
  - "单事务，末尾一次 commit；异常 rollback"
  - "明细固定 status=\"draft\"，不触发状态机（与 ql-20260713-010「提交=done」语义区隔）"
  - "工作量求和用 _to_decimal（service.py L82-93）防御非数字/空串；日期/UUID 用 _safe_uuid（L813-827）容错"
  - "plan_node_id 经 self._safe_uuid 转 UUID 后查询（仿 list_modules_by_node L261-267）"
---
