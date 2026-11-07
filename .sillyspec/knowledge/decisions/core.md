# 决策知识 — core

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-core-001@v1 2026-10-10-server-db-pool-tuning——阿里云生产服务器（2 核 / 1.6G 内存）持续 swap 换页导致整机卡顿（vmstat 实测 so 峰值 ~9790 页/s、CPU wa 一度 71%）
状态：implemented
变更：2026-10-10-server-db-pool-tuning
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-10-server-db-pool-tuning/design.md
文件：backend/app/core/config.py, backend/app/core/db.py, backend/tests/core/test_db_pool_settings.py
最近确认：未记录
理由：阿里云生产服务器（2 核 / 1.6G 内存）持续 swap 换页导致整机卡顿（vmstat 实测 so 峰值 ~9790 页/s、CPU wa 一度 71%）。根因之一：`backend/app/core/db.py` 连接池写死 `_POOL_SIZE=20 / _MAX_OVERFLOW=30`，SQLAlchemy 池只增不减，postgres 侧常驻 13 个 idle 连接，每个是一个独立 postgres 服务进程，在 1.6G 机器上挤爆内存。 方案：池参数从 `Settings` 新增字段 `db_pool_size` / `db_max_overflow` 读取（pydantic-settings 自动映射环境变量 `DB_POOL_SIZE` / `DB_MAX_OVERFLOW`），代码默认值保持 20/30 不变（开发机/大内存机器行为零变化），由服务器 `.env` 配小值（5/10）适配小规格机器。选择改 Settings 而非 db.py 直接 `os.getenv`，依据 config.py 模块规约「All runtime configuration MUST live here — never read os.environ directly」。
