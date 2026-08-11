---
id: task-02
title: PlatformChangeProgressORM workspace_id composite PK
title_zh: PlatformChangeProgressORM 加 workspace_id 列改复合主键
author: qinyi
created_at: 2026-08-11 20:27:34
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/platform_sync/model.py
provides:
  - contract: PlatformChangeProgressORM
    fields: [workspace_id, change_name]  # 复合 PK
goal: >
  PlatformChangeProgressORM 加 workspace_id 列（Uuid，FK workspaces.id CASCADE），
  主键从 change_name 改为复合 (workspace_id, change_name)，对齐 design §8.2 与 D-001，
  为收件箱 workspace 隔离提供数据基础。
implementation:
  - 按 mcp_gateway/model.py 的 McpTokenORM 风格引入 uuid 与 ForeignKey、Uuid
  - 新增 workspace_id 列 Uuid(as_uuid=True)，FK workspaces.id ON DELETE CASCADE，与 change_name 共同声明为复合主键
  - change_name 保留 String 主键列，其余元字段（latest_progress 等）与 __tablename__ 不变
  - 更新模块 docstring 与类注释，声明 change_name 由全局聚合改为 workspace 内聚合（D-001）
acceptance:
  - workspace_id 与 change_name 构成复合主键，仅 change_name 不再唯一标识一行
  - workspace_id 列为 Uuid 且带 workspaces.id 的 CASCADE 外键约束
  - 模型可正常导入，ruff 格式与 mypy 检查通过
  - __tablename__ 与既有元字段（latest_progress 等）保持不变
verify:
  - cd backend && uv run ruff format --check app/modules/platform_sync && uv run ruff check app/modules/platform_sync
  - cd backend && uv run mypy app/modules/platform_sync/model.py
constraints:
  - 本 task 只改 model.py，service 与既有测试以 change_name 单值 PK 引用处由 task-06/07 随复合键同步改造，勿越界改动
  - workspace_id 参与复合主键按非空声明，老数据 NULL 过渡归 task-03 migration 依规则 7 清空，本 task 不处理数据
  - 字段名 workspace_id 与 change_name 严格对齐 design §8.2，下游 task-03 migration、task-06 service、task-08 投影 join 依赖
  - 列声明参照 McpTokenORM 风格，不引入新依赖，代码兼容 Windows 与 Linux 与 macOS
---
