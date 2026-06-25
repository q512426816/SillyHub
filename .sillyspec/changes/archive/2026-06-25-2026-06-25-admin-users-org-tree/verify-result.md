---
author: WhaleFall
created_at: 2026-06-25T20:34:50
---

# 验证报告 — 2026-06-25-admin-users-org-tree

## 结论

**PASS**（风险等级 contract-required，HTTP 端到端测试覆盖契约；无 test debt）

## 任务完成度

| Task | 描述 | 状态 | 证据 |
|---|---|---|---|
| task-01 | 后端 schema OrganizationRead+subtree_member_count | ✅ | schema.py:160 |
| task-02 | organizations_service _subtree_member_count | ✅ | organizations_service.py:100,122,133 |
| task-03 | list_users exists 子查询过滤 | ✅ | users_service.py:29(exists),37(_descendant_ids),96,113-124 |
| task-04 | router Query 透传 | ✅ | router.py:353-354,365-366 |
| task-05 | 后端测试 6 组织过滤用例 | ✅ | test_users_router.py 6 def test_*org |
| task-06 | 前端 lib 类型 | ✅ | admin.ts:74 organization_id, :231 subtree_member_count |
| task-07 | admin-org-tree 组件 | ✅ | admin-org-tree.tsx buildOrgTree/onExpand/expandedKeys |
| task-08 | drawer defaultOrganizationIds | ✅ | admin-user-drawer.tsx:30,49,80,83 |
| task-09 | users page 左树右表 | ✅ | page.tsx:79 selectedOrgId,417 aside w-64,419 AdminOrgTree,430 当前筛选,514 defaultOrganizationIds |
| task-10 | 前端测试 | ✅ | admin-org-tree.test.tsx 8 + admin-user-drawer.test.tsx +3 |
| task-11 | 集成验证+部署 | ✅ | backend+frontend Docker healthy |

完成率 **11/11**。

## 设计一致性

design.md Phase 0-7 与实现全一致（execute Step 10 已验，verify Step 4 探针确认）。

## 探针结果

- **未实现标记扫描**：变更文件无 TODO/FIXME/HACK/XXX ✅
- **关键词覆盖**：organization_id/subtree_member_count/org tree/expand/filter 全覆盖 ✅
- **测试覆盖**：backend test_users_router 6 org 用例 + frontend admin-org-tree 8 + drawer 3 ✅
- **决策追踪覆盖**：D-001~005→FR→task 全闭环 ✅
- **API Contract Parity**：前端 lib/admin.ts:74 `organization_id?` ↔ 后端 router.py:353 `organization_id Query(None)` parity ✅，无 contract gap

## 决策追踪矩阵

| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-03,04 | task-07,09 | include_children 固定 true（page.tsx load 传 include_children:true 无 state） | PASS |
| D-002@v1 | FR-03 | task-07 | buildOrgTree filter status==='active'（admin-org-tree.tsx:34） | PASS |
| D-003@v1 | FR-02 | task-01,02 | _subtree_member_count distinct user_id（organizations_service.py:100） | PASS |
| D-004@v1 | FR-01 | task-03 | exists 子查询无 join 无重复（users_service.py:113-124） | PASS |
| D-005@v1 | FR-02 | task-02 | 实时算不缓存（_to_read 每次调 _subtree_member_count） | PASS |

## 测试结果

- backend pytest admin/auth：**175 passed, 5 xfailed**（5 xfail 属 username-login 既有 task-03/05 预留）
- backend ruff（admin 模块）：All checks passed
- backend mypy（admin 模块 8 文件）：no issues found
- frontend vitest（admin.test + admin-org-tree + admin-user-drawer）：**59 passed**（35+8+16）
- frontend tsc --noEmit：no errors
- frontend lint：变更文件无 warning

## 技术债务

- 变更文件无 TODO/FIXME/HACK/XXX
- task 蓝图 checkbox 未回填（execute 子代理实现后未勾，流程遗漏非功能缺失）
- 5 xfail 属 username-login task-03/05 预留（友好 409 透传 + refresh grace），非本次引入

## 变更风险等级

**contract-required**

判定依据：本变更新改 Pydantic schema DTO（OrganizationRead +subtree_member_count、UserQueryParams +organization_id/include_children）+ API query 参数 + 前端 API client（lib/admin.ts listUsers），属 API contract/DTO 改动。未触及 session/lease/agent_run 状态机、未涉及 daemon、未改 deployment 启动路径。

contract test 证据：test_users_router.py 6 组织过滤用例（HTTP 端到端：全部/叶子/父含子/distinct 去重/叠加/不含子）+ admin-org-tree.test.tsx 8 用例。

## Runtime Evidence

contract-required 非强制 Runtime Evidence。补充集成证据：
- /api/admin/users 组织过滤：test_users_router.py HTTP 端到端验证（client.get + params organization_id/include_children + 断言 items/total）
- backend+frontend Docker rebuild healthy（http://127.0.0.1:8000/api/health + http://127.0.0.1:3000/api/health 返回 {"status":"ok"}）

## 代码审查

- exists 子查询干净（无 join 无 group_by，total 天然正确）
- buildOrgTree visited Set 防环（design R-04）
- ORM 参数化无 SQL 注入
- organization_id 默认 None 向后兼容（settings/router.py:125 调用不破坏）
- orgNodeTitle name min-w-0 flex-1 truncate + count shrink-0（文字截断不溢出）
- expandedKeys state 受控 + onExpand（可展开/收起）
- Tree maxHeight + overflow-y-auto（纵向滚动）

总体：实现质量良好，符合设计 D-001~005，测试充分。

## 下一步

- PASS → 可运行 `sillyspec run archive` 归档
