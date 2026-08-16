---
id: task-02
title: platform_sync write side pass real user and _sync_change_owner (savepoint atomic, idempotent re-check, first-fill no event, best-effort) with tests
title_zh: platform_sync 写入侧——router 传真实 User + _sync_change_owner（savepoint 原子/幂等现值复查/首填不记事件/best-effort）+ 测试
author: qinyi
created_at: 2026-08-16 11:40:00
priority: P0
depends_on: [task-01]
blocks: [task-03]
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/platform_sync/service.py
  - backend/app/modules/platform_sync/router.py
  - backend/app/modules/platform_sync/tests/test_owner_sync.py
provides:
  - behavior: push_progress 接受分支 owner 对齐 token 签发人（ux_changes.owner_id 写路径，D-001@v1）
  - table: change_events 的 owner_change 首类事件行（detail 含 from_user_id / to_user_id 两键，created_by=新 owner）
expects_from:
  task-01:
    - contract: ChangeEventORM
      needs: [event_type, detail, change_id, workspace_id, created_by]
goal: >
  design §5 Phase 1.2-1.3（FR-01 / D-001@v1，含 Grill P1-2 事务边界修正）：
  push_progress 接受分支把 ux_changes.owner_id 对齐 token 签发人——router 不再丢弃
  鉴权已派生的真实 User（auth.py:129 产出 (user, workspace_id)，router.py:95 现丢弃
  _user 只取 header 字符串）；service 新增 _sync_change_owner，在 _apply 与
  _ensure_change_row 完成后调用（两者内部各自 commit=独立已提交单元，不强求同事务），
  函数体内 begin_nested savepoint 原子执行 SELECT 重查行 + UPDATE owner + INSERT
  事件，三分支（None 首填只 UPDATE 不记事件 / 不同则 UPDATE+INSERT owner_change
  事件 / 相同幂等零写），失败仅回滚 savepoint + log.warning 不阻断上行（与
  _ensure_change_row :239-249 范式同构，进度主数据永不被 owner 失败吞掉）。
implementation:
  - router.py:95 push_progress：`_user, scope = auth` 后不再丢弃 _user——upsert_progress 调用新增 `user_id=_user.id` kw 参数透传；router.py:97-99 三行 header 读取（X-SillySpec-Base-Ts/Pushed-At/User）与既有 `user=user` 参数逐字不动（last_pusher 语义零变化，§9 兼容）
  - service.py upsert_progress（:98-128）签名加 user_id 可选参数（uuid.UUID | None，default None，语义同 workspace_id 的可空防御口径）；两个接受分支（分支1 :111-114、分支3 :125-128）在 `_apply` + `_ensure_change_row` 完成后调用 `await self._sync_change_owner(workspace_id, name, user_id)`；冲突分支（:118-123 返回 409）不调——被拒绝的上行不得改责任人
  - 新增私有方法 `_sync_change_owner`（位置紧随 _ensure_change_row，链路可读）：`workspace_id is None or user_id is None` 防御直接 return（service 直调场景，同 _ensure_change_row :202-203 口径）；Change / ChangeEventORM 用函数内局部 import（对齐 :204 范式防循环依赖）
  - savepoint 原子块（try + `async with self._session.begin_nested()`，:239-249 范式同构）：内部先 SELECT 重查 Change 行（select(Change).where(workspace_id==, change_key==name)）拿 id——_ensure_change_row race-lost 路径不返回行对象，绝不能依赖上游传行；row is None 直接 return（理论不发生，_ensure_change_row 已兜底）
  - 三分支（Grill 修正后语义）：`row.owner_id is None` → 仅 UPDATE owner_id=user_id（占位行首填非"变化"，不记事件）；`row.owner_id != user_id` → UPDATE owner_id + INSERT ChangeEventORM(event_type='owner_change'、detail 含 from_user_id=旧值与 to_user_id=user_id 两键、created_by=user_id、workspace_id=workspace_id、change_id=row.id)；`row.owner_id == user_id` → 幂等零写直接 return（owner_id 现值判据天然拦截同值重试与 A→B→A 交替中的重复段，R-01）
  - savepoint 块正常退出后 `await self._session.commit()`；`except Exception:` → `await self._session.rollback()` + log.warning("platform_sync.change_owner_sync_failed", workspace_id/change_key 附上下文) 后正常返回——best-effort，_apply 已 commit 的进度行与占位行不受影响
  - 新建 test_owner_sync.py 五场景（helper 复用 test_router.py:622 _make_ws_and_shpsync 同款：建 workspace+User+签 shpsync_ token）：①首填——push 后 owner=token 用户 + change_events 零行；②变化——预置 owner=A 再以 B 的 token push → owner=B + 恰 1 行事件（detail 键 from_user_id/to_user_id/created_by=B/workspace/change_id 全断言）；③幂等含 A→B→A——A→B 事件 1 行、B→A 事件 1 行、A 再推零新事件（终态共 2 行）；④占位行 race-lost——直接预插 Change 行模拟对端已建（_ensure_change_row 走 existing 早退），push 后 SELECT 重查路径命中首填成功，验证不依赖 _ensure_change_row 返回对象；⑤失败容错——monkeypatch 令事件 INSERT/flush 抛错 → 响应仍 200 + platform_change_progress 行已落 + owner 未变 + log.warning 可捕。表可用性：root conftest db_engine 已 import app.modules.change.model（backend/conftest.py:153），task-01 落 ChangeEventORM 后 create_all 自动建 change_events，users/changes 同理已注册——无需改 conftest（allowed_paths 亦不含）
acceptance:
  - 三分支行为正确：首填 UPDATE 无事件；变化 UPDATE + 恰一事件（event_type='owner_change'，detail 键 from_user_id/to_user_id 逐字，created_by=新 owner，workspace 隔离 + change_id 正确）；相同幂等零写（owner 与事件均零变化，A→B→A 交替仅 2 事件）
  - owner 同步失败不阻断上行主流程：savepoint 回滚 + log.warning，进度行/占位行数据完好，端点响应仍 200
  - header X-SillySpec-User → last_pusher 行为零变化（router 三行读取原样；test_router.py:77 既有三头用例不回归）；409 冲突分支不触碰 owner
  - 无唯一约束/索引新增（幂等口径=owner_id 现值复查，表结构归 task-01；并发双发撞 savepoint 由现值复查兜底）
verify:
  - cd backend && uv run pytest app/modules/platform_sync/tests/test_owner_sync.py app/modules/platform_sync -q --no-cov
  - cd backend && uv run ruff format --check app/modules/platform_sync/service.py app/modules/platform_sync/router.py app/modules/platform_sync/tests/test_owner_sync.py
  - cd backend && uv run mypy app/modules/platform_sync/service.py app/modules/platform_sync/router.py
constraints: >
  幂等口径=owner_id 现值复查，勿加唯一约束（plan Grill note① / R-01，短期并发
  重复可接受）；不动 _apply 主流程 commit 时机——_apply / _ensure_change_row
  各自内部 commit 保持独立已提交单元，_sync_change_owner 只在其后调用（Grill
  P1-2 事务边界修正），不强求同事务；detail 键名 from_user_id / to_user_id 逐字
  （task-04 读侧 join users 消费契约）；event_type 字面 'owner_change'、
  created_by=新 owner（token 用户）；X-SillySpec-User / last_pusher 语义零变化，
  409 分支不碰 owner；不改 platform_sync/tests/conftest.py（allowed_paths 不含；
  change_events 表由 root conftest 既有 change model import 自动建）。
---
