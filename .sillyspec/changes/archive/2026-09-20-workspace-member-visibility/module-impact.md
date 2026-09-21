---
author: WhaleFall
created_at: 2026-09-20 18:10:00
---

# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| auth | backend/app/modules/auth/rbac.py | 逻辑变更（has_permission 平台段收紧 + list_user_ids_with_permission 段 2 收窄，签名/结构不变） | 否 |
| workspace | backend/app/modules/workspace/router.py | 逻辑变更（list_workspaces 平台分支收窄，docstring 同步） | 否 |
| workspace | backend/app/modules/workspace/tests/test_platform_grant_list.py | 逻辑变更（断言语义反转 + 三口径一致性） | 否 |
| auth | backend/app/modules/auth/tests/test_rbac_workspace_scope.py | 新增（判定链收紧专项测试） | 否 |
| auth | backend/app/modules/auth/tests/__init__.py | 新增（测试目录包标记，空文件） | 否 |
| workspace | backend/app/modules/workspace/tests/test_archived_write_guard.py | 逻辑变更（task-06 回归：4 用例改成员制授权夹具，断言未动） | 否 |
| workspace | backend/app/modules/workspace/tests/test_workspace_admin_management.py | 逻辑变更（task-06 回归：1 用例断言反转为新语义） | 否 |
| knowledge（NEW:未入 map） | backend/app/modules/knowledge/tests/test_router.py | 逻辑变更（task-06 回归：helper 改成员制授权；该文件同时被并行变更 2026-09-17-knowledge-precipitation 声明） | 是（task-06 已回归确认） |
| notification（NEW:未入 map） | —（不改源码，消费方回归） | 调用关系不变（list_user_ids_with_permission 语义变化自动生效） | 是（task-06 回归确认） |
| —（归档过程产物） | .sillyspec/knowledge/INDEX.md、.sillyspec/knowledge/fr/unmapped.md | 非代码面（archive decision-distill/fr-index 自动生成的知识索引产物） | 否 |

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

- `backend/app/modules/auth/rbac.py` → 归属 auth（map 的 auth paths 未覆盖该文件，索引粒度问题；语义归属明确，见上矩阵）
- `backend/app/modules/workspace/router.py` → 归属 workspace（同上）
- `backend/app/modules/workspace/tests/test_platform_grant_list.py` → 归属 workspace 测试（同上）
- `backend/app/modules/auth/tests/test_rbac_workspace_scope.py` → 归属 auth 测试（新建，见上矩阵）

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| .sillyspec/docs/SillyHub/modules/auth.md | 权限模型段落补记平台级权限收紧语义（工作区内效力=成员∪platform:admin∪is_platform_admin，入口语义保留） | done |
| 模块索引（map） | skipped——无结构变更（无新路径/依赖/入口；notification 模块卡缺是历史扫描基线缺口，留待下次 scan 补录，decisions.md 已按 NEW:notification 声明） | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
