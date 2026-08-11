---
id: task-01
title: 新建 PlatformSyncTokenORM（platform_sync/token_model.py）
title_zh: 新建 platform_sync 同步鉴权 token ORM 模型（workspace 级 platform_sync_tokens 表）
author: qinyi
created_at: 2026-08-11 20:27:34
priority: P0
depends_on: []
blocks: [task-03, task-04, task-05]
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/platform_sync/token_model.py
provides:
  - contract: PlatformSyncTokenORM
    fields: [id, workspace_id, created_by, name, token_hash, scope, last_used_at, revoked_at, created_at]
goal: >
  新建 backend/app/modules/platform_sync/token_model.py 定义 PlatformSyncTokenORM（platform_sync_tokens 表），
  字段集按 design §8.1 落 9 列并参照 mcp_gateway McpTokenORM 的 SQLModel 写法，为 task-03 建表 migration
  与 task-04 token_service 的 create/authenticate 查表提供数据层契约，覆盖 FR-01 与 D-001@v1。
implementation:
  - 新建 token_model.py 定义 SQLModel 类 PlatformSyncTokenORM 继承 BaseModel 与 table=True，表名 platform_sync_tokens，写法对齐 mcp_gateway/model.py 的 McpTokenORM（Field 加 sa_column=Column 风格，import app.models.base.BaseModel）
  - 字段按 design §8.1 落 9 列，id 为 Uuid PK 默认 uuid.uuid4，workspace_id 为 Uuid 外键 workspaces.id ondelete CASCADE 非空，created_by 为 Uuid 外键 users.id 非空
  - name 为 String(100) 非空，token_hash 为 String(255) 非空唯一存 sha256 明文 hex，scope 为 JSON 可空预留，created_at 为带时区 DateTime 非空默认 datetime.now(UTC)，last_used_at 与 revoked_at 为带时区 DateTime 可空
  - __table_args__ 加 token_hash 唯一索引与 workspace_id 普通索引支撑 hash 等值查与 workspace 维度列表查，模块 docstring 标注本变更 task-01 与 design §8.1 与 D-001@v1 并写明只落 schema 不写业务
acceptance:
  - PlatformSyncTokenORM 类存在于 platform_sync/token_model.py，继承 BaseModel 与 table=True，表名为 platform_sync_tokens
  - 9 列齐备且类型约束符合 design §8.1，workspace_id 与 created_by 均为非空外键，token_hash 为 String(255) 非空唯一
  - token_hash 加唯一索引且 workspace_id 加普通索引，不含 key_prefix 与 expires_at 列
  - backend 导入不报错，platform_sync 既有 pytest 回归全绿
verify:
  - backend/.venv/Scripts/python.exe -c "import app.modules.platform_sync.token_model as m; print(m.PlatformSyncTokenORM.__tablename__)"
  - backend/.venv/Scripts/python.exe -m pytest backend/app/modules/platform_sync/tests -q
constraints:
  - 本任务只落 ORM schema 表与字段定义，不写业务行为，签发与校验归 task-04 token_service，建表 migration 归 task-03
  - 不新增或修改测试，platform_sync 子模块 pytest 回归与新增用例统一在 task-12 跑
  - brownfield 兼容按规则 7 可清空，新表由 task-03 alembic upgrade 建出，老数据不回填
  - 不修改 platform_sync/model.py 现有 PlatformChangeProgressORM，其加 workspace_id 改造归 task-02
  - created_by 按 design §8.1 为 NOT NULL，区别于 McpTokenORM 可空 SET NULL，因 authenticate 需派生非空 User；代码须兼容 Windows Linux 与 macOS
---
