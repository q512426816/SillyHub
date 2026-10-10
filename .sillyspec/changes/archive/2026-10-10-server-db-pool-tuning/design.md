---
author: flow-machine-draft
created_at: 2026-10-10T14:59:53.677Z
---
# 设计记录（Design Record）— 2026-10-10-server-db-pool-tuning

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

阿里云生产服务器（2 核 / 1.6G 内存）持续 swap 换页导致整机卡顿（vmstat 实测 so 峰值 ~9790 页/s、CPU wa 一度 71%）。根因之一：`backend/app/core/db.py` 连接池写死 `_POOL_SIZE=20 / _MAX_OVERFLOW=30`，SQLAlchemy 池只增不减，postgres 侧常驻 13 个 idle 连接，每个是一个独立 postgres 服务进程，在 1.6G 机器上挤爆内存。

方案：池参数从 `Settings` 新增字段 `db_pool_size` / `db_max_overflow` 读取（pydantic-settings 自动映射环境变量 `DB_POOL_SIZE` / `DB_MAX_OVERFLOW`），代码默认值保持 20/30 不变（开发机/大内存机器行为零变化），由服务器 `.env` 配小值（5/10）适配小规格机器。选择改 Settings 而非 db.py 直接 `os.getenv`，依据 config.py 模块规约「All runtime configuration MUST live here — never read os.environ directly」。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `Settings` 新增两个字段（对外新增，无破坏）：
  - `db_pool_size: int = Field(20, ge=1, description="SQLAlchemy async engine pool_size；小内存服务器可经 DB_POOL_SIZE 调小")`
  - `db_max_overflow: int = Field(30, ge=0, description="SQLAlchemy async engine max_overflow；经 DB_MAX_OVERFLOW 配置")`
- `db.py`：删除模块级常量 `_POOL_SIZE` / `_MAX_OVERFLOW`（`_POOL_TIMEOUT` / `_POOL_RECYCLE` 保留不动），`get_engine()` 内改用 `settings.db_pool_size` / `settings.db_max_overflow`。`get_engine()` 函数签名不变。
- 环境变量名（运维可见契约）：`DB_POOL_SIZE` / `DB_MAX_OVERFLOW`，非法值（非整数 / 越界）在进程启动加载 Settings 时抛 `ValidationError` 显式失败——选显式报错而非静默回退，避免配置错误被掩盖。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   不适用——池参数只在 engine 首次创建时读取一次（`get_engine()` 懒创建 + 全局单例），运行中改环境变量不影响已存在的 engine，行为与现状一致；要生效需重启进程，与现有运维方式（换镜像 `compose up -d`）吻合。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   不适用——无共享可变状态新增；`get_engine()` 的懒创建竞态是既有行为（GIL + 单事件循环场景下现状已如此），本变更不改变其并发语义。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   engine 生命周期不变（进程级单例，`dispose_engine()` 语义不变）。若配置非法，进程在 Settings 加载时即失败（fail fast），不会出现半初始化 engine。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   配置按进程作用域（环境变量/compose `.env`），多实例各自读各自环境，不会串台；postgres 侧总连接上限 = 各实例 (pool_size + max_overflow) 之和，服务器单实例部署下为 DB_POOL_SIZE+DB_MAX_OVERFLOW，当前 `max_connections=100` 远够。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：把服务器池调太小导致高峰期请求排队等连接（`pool_timeout=30s` 后抛超时）。缓解：服务器配 5+10=15 上限，对当前低负载（load 0.29、13 idle 已是历史峰值水位）足够；真不够时改 `.env` 重启即可，无需改代码。放弃的方案：a) 直接把默认值改成 5——会改变开发机/大机器行为，且注释说明 20 是按 multi-agent 负载（daemon websocket + mission 轮询 + worker 回调并发）调的，砍默认值风险大于收益；b) db.py 里 `os.getenv` 直读——违反 config.py 模块规约；c) 非法值静默回退默认——掩盖配置错误，运维难察觉（本仓库 .env 手工维护，错值静默等于埋雷）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | backend/app/core/config.py | Settings 新增 db_pool_size / db_max_overflow 字段 |
| 修改 | backend/app/core/db.py | 删 _POOL_SIZE/_MAX_OVERFLOW 常量，get_engine 改读 settings |
| 新增 | backend/tests/core/test_db_pool_settings.py | 默认值 / 环境变量覆盖 / 非法值三组用例 |
