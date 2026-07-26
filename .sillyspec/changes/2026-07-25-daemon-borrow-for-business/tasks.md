---
author: qinyi
created_at: 2026-07-25 21:21:12
---

# 任务清单（Tasks）— daemon-borrow-for-business

> 本清单为 brainstorm 阶段**粗粒度骨架**（对应 6 Phase）。详细 Wave/Task 拆分、依赖关系、验收点在 plan 阶段展开（`sillyspec run plan --change 2026-07-25-daemon-borrow-for-business`）。

## W1: 数据模型 + 共享授权（Phase 1）
- task-01: `workspace_member_runtimes` 加 `shared` 列 + 部分索引（`member_runtimes/model.py`）+ 迁移
- task-02: `daemon_borrow_audit` 新表 + 迁移
- task-03: lender 标记/撤销 shared 端点（`PUT /my-binding/shared`）+ owner 查询/撤销端点（`GET /shared-daemons`）

## W2: 权限模型（Phase 2）
- task-04: `DAEMON_BORROW` 权限点（`auth/permissions.py`）+ group 分支
- task-05: `business_member` 角色 + 权限种子迁移（`task:run_agent` + `daemon:borrow` + workspace 读）+ `members_service.py:42` `ROLE_KEY_WHITELIST` 加 `business_member`
- task-06: grant 后 `invalidate_all_permissions` 对齐 `rbac-permission-cache`

## W3: 派发链路（Phase 3，核心）
- task-07: 新建 `agent/borrow_resolver.py`（`resolve_shared_daemon_for_borrow` + `_resolve_borrowed_or_own_runtime` helper）
- task-08: `placement._resolve_dispatch_runtime` 接入 helper（690-807）
- task-09: `placement._resolve_decide_runtime` 接入 helper（855-944）
- task-10: `workspace/member_runtimes/resolver.resolve_runtime_for_writeback` 接入 helper（59-150）
- task-11: `placement.prepare_interactive_dispatch._get_online_runtime` 借用接入（408，R-07 spike：改造 vs 前置解析）

## W4: daemon 沙箱隔离（Phase 4）
- task-12: borrow lease 独立 sandbox 目录（mirror by slug=`borrow-<actor>-<run>`，塞 lease `rootPath`）
- task-13: PolicyEngine 按 lease 隔离只读 policy（候选 B 主路径，`session-manager.ts:1037-1102`）

## W5: 方案落点（Phase 5）
- task-14: 借用 agent run 完成回调（`close_interactive_run` / `complete_lease`）落 `FileService.upload_file`
- task-15: 确认 `text/markdown` 白名单（R-04）+ `owner_type=workspace` 关联
- task-16: 写 `daemon_borrow_audit`（FR-07）

## W6: 前端（Phase 6）
- task-17: lender 工作空间设置"共享我的 daemon"开关
- task-18: owner 成员/设置页：共享 daemon 列表 + 撤销 + 授 business_member 角色
- task-19: 业务人员触发 agent（无感，复用现有）+ 文件中心/工作台看方案

## W7: 验证
- task-20: 单测（4 路 resolver / 借用查询三重校验 / 写边界 / 审计）
- task-21: 跨变更对齐核查（`rbac-permission-cache` / `llm-provider-management` / `platform-file-center`）

---

**关键路径**：task-01 → task-07 → task-08/09/10/11（4 路一致）→ task-12/13（沙箱）→ task-14（落点）→ task-20（验证）。

**待 plan spike**：R-07（task-11 接入方式）/ R-09（候选 A 独立 runtime_id 可选）/ R-04（白名单）。
