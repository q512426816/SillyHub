---
author: qinyi
created_at: 2026-08-02 00:27:37
change: 2026-08-01-proxy-create-race-fix
plan_level: light
---

# 轻量计划（Light Plan）：proxy-create 并发竞态 500 修复

## 来源
brainstorm 已定稿（design.md r3 两轮 Design Grill 终审 pass + decisions.md D-001@v2 ~ D-006@v1 全 accepted，无 unresolved blocker）。需求：消除 daemon-client 工作区 `POST /changes/proxy-create` 的双表并发竞态 500（`changes.ux_changes_workspace_key` 与 `change_documents.ux_change_docs_type_path` 两张表唯一键被 proxy 落库路与 daemon 整树回灌 reparse 路并发撞键）。

## 范围
- 修改 `backend/app/modules/change_writer/proxy.py`：
  - `proxy_create_change` 时序重构（步骤3 占坑 INSERT Change + 全部 ChangeDocument 先 commit / 步骤6 回执 done 不再 INSERT docs / 步骤7 failed-超时独立 session DELETE 占坑 Change 行，FK CASCADE 删 docs）
  - `_build_change_key` 改 unicode 感知正则 + `.lower()`
- 修改 `backend/app/modules/change/service.py`：
  - `_apply_parsed`（service.py:1248）加 `row.owner_id is None` 守卫
  - `_reparse` created 分支（service.py:1064-1066 `_session.add(row)`）外包 try/except IntegrityError → 转 update
- 修改 `backend/app/modules/change_writer/tests/test_proxy.py`：占坑成功 / 双表不撞键 / docs 存在 / 回滚 / 中文 key + 现有回归
- 修改 `backend/app/modules/change/tests/`（_reparse / _apply_parsed 相关）：owner_id 守卫 + IntegrityError 转 update case
- 不改：DB schema / migration / 前端 / daemon / doc_type（R-05 既有 bug 另行处理）

## Tasks
- [x] task-01: [Wave1] 重构 `proxy_create_change` 时序——下发 daemon_change_write 前先占坑 INSERT Change（current_stage="draft", owner_id=user_id, stages）+ 全部 ChangeDocument（doc_type/path 取自 `_build_files`，exists=True），commit；回执 done 后不再 INSERT docs（step6）；回执 failed/超时独立 session DELETE 占坑 Change（FK CASCADE 删 docs）回滚（step7）（覆盖：FR-01, FR-02, FR-05, D-001@v2, D-006@v1）
- [x] task-02: [Wave1] `_build_change_key` 改 unicode 感知正则 + `.lower()`：`re.sub(r"[^\w]+", "-", title.lower(), flags=re.UNICODE).strip("-")[:40] or "untitled"`，中文标题保留原字，纯标点兜底 untitled，末尾 uuid 后缀保唯一（覆盖：FR-06, D-003@v1）
- [x] task-03: [Wave2] `_apply_parsed`（service.py:1248）加 `row.owner_id is None` 守卫——仅当行 owner_id 为 None（扫描创建）才用文件推断覆盖 current_stage；proxy/worktree-lease 创建行（owner_id 非空）stage 不被覆盖（覆盖：FR-03, D-002@v1）
- [x] task-04: [Wave2] `_reparse` created 分支（service.py:1064-1066 `_session.add(row)`）外包 try/except IntegrityError → 回滚该 add → 重查 existing_by_key → 改走 `_apply_parsed`(update)，不抛 500（覆盖：FR-04, D-004@v1）
- [x] task-05: [Wave3] `change_writer/tests/test_proxy.py` 占坑成功（Change+docs 先于 daemon_change_write 存在）/ 双表不撞键（模拟 daemon sync reparse 与 proxy 并发）/ proxy 返回 docs 存在 / 写 failed+超时回滚（CASCADE 验证）/ 中文 change_key + .lower() case + 现有在线/离线/超时回归（覆盖：FR-01~06）
- [x] task-06: [Wave3] `change/tests/` `_apply_parsed` owner_id 非空不覆盖 + owner_id=None 覆盖；`_reparse` created 撞键 IntegrityError → 转 update case（覆盖：FR-03, FR-04）
- [x] task-07: [Wave4/验收] 真实 daemon-client 工作区 e2e 验收——创建中文标题变更返回 201 不 500 + 详情页 docs 显示 + 失败回滚无孤儿（verify/部署阶段执行，依赖 live daemon）（覆盖：AC-01~05）

## 验收
- AC-01: daemon-client 工作区创建变更（含中文标题）返回 201 不 500；change_key 保留中文（如「测试」→ `changes/2026-08-02-测试-xxx/`）；纯标点兜底 untitled
- AC-02: 占坑 Change+docs 先于 daemon_change_write 下发 commit；reparse `_fetch_existing_changes` 命中占坑行 → `_apply_parsed`(update)，不 `_build_change`(created)
- AC-03: `changes.ux_changes_workspace_key` 与 `change_documents.ux_change_docs_type_path` 均无并发撞键（proxy 步骤6 不再 INSERT docs，reparse 单路串行写 docs）
- AC-04: proxy 返回时 DB 已有 Change + docs（详情页不空）
- AC-05: daemon 写 failed / proxy 等回执超时（60s）→ 独立 session DELETE 占坑 Change（FK CASCADE 级联删 docs），无孤儿行，抛 ChangeWriteError/超时错
- AC-06: `_apply_parsed` 对 owner_id 非空行不覆盖 current_stage；owner_id=None 行行为不变（历史扫描行回归）
- AC-07: `_reparse` created 撞 `ux_changes_workspace_key` → catch IntegrityError 重查转 update，不抛 500 / sync_status 不永久 dirty
- AC-08: server-local `/changes/create`（worktree lease 分支）+ 历史 owner_id=None 行无破坏性变化（worktree lease stage 不再被文件推断覆盖，语义更对，已显式承认）
- AC-09: `change_writer` + `change` 模块单测全绿（local.yaml modules 块未配两子模块，verify 须手动指定测试范围 `backend/app/modules/change_writer` + `backend/app/modules/change`，避免 backend 全量预存 errors）

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v2 | task-01 | AC-02, AC-03, AC-04 |
| D-002@v1 | task-03 | AC-06, AC-08 |
| D-003@v1 | task-02 | AC-01 |
| D-004@v1 | task-04 | AC-07 |
| D-005@v1 | task-01 | AC-05 |
| D-006@v1 | task-01, task-05 | AC-03（竞态消除=占坑+串行，proxy 路不再写 docs）|
