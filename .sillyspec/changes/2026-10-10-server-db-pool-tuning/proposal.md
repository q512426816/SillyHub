---
author: flow-machine-draft
created_at: 2026-10-10T14:59:53.677Z
---
# 提案书（Proposal）— 2026-10-10-server-db-pool-tuning

## 动机

任务原话转写：阿里云生产服务器(2核1.6G)内存不足持续swap换页导致整机卡顿，根因之一是backend数据库连接池写死pool_size=20/max_overflow=30，postgres常驻13个idle连接吃内存。连接池大小改为环境变量可配（DB_POOL_SIZE/DB_MAX_OVERFLOW），代码默认值保持不变，由服务器.env配小值适配小规格机器。
成功标准：
- db.py 的 pool_size/max_overflow 从 DB_POOL_SIZE/DB_MAX_OVERFLOW 环境变量读取，未配置时默认值 20/30 保持现行为不变
- 环境变量配置非法值（非整数）时行为可预期（用默认值并记录警告，或显式报错，实现内注明）
- 新增单元测试覆盖：默认值、环境变量覆盖生效、（如选静默回退）非法值回退
- 既有相关测试全部通过

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. db.py 的 pool_size/max_overflow 从 DB_POOL_SIZE/DB_MAX_OVERFLOW 环境变量读取，未配置时默认值 20/30 保持现行为不变
2. 环境变量配置非法值（非整数）时行为可预期（用默认值并记录警告，或显式报错，实现内注明）
3. 新增单元测试覆盖：默认值、环境变量覆盖生效、（如选静默回退）非法值回退
4. 既有相关测试全部通过

## 成功标准（可验证）

1. db.py 的 pool_size/max_overflow 从 DB_POOL_SIZE/DB_MAX_OVERFLOW 环境变量读取，未配置时默认值 20/30 保持现行为不变
2. 环境变量配置非法值（非整数）时行为可预期（用默认值并记录警告，或显式报错，实现内注明）
3. 新增单元测试覆盖：默认值、环境变量覆盖生效、（如选静默回退）非法值回退
4. 既有相关测试全部通过
