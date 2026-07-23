---
author: qinyi
created_at: 2026-07-18 17:21:00
change: 2026-07-18-ppm-data-scope
---

# 需求:任务计划/问题清单 数据查询范围

> ⚠️ 本需求为人工重写,纠正 sillyspec CLI 自动生成的错误版本。以本版本为准。

## 功能需求

- **FR-1 身份解析**:`data_scope` 解析当前用户 → 超管标记 + 经理项目集(`PpmProjectMember.role_name` 拆分匹配 {部门经理,项目经理,开发经理,业务经理} 的项目 id 集合)。
- **FR-2 任务计划范围过滤**:`/api/ppm/task-plan/page` + `/task-plan/export-excel` 按身份过滤——超管全部;经理=经理项目集的全部任务;其余=`user_id==自己`。多项目并集。
- **FR-3 问题清单范围过滤**:`/api/ppm/problem-list` + `/problem-list/export-excel` 按身份过滤——超管全部;经理=经理项目集的全部问题;其余=自己是 `duty_user_id`/`audit_user_id`/`now_handle_user`(拆分)任一。
- **FR-4 部门经理同项目经理**:`role_name` 含"部门经理" → 同 FR-2/3 经理逻辑(不碰组织表)。
- **FR-5 多项目并集**:用户是多个项目的经理 → 看这些项目全部任务的并集,再 ∪ 自己负责的。

## 非功能需求

- **NFR-1**:SQLite(测试)/ PostgreSQL(生产)方言兼容(`in_(set)` 两端可用,`now_handle_user` 应用层 split 避免方言差异)。
- **NFR-2**:无新表、无新字段、无 migration。
- **NFR-3**:前端零改动,后端过滤对前端透明。
- **NFR-4**:数据范围与功能权限正交(`require_permission_any(PPM_TASK_READ/PPM_PROBLEM_READ)` 保留)。

## 验收标准(详见 design.md §6 AC-1~9)

- AC-1 超管全部 / AC-2 经理看相关项目全部(含非自己负责) / AC-3 经理在普通成员项目只看自己 / AC-4 其余只看自己负责 / AC-5 部门经理同项目经理 / AC-6 开发经理·业务经理同 / AC-7 导出同步过滤 / AC-8 project_id NULL 仅负责人+超管 / AC-9 多项目并集。

## 约束

- 文档驱动(design + decisions D-001~D-011 + 本 requirements + plan)。
- 后端改完 curl 实测端点(CONVENTIONS.md)。
- **无 alembic 操作**(D-008)。
- `test_strategy: module`;测试 `cd backend && uv run pytest -q --no-cov`。
- 提交 hook 不跳过(CONVENTIONS.md 双层 hook:ruff + claude PreToolUse mypy/frontend)。
