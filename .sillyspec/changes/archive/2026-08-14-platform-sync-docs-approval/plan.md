---
author: qinyi
created_at: 2026-08-14 21:45:00
plan_level: light
---

# 实现计划（Plan）— platform_sync 契约缺口端点

依据 design.md（review_round:1，Grill pass）+ requirements.md FR-01~09 + decisions.md D-001~004@v1。plan_level=light：7 task / 2 Wave，集中 platform_sync 单模块。

## Wave 1：数据层 + 服务层（后端核心，顺序依赖）

- [x] task-01: 数据模型 + migration【FR-07】
  - `model.py`：PlatformChangeProgressORM 加 `documents: dict|None` / `approval: dict|None` 两 JSON nullable 列（sa_column=Column(JSON, nullable=True)）。
  - 新 alembic revision：`batch_alter_table('platform_change_progress')` add_column ×2；先 `alembic heads` 确认单 head（Grill 实测 20260814090000），撞则改时间戳收敛（fix-platform-progress-pk 先例）。
  - 验收：`alembic upgrade head` 成功 + `alembic heads` 单 head。
  - allowed_paths: backend/app/modules/platform_sync/model.py, backend/app/migrations/versions/
- [x] task-02: schema【FR-01/02】
  - `schema.py`：`DocumentsSyncRequest`（RootModel dict[str,str] + 四件套白名单校验 422）/ `ApprovalSubmitRequest`（decision: Literal["approved","rejected"]，reason: str|None = None）/ `DocumentsSyncOk` / `ApprovalSubmitOk`。
  - 验收：pydantic 校验单测思路明确（422 三种非法 body）。
  - allowed_paths: backend/app/modules/platform_sync/schema.py
- [x] task-03: service 定向列重构 + 新方法 + 占位行守卫【FR-04/05】
  - `upsert_progress` 改定向 UPDATE（SET latest_progress/last_pushed_at/last_pusher/updated_at；INSERT 不带 documents/approval）。
  - 新 `upsert_documents(workspace_id, name, documents)`：UPDATE 只 SET documents+updated_at，行无 INSERT 占位。
  - 新 `set_approval(workspace_id, name, decision, reason, decided_by)`：UPDATE 只 SET approval+updated_at，行无 INSERT 占位；approval JSON 含 decided_at=now(UTC)。
  - 新 `get_approval_record(workspace_id, name)`：返回 approval 列或 None。
  - 守卫：`get_progress` 对 latest_progress IS NULL 返回 None；`list_lightweight` 过滤占位行。
  - 验收：三写入路径互不覆盖（单写者）+ 守卫生效。
  - allowed_paths: backend/app/modules/platform_sync/service.py

## Wave 2：路由 + 测试 + 类型 + 端到端（依赖 Wave 1）

- [x] task-04: router 两新端点 + GET 改造【FR-01/02/03/06】
  - `POST /changes/{name}/documents`（require_platform_sync，DocumentsSyncRequest，upsert_documents，200 DocumentsSyncOk）。
  - `POST /changes/{name}/approval`（ApprovalSubmitRequest，decided_by=解包 User.username，set_approval，200 ApprovalSubmitOk）。
  - `GET /changes/{name}/approval` 改读 `get_approval_record`：None→`{status:"approved", reason:"no approval record; default-approved"}`，有→真实 status+reason。
  - 验收：404→200 / 405→200，GET 三态正确。
  - allowed_paths: backend/app/modules/platform_sync/router.py
- [x] task-05: 测试全量【FR-09】
  - test_router.py 扩展：documents 200/422×3/401；approval 200(approved/rejected)/422/401；GET 三态（无行/NULL/approved/rejected）；单写者回归（push progress 后 approval 在 + set_approval 后 latest_progress 在）；占位行守卫（documents INSERT 后 GET progress 404 + GET /changes 无占位项 + 后续 push progress 正常 UPDATE）。
  - 验收：platform_sync 子模块 pytest 全绿（`cd backend && uv run pytest app/modules/platform_sync -q --no-cov`）。
  - allowed_paths: backend/app/modules/platform_sync/tests/test_router.py
- [x] task-06: gen:types【FR-08】
  - `pnpm gen:types`（先确认 frontend node_modules 健康）；提交 api-types.ts + openapi.json。
  - 验收：openapi 含两新端点 schema。
  - allowed_paths: frontend/src/lib/api-types.ts, backend/openapi.json
- [x] task-07: 端到端验证 + 文档撤标
  - CLI 实跑：`sillyspec platform sync-docs`（200）/ `platform approve`（200）/ `platform reject --reason`（200）→ GET approval 返回 rejected 核验；测试数据清理。
  - 接口地图 §2 撤除两处"后端未实现"标注（sillyspec 仓文档，非代码）。
  - 验收：三条 CLI 命令端到端成功 + reject 后 GET 反映真实状态。
  - allowed_paths: docs（跨仓 sillyspec docs/sillyspec/platform-interface-map.md，验证性改动）

决策引用：D-001@v1（approval 完整闭环→task-04/07）/ D-002@v1（documents progress 行加列→task-01）/ D-003@v1（单写者定向列→task-03）/ D-004@v1（body 照 CLI 字面→task-02）。

## 依赖关系

- Wave 1 内：task-01 →（task-02 可并行）→ task-03（依赖 model+schema）。
- Wave 2 全部依赖 Wave 1（router 调 service，测试测全栈，gen:types 扫 router）。
- task-07 依赖 task-04/05/06 全部完成。

## 并行策略

单后端模块内聚，Wave 1 顺序执行；Wave 2 task-04→05 顺序，task-06 在 04 后可与 05 并行，task-07 收尾。
