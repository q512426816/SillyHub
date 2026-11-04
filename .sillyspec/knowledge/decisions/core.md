# 决策知识 — core

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-10-server-db-pool-tuning
锚点：未记录
文件：.sillyspec/changes/2026-10-10-server-db-pool-tuning/design.md, .sillyspec/changes/2026-10-10-server-db-pool-tuning/flow-state.yaml, .sillyspec/changes/2026-10-10-server-db-pool-tuning/proposal.md, .sillyspec/changes/2026-10-10-server-db-pool-tuning/requirements.md, .sillyspec/changes/2026-10-10-server-db-pool-tuning/tasks.md, backend/app/core/config.py, backend/app/core/db.py, backend/tests/core/test_db_pool_settings.py
最近确认：e3bca7777d2c72a74e7292e1c5b98326478a7a61
理由：最大风险：把服务器池调太小导致高峰期请求排队等连接（`pool_timeout=30s` 后抛超时）。缓解：服务器配 5+10=15 上限，对当前低负载（load 0.29、13 idle 已是历史峰值水位）足够；真不够时改 `.env` 重启即可，无需改代码。放弃的方案：a) 直接把默认值改成 5——会改变开发机/大机器行为，且注释说明 20 是按 multi-agent 负载（daemon websocket + mission 轮询 + worker 回调并发）调的，砍默认值风险大于收益；b) db.py 里 `os.getenv` 直读——违反 config.py 模块规约；c) 非法值静默回退默认——掩盖配置错误，运维难察觉（本仓库 .env 手工维护，错值静默等于埋雷）。

## D-core-001@v1 2026-10-10-server-db-pool-tuning——阿里云生产服务器（2 核 / 1.6G 内存）持续 swap 换页导致整机卡顿（vmstat 实测 so 峰值 ~9790 页/s、CPU wa 一度 71%）
状态：implemented
变更：2026-10-10-server-db-pool-tuning
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-10-server-db-pool-tuning/design.md
文件：backend/app/core/config.py, backend/app/core/db.py, backend/tests/core/test_db_pool_settings.py
最近确认：未记录
理由：阿里云生产服务器（2 核 / 1.6G 内存）持续 swap 换页导致整机卡顿（vmstat 实测 so 峰值 ~9790 页/s、CPU wa 一度 71%）。根因之一：`backend/app/core/db.py` 连接池写死 `_POOL_SIZE=20 / _MAX_OVERFLOW=30`，SQLAlchemy 池只增不减，postgres 侧常驻 13 个 idle 连接，每个是一个独立 postgres 服务进程，在 1.6G 机器上挤爆内存。 方案：池参数从 `Settings` 新增字段 `db_pool_size` / `db_max_overflow` 读取（pydantic-settings 自动映射环境变量 `DB_POOL_SIZE` / `DB_MAX_OVERFLOW`），代码默认值保持 20/30 不变（开发机/大内存机器行为零变化），由服务器 `.env` 配小值（5/10）适配小规格机器。选择改 Settings 而非 db.py 直接 `os.getenv`，依据 config.py 模块规约「All runtime configuration MUST live here — never read os.environ directly」。
