---
author: qinyi
created_at: 2026-06-20T18:40:00+0800
change: 2026-06-20-ppm-data-migration
---

# 模块影响分析(数据迁移)

> 本次为数据迁移(非功能开发):ETL 脚本 + seed 迁移 bug 修复 + 依赖。不改业务逻辑。

## 影响模块矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容 | needs_review |
|---|---|---|---|---|
| ppm | 配置/修复 | migrations/202607041000_seed_ppm_permissions.py | role_id 列类型 `sa.String`→`postgresql.UUID`(修复 asyncpg 真实 PG 类型不匹配,sqlite 测试未暴露) | false |
| ppm | 格式 | migrations/202607041100_create_ppm_task.py | ruff format | false |
| (unmapped) | 新增(脚本) | backend/scripts/migrate_from_ruoyi.py | 一次性 ETL 脚本:源 MySQL(ruoyi-vue-pro)→目标 PG,体系+ppm 全表,id 幂等映射 | false |
| (基础设施) | 依赖 | backend/pyproject.toml, uv.lock | +pymysql(dev,ETL 读源) | false |

## 未匹配文件
- backend/scripts/migrate_from_ruoyi.py — 一次性迁移脚本,非业务模块(不纳入 _module-map)
- .sillyspec/changes/ — quick 变更文档 + default→ppm-data-migration 改名

## 说明
本次变更不改任何业务模块逻辑,仅:① 数据迁移脚本 ② 修复 seed 迁移在真实 PG(asyncpg)的类型 bug ③ pymysql 依赖。数据已迁入目标 PG(5433 dev docker)。
