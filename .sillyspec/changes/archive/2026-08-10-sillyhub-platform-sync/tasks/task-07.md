---
id: task-07
title: platform_sync tests covering contract section 13 checklist
title_zh: platform_sync 测试 覆盖契约§13校验清单8项+冲突算法+零回归
author: qinyi
created_at: 2026-08-10 23:45:00
priority: P0
depends_on: [task-06]
blocks: []
requirement_ids: [FR-04, FR-05, FR-06, FR-07]
decision_ids: [D-004@v1, D-005@v1, D-006@v1, D-007@v1]
allowed_paths:
  - backend/app/modules/platform_sync/tests/__init__.py
  - backend/app/modules/platform_sync/tests/conftest.py
  - backend/app/modules/platform_sync/tests/test_router.py
goal: >
  测试覆盖契约 §13 校验清单 8 项（design §10.1）+ §4.2 冲突算法 + §7 字典序 + §8 零回归
  + §5/§6 响应形态。对照客户端 sync.js 真实行为设计断言。
implementation:
  - 新建 tests/__init__.py（空包标记）
  - 新建 conftest.py：参考现有 conftest（backend/conftest.py 或 change/tests 模式）建 async client + session fixture；签发测试 API Key（用 ApiKeyService.create 签发 shk_live_ key + 造测试 User，或直接插入 ApiKey 行）→ 提供 auth_headers fixture（Authorization: Bearer <测试 key>）；jwt_headers fixture 备用
  - 新建 test_router.py 覆盖契约 §13 八项（design §10.1）：
    * [§13-1] POST 读 3 header：带 X-SillySpec-User/Base-Ts/Pushed-At 推送，断言存入 last_pusher/last_pushed_at
    * [§13-2] base_ts 冲突算法：先 push（pushed_at=T2）建 stored；再 push base_ts=T1（T1<T2 字典序）→ 409；base_ts=T3（T3≥T2）→ 200
    * [§13-3] 409 body：断言 res.status_code==409 + res.json()['conflict']==True + 'platform_progress' 是完整六表 + 'last_pushed_at'==stored
    * [§13-4] GET /api/changes 列表：断言裸数组 + 每项 name/current_stage/last_pushed_at/last_pusher
    * [§13-5] GET /api/changes/{name}/progress：断言裸六表 + 顶层 last_pushed_at；不存在 → 404
    * [§13-6] 字典序比对：ISO8601 UTC 串 > 比对（不转 datetime），用 new Date().toISOString() 同格式串验证 stored>baseTs
    * [§13-7] 零回归：POST 不带任何 X-SillySpec-* header（裸 body）→ 200 接受（base_ts 空=首次）
    * [§13-8] 不 auto-merge：409 时 platform_progress 严格等于平台当前 latest_progress（未合并）
  - 额外：无 Authorization → 401；合法 JWT → 通过（鉴权双路径）
acceptance:
  - 契约 §13 八项每项至少 1 个测试覆盖且通过
  - 冲突算法边界覆盖（stored>baseTs 409 / stored≤baseTs 200 / stored None 200 / base_ts 空 200）
  - 零回归测试通过（老 body 无 header）
  - 鉴权测试通过（无 token 401 / APIKey 通过 / JWT 通过）
verify:
  - cd backend && uv run pytest app/modules/platform_sync/tests -q --no-cov
  - cd backend && uv run ruff format --check app/modules/platform_sync && uv run ruff check app/modules/platform_sync
constraints:
  - 测试用 SQLite（项目 conftest 惯例），JSON 列 dialect 无关（task-01 用 JSON() 非 JSONB 前提）
  - 时间戳用 ISO 8601 UTC 串（如 '2026-08-10T13:00:00.000Z'），字典序比对，不转 datetime
  - conftest 签发测试 API Key 用 ApiKeyService 正规路径（不绕过 bcrypt），或参考现有 auth 测试 fixture 模式
  - 不 mock 掉冲突算法本身（要真测 §4.2），只 mock 网络/外部
---
