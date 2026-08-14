---
author: qinyi
created_at: 2026-08-14 21:38:00
---

# 需求（Requirements）— platform_sync 契约缺口端点

## 功能需求

- **FR-01 四件套文档同步**：`POST /api/changes/{name}/documents` 接收扁平 map body（键限 proposal/design/requirements/tasks.md 四件套白名单，值 str），按 (workspace_id, change_name) 复合键 upsert `documents` 列，行不存在 INSERT 占位（latest_progress NULL）；200 `{synced, change_name}`；空 map/白名单外键/值非 str → 422。（D-002@v1 / D-004@v1）
- **FR-02 审批决定提交**：`POST /api/changes/{name}/approval` 接收 `{decision: "approved"|"rejected"（过去式）, reason?}`（reason optional default None——CLI approved 分支不带该键），写 `approval` 列 `{status, reason, decided_at, decided_by}`，decided_by=权威 `User.username`（禁 header fallback，Grill UB-2 裁定）；重复提交覆盖（后写赢）；200 `{status:"ok", decision, change_name}`；非法 decision → 422。（D-001@v1 / D-004@v1）
- **FR-03 审批状态读库**：`GET /api/changes/{name}/approval` 改读 approval 列——行不存在/NULL → `{status:"approved", reason:"no approval record; default-approved"}`（ql-20260812-001-6eb8 兼容，不 404）；有记录 → 真实 status+reason。rejected → CLI execute 启动 exit(1) 硬阻断（run/command.js:1113-1129 现有门控，零改动）。（D-001@v1）
- **FR-04 单写者纪律**：upsert_progress 重构为定向列 UPDATE（只 SET latest_progress/last_pushed_at/last_pusher/updated_at，INSERT 不带 approval/documents）；upsert_documents / set_approval 各自只 UPDATE 本方列 + updated_at；三路径互不覆盖。（D-003@v1）
- **FR-05 占位行守卫**：`get_progress` 对 `latest_progress IS NULL` 占位行返回 None（router 维持 404——防 CLI triggerPull 拉空态经 pm.import 清空本地进度库）；`list_lightweight` 过滤占位行。（Grill UB-1 修订）
- **FR-06 鉴权与隔离**：两新端点复用 `require_platform_sync`（shpsync_ 派生 workspace_id，跨 workspace 同名隔离）。
- **FR-07 migration**：alembic batch_alter_table 加 documents/approval 两 JSON nullable 列，revision 对齐单 head（落实现时 `alembic heads` 确认）。
- **FR-08 类型同步**：`pnpm gen:types` 再生成 api-types.ts + openapi.json 并提交。
- **FR-09 测试**：test_router.py 扩展——422（三种非法 body）/401/200（两新端点）/GET 三态（无记录/NULL/approved/rejected）/单写者回归（push progress 后 approval 不丢，反之亦然）/占位行守卫回归（documents INSERT 后 GET progress 仍 404 + GET /changes 不多占位项 + 随后 push progress 正常 UPDATE）。

## 决策引用

D-001@v1（approval 完整闭环）、D-002@v1（documents progress 行加列）、D-003@v1（单写者定向列）、D-004@v1（body 照 CLI 字面）——全部被 FR-01~FR-04 覆盖，无剩余未覆盖决策。

## 非功能需求

- 现有 3 端点对已有真实进度数据的行为完全不变（NFR-01）。
- documents 大 JSON（几百 KB）与 latest_progress 同量级，无索引查询需求（NFR-02，P2 风险已评估）。
