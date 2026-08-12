---
id: task-01
title: PlatformSyncTokenService.get_or_issue 内联吊销+签新
title_zh: 平台同步 token service 新增 get_or_issue 方法 内联吊销旧 token 并签发新 token 返回明文
author: qinyi
created_at: 2026-08-12 10:34:01
priority: P0
depends_on: []
blocks: [task-04, task-08]
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-001]
allowed_paths:
  - backend/app/modules/platform_sync/token_service.py
provides:
  - contract: PlatformSyncTokenService.get_or_issue
    fields: [get_or_issue 方法签名 keyword-only workspace_id 与 created_by 返回 tuple ORM row 与明文 token]
expects_from: []
goal: >
  在 backend/app/modules/platform_sync/token_service.py 新增 async get_or_issue 方法，按 design §5.2 §7.1 内联 select 旧未吊销 token 后 UPDATE 吊销，再调既有 self.create 签新返回 row 与明文，覆盖 FR-01 FR-02 FR-03 与 D-001，为 task-04 build_claim_payload claim 时签发提供契约，不新增 public revoke 保持既有 create authenticate 零回归。
implementation:
  - 在 PlatformSyncTokenService 内新增 async def get_or_issue(self, *, workspace_id, created_by) 返回 tuple[PlatformSyncTokenORM, str]，入参 keyword-only 类型 uuid.UUID，对齐 design §7.1 签名
  - 用 sqlalchemy select 查 workspace_id 与 created_by 与 revoked_at IS NULL 的旧 token 行，命中则内联 UPDATE 该行 revoked_at 为 _utc_now 吊销后 commit，不新增 public revoke 方法
  - 调既有 self.create(workspace_id, name='init-provisioned', created_by, scope=None) 签新，返回新 row 与明文，scope 取 None 因 platform_sync create 的 scope 为 dict|None 且进度同步无 scope 维度
  - 明文仅作为返回值，方法内不写日志不落 lease.metadata，对齐 design §9 与 D-001，datetime 复用既有 _utc_now
acceptance:
  - get_or_issue 存在于 PlatformSyncTokenService，签名匹配 design §7.1 keyword-only workspace_id 与 created_by 返回 tuple
  - 空表调用直接签新，DB 仅新增一条 revoked_at 为空的记录
  - 已有同维度未吊销 token 调用后旧行 revoked_at 非空 新行 revoked_at 为空，DB 始终至多一条同维度活 token
  - 旧 token 吊销后 authenticate 返 None，新明文 authenticate 返非空 Principal
  - 既有 create 与 authenticate 方法签名及行为零改动，platform_sync 模块 pytest 回归全绿
verify:
  - cd backend && uv run pytest app/modules/platform_sync -q --no-cov
constraints:
  - 不修改既有 create 与 authenticate 方法签名及实现零回归，吊销逻辑内联在 get_or_issue 不抽 public revoke 因 platform_sync 无别处需要 revoke
  - 明文不入日志不落 lease.metadata 仅返回调用方由 task-04 claim 时注入 payload，对齐 D-001 与 §9
  - scope 固定传 None 不取 dispatch，区别 mcp_gateway task-02，因 platform_sync token_service.create scope 类型为 dict|None
  - created_by 为非空外键，get_or_issue 入参不加默认值不处理 None，调用方 task-04 必传
  - 代码兼容 Windows Linux 与 macOS，datetime 复用 _utc_now 不引入新时区源
---
