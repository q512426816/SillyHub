---
schema_version: 1
doc_type: module-card
module_id: migrations
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:09:00
---
# migrations

## 定位
Alembic 数据库迁移目录。维护 backend 全部业务表的 schema 演进（workspaces/auth/rbac/changes/tasks/agent/daemon/git_gateway/git_identity/incident/ppm 全子域/session_dialog 等）。env.py 在 offline/online 运行前 eager import 所有 feature model，确保 SQLModel 表注册到 BaseModel.metadata。

## 契约摘要
- 无对外 HTTP 端点；通过 `alembic upgrade/head`、`alembic revision --autogenerate` 等 CLI 驱动
- `migrations/env.py` — async 运行配置，从 `app.core.config.get_settings()` 取 DB URL（alembic.ini 中 `sqlalchemy.url` 留空占位）
- `migrations/versions/*.py` — 62 个迁移文件（含 merge heads：`1e69522e288c_merge_orchestration_and_ppm_heads`、`4d9236aa3abb_merge_heads`）
- target_metadata = `app.models.base.BaseModel.metadata`

## 关键逻辑
```
# env.py run_migrations_online:
settings = get_settings()
engine = async_engine_from_config({... sqlalchemy.url = settings.db_url ...})
target_metadata = BaseModel.metadata
# eager import 各 feature model（agent/auth/change/daemon/git_gateway/git_identity/
#   incident/ppm.*/release/runtime/...）使表注册到 metadata
await conn.run_sync(do_run_migrations)   # 渲染 + 执行 SQL
```

## 注意事项
- alembic.ini 的 `sqlalchemy.url` 故意留空，真实 URL 由 env.py 从 app Settings 注入（支持环境变量/容器配置）
- env.py 必须 eager import 全部 feature model，否则 autogenerate 漏表；新增模块的 model 需在此加 import
- 存在两个 merge head（orchestration+ppm、多分支合并），升级到 head 会自动走合并迁移
- `migrations/versions/*` 在 ruff 配置中豁免 `UP035`（alembic 模板用 `typing.Sequence`）
- ppm 相关迁移（create_ppm_problem / create_ppm_kanban / alter_ppm_fk_to_uuid）是近期重点；alter_fk_to_uuid 若 map_fk 失败会留孤儿外键
- 迁移命名约定 `YYYYMMDDHHMM_<verb>_<entity>.py`；本项目未上线，数据可清空，回滚不强调兼容

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
