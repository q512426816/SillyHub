---
author: flow-machine-draft
created_at: 2026-10-10T14:59:53.677Z
---
# 需求规格（Requirements）— 2026-10-10-server-db-pool-tuning

## 功能需求

### FR-01: db.py 的 pool_size/max_overflow 从 DB_POOL_SIZE/DB_MAX_OVERFLOW 环境变量读取，未配置时默认值 20/30 保持现行为不变

- 连接池大小与溢出上限必须可经环境变量 `DB_POOL_SIZE` / `DB_MAX_OVERFLOW` 配置（走 `Settings` 字段，遵守 config.py「运行时配置必须集中在 Settings、禁止直接读 os.environ」的仓库约定），未配置时默认值必须保持 20 / 30，与现行为完全一致。

#### 场景：主路径（未配置环境变量）

- Given 运行环境未设置 `DB_POOL_SIZE` / `DB_MAX_OVERFLOW`
- When backend 进程启动并首次创建 async engine
- Then engine 的 `pool.size() == 20`、`pool.max_overflow == 30`（与现状一致）

#### 场景：小规格服务器配置小池

- Given 服务器 `.env` 配置 `DB_POOL_SIZE=5`、`DB_MAX_OVERFLOW=10`
- When backend 进程启动并首次创建 async engine
- Then engine 的 `pool.size() == 5`、`pool.max_overflow == 10`，postgres 侧 platform 用户连接数上限为 15

### FR-02: 环境变量配置非法值（非整数）时行为可预期（用默认值并记录警告，或显式报错，实现内注明）

- 环境变量配置非法值（非整数、超出取值约束 `pool_size>=1` / `max_overflow>=0`）时必须显式报错（pydantic `ValidationError`，进程启动即失败），禁止静默回退默认值掩盖配置错误。实现选择「显式报错」路线并在字段 description 中注明。

#### 场景：非法值启动失败

- Given 环境变量 `DB_POOL_SIZE=abc`
- When 进程加载 `Settings`
- Then 抛出 `ValidationError`（类型/约束校验失败），错误信息包含字段名

### FR-03: 新增单元测试覆盖：默认值、环境变量覆盖生效、（如选静默回退）非法值回退

- 必须新增单元测试文件覆盖三组行为：默认值（20/30）、环境变量覆盖生效（engine 实际 pool 参数）、非法值显式报错。本变更选择显式报错路线，故第三组断言 `ValidationError` 而非回退。

#### 场景：主路径

- Given 测试文件 `backend/tests/core/test_db_pool_settings.py`
- When 运行 `pytest backend/tests/core/test_db_pool_settings.py`
- Then 全部用例通过，覆盖上述三组行为

### FR-04: 既有相关测试全部通过

- 本变更涉及 `config.py`（仅新增字段，不改既有字段）与 `db.py`（常量改读 settings），既有测试必须全部通过，禁止为通过测试修改既有断言。

#### 场景：主路径

- Given 本变更的代码改动
- When 运行 `backend/tests/core/` 全目录测试（配置与核心层相关面）
- Then 全部通过，无回归

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/backend/tests/core/test_db_pool_settings.py「test_default_pool_values」「test_env_override_engine_pool_params」
FR-02: test/backend/tests/core/test_db_pool_settings.py「test_invalid_pool_value_raises」
FR-03: test/backend/tests/core/test_db_pool_settings.py（整文件三组用例即本 FR 交付物）
FR-04: test/backend/tests/core/「目录级回归——config/db 相关既有用例全绿」
