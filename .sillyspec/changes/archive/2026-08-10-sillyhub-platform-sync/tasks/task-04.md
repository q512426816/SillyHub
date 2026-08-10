---
id: task-04
title: PlatformSyncService upsert_progress conflict detection and list/get
title_zh: PlatformSyncService 业务层 base_ts 字典序冲突检测与列表/详情查询
author: qinyi
created_at: 2026-08-10 23:45:00
priority: P0
depends_on: [task-01, task-02]
blocks: [task-06]
requirement_ids: [FR-04, FR-06, FR-08]
decision_ids: [D-004@v1, D-006@v1, D-008@v1]
allowed_paths:
  - backend/app/modules/platform_sync/service.py
provides:
  PlatformSyncService:
    methods: [upsert_progress, list_lightweight, get_progress]
goal: >
  实现 PlatformSyncService 三方法：upsert_progress 严格按契约 §4.2 base_ts 字典序
  冲突检测算法（缺 base_ts/空→接受；stored>base_ts→409 冲突；否则接受），
  list_lightweight 返回轻量列表，get_progress 返回完整六表+顶层 last_pushed_at。
implementation:
  - 新建 backend/app/modules/platform_sync/service.py
  - 定义 PlatformSyncResult dataclass（或 typeddict）：conflict: bool, platform_progress: dict|None, last_pushed_at: str|None（conflict=True 时 platform_progress 为平台当前 latest_progress 完整六表）
  - upsert_progress(session, name, body: dict, base_ts: str|None, pushed_at: str|None, user: str|None) -> PlatformSyncResult：
    * row = await session.get(PlatformChangeProgressORM, name)
    * if not base_ts（None 或空串）：首次/无基准 → 无条件接受（契约 §4.2 分支1）
    * else：stored = row.last_pushed_at if row else None；if stored is not None and stored > base_ts（Python 字符串 >，字典序，契约 §7）：→ 冲突，return PlatformSyncResult(conflict=True, platform_progress=row.latest_progress, last_pushed_at=stored)
    * 接受分支：if row：row.latest_progress=body; row.last_pushed_at=pushed_at; row.last_pusher=user; row.updated_at=now；else：session.add(PlatformChangeProgressORM(change_name=name, latest_progress=body, last_pushed_at=pushed_at, last_pusher=user))；await session.commit()；return PlatformSyncResult(conflict=False, None, None)
  - list_lightweight(session) -> list[dict]：select(PlatformChangeProgressORM) 全表；每行 {name: change_name, current_stage: (latest_progress or {}).get('changes',[{}])[0].get('current_stage'), last_pushed_at, last_pusher}（current_stage 取自裸六表 changes[0]，sync.js:592 客户端按键识别）
  - get_progress(session, name) -> dict|None：row = await session.get(...)；None → None（router 404）；else return {**(row.latest_progress or {}), 'last_pushed_at': row.last_pushed_at}
acceptance:
  - upsert_progress 首次（base_ts 空）→ 接受 + 新建行
  - upsert_progress stored>base_ts → PlatformSyncResult.conflict=True + platform_progress=完整 latest_progress + last_pushed_at=stored
  - upsert_progress stored≤base_ts 或 stored None → 接受 upsert
  - 比对用 Python 字符串 >（字典序，不转 datetime）
  - list_lightweight 返回字段齐全（name/current_stage/last_pushed_at/last_pusher）
  - get_progress 返回完整六表 + 顶层 last_pushed_at
verify:
  - cd backend && uv run ruff format --check app/modules/platform_sync && uv run ruff check app/modules/platform_sync
  - cd backend && uv run mypy app/modules/platform_sync/service.py
  - 冲突算法/列表/详情由 task-07 端点测试覆盖
constraints:
  - base_ts 冲突比对用字符串字典序（Python >），绝不转 datetime（契约 §7 / D-004 / R-04）
  - 后端不自造 last_pushed_at，只存客户端 X-SillySpec-Pushed-At 原值（R-04 前提）
  - latest_progress 按裸 dict 透传，不强类型化六表（NG-6）
  - 冲突绝不 auto-merge，直接返回平台当前完整 latest_progress（D-006 / 契约 §9）
  - change_name 全局唯一聚合（D-008），不做 project/workspace 隔离
---
