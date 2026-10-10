---
author: flow-machine-draft
created_at: 2026-10-10T14:59:53.677Z
---
# 任务注册表（Tasks）— 2026-10-10-server-db-pool-tuning

- [x] task-01: config.py Settings 新增 db_pool_size(默认20,ge=1) / db_max_overflow(默认30,ge=0) 字段（走 Field+description，环境变量 DB_POOL_SIZE/DB_MAX_OVERFLOW 自动映射）——验证：`pytest backend/tests/core/test_db_pool_settings.py` 默认值用例绿
- [x] task-02: db.py 删 _POOL_SIZE/_MAX_OVERFLOW 常量，get_engine() 改读 settings.db_pool_size/db_max_overflow——验证：engine pool 参数用例绿 + ruff 无告警
- [x] task-03: 新增 backend/tests/core/test_db_pool_settings.py 覆盖默认值 / 环境变量覆盖生效(engine.pool.size()==5) / 非法值 ValidationError 三组——验证：该文件 pytest 全绿
- [x] task-04: 跑 backend/tests/core/ 目录回归确认无既有测试破坏——验证：目录 pytest 全绿
- [ ] task-05: 部署到阿里云：本地打包 backend 镜像 → scp → 服务器 .env 加 DB_POOL_SIZE=5/DB_MAX_OVERFLOW=10 → load-and-up → 验证 postgres 连接数 ≤6 且 5 容器 healthy
