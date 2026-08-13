---
author: qinyi
created_at: 2026-08-13 17:45:00
change: 2026-08-13-fix-platform-progress-pk
---

# 模块影响分析（Module Impact）— platform_change_progress 主键缺陷修复

## 变更范围

修复 `platform_change_progress` 表 change_name 单主键缺陷：加 id UUID 主键 + change_name 去主键 + 保留 (workspace_id, change_name) 复合唯一。跨 workspace 同名可共存、NULL 历史行不再挡道。5 task，commit 5d91204d（代码）。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|--------------|
| backend / platform_sync 子模块 | 数据结构变更 | backend/app/modules/platform_sync/model.py | `PlatformChangeProgressORM` 加 id UUID 主键（default=uuid.uuid4）+ change_name 去 primary_key 降普通列 + 保留复合唯一（D-001/D-002） | false |
| backend / platform_sync 子模块 | 数据结构变更 + 数据迁移 | backend/migrations/versions/20260813170000_platform_change_progress_id_pk.py | 新增 migration：batch_alter_table 改主键 + op.get_bind 回填 uuid4 + dialect 分支；revision 20260813170000（调开避免撞 platform-managed 的 20260813160000）+ down_revision 指向前者收敛单 head | false |
| backend / platform_sync 子模块 | 逻辑变更 | backend/app/modules/platform_sync/service.py | upsert INSERT 加 id=uuid.uuid4() + IntegrityError 回退注释适配（冲突源改复合唯一） | false |
| backend / platform_sync 子模块 | 逻辑变更 + 测试 | backend/app/modules/platform_sync/tests/{test_router,test_pk_semantics}.py | 修 test_apply_catches（真实 workspace UUID 触发回退）+ 新增 test_pk_semantics 4 用例（跨 workspace 同名 / NULL 共存 / migration 回填 / revision chain） | false |
| backend / platform_sync 子模块 | 文档 | backend/app/modules/platform_sync/__init__.py | docstring 更新（id 主键 + 复合唯一） | false |
| backend / change 子模块 | 调用关系（只读回归） | backend/app/modules/change/tests/* | `_project_current_stage` 复合键只读 join 不受主键影响（零改动），回归 43 passed | false |
| 模块文档 | 文档同步 | .sillyspec/docs/backend/modules/platform_sync.md | 主键描述更新 + 变更索引加本 change | false |

## 未匹配文件

无。7 个代码/文档文件均匹配 backend platform_sync 子模块 + change 回归 + 模块文档。

## 三重交叉验证

- **声明范围**（design.md §6 文件清单）：model / migration / service / __init__ / tests / 模块文档
- **任务范围**（plan.md task-01~05）：同上
- **真实变更**（commit 5d91204d）：7 文件与声明一致
- **一致性**：真实 = 声明。零 API 变更（D-004，无 gen:types）。

## 备注

- `pending_review` 消费链（change 模块 `_project_current_stage` 复合键 IN join）零影响——只读 latest_progress，不依赖 change_name 主键。
- migration revision 调整：原 20260813160000 与 platform-managed-file-sync 撞车，改 20260813170000 + down_revision 指向前者（跨 change 依赖，主仓已有父 migration）。
- downgrade NotImplementedError（跨 workspace 同名合法后无法恢复单主键），对齐 precedent。
