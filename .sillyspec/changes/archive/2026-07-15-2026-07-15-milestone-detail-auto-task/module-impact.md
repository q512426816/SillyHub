---
author: WhaleFall
created_at: 2026-07-15T22:05:00
---

# 模块影响分析（Module Impact）— 里程碑明细提交自动创建任务计划

## 影响矩阵
| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|---|---|---|---|---|
| ppm（backend plan 子域） | 逻辑变更 | `backend/app/modules/ppm/plan/service.py` | 新增 6 联动 helper（`_ensure_task_for_detail`/`_sync_task_fields`/`_migrate_task_to_version`/`_unlink_task`/`_resolve_project_context`/`_lookup_user_name`）+ 5 触发点接入（明细 done 自动建 PlanTask，强一致同事务）；`create_detail`/`update_detail`/`delete_detail` 重构为原子事务；导入多责任人拆分（`_to_preview_row`→`_to_preview_rows`） | false |
| ppm（backend plan 测试） | 新增/逻辑变更 | `backend/app/modules/ppm/plan/tests/test_detail_task_link.py`（新增）；`conftest.py`；`test_router.py` | 联动单测 10 用例（FR-01~07）；conftest 注册 `ppm.project` model（联动依赖 `PpmProjectMember`）；test_router 加导入多责任人拆分测试 + status 断言适配既有逻辑 | false |
| frontend_app（ppm 页面） | 逻辑变更 | `frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx`；`frontend/src/app/(dashboard)/ppm/task-plans/page.tsx` | 明细提交成功 toast「已自动创建任务计划」；任务计划列表删除按钮放开给超级管理员 | false |

## 未匹配文件
无。所有改动文件均落在 ppm 模块（backend plan/task 子域 + frontend ppm 页面），无跨模块扩散。

## 三重交叉验证
- **声明范围**（design.md §6 文件清单）：service.py + test_detail_task_link.py + milestone-details/page.tsx — 与实际一致
- **任务范围**（plan.md task-01~09）：覆盖 service.py / 测试 / 前端 toast
- **真实变更**（git）：service.py + 3 测试文件 + 2 前端页面
三者一致。注：导入拆分（ql-014，service `_to_preview_rows` + test_router）+ 超管删除（ql-015，task-plans/page.tsx）为 design 后 quick 增强，已纳入本次归档范围。

## 模块文档同步建议
- `ppm.md`（docs/SillyHub/modules/ppm.md）：已在 ql-014 quick 阶段追加变更索引；建议在「关键逻辑」章节补一条「明细 done → 自动建 PlanTask（强一致同事务，版本链查重）」契约摘要。
- 不影响其他模块文档（auth/task/kanban 子域仅读 PlanTask，无契约变更）。

## 无 schema / API 契约变更
- 复用 `ppm_plan_task.ps_plan_node_detail_id`（既有字段），无表结构变更、无 migration
- plan/task 路由契约不变（联动在 service 内部触发，HTTP 入口签名不动）
