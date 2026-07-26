---
author: qinyi
created_at: 2026-07-26 11:58:00
change: 2026-07-25-daemon-borrow-for-business
---

# 模块影响分析（Module Impact）— 业务人员借用开发人员 daemon 读源码出业务方案

## 变更范围

业务/管理人员（business_member）借用工作空间里开发人员共享的 daemon，跑 agent 读源码出业务方案，落文件中心。涉及 backend（数据模型+权限+4 路 resolver 借用+落 file+审计）、sillyhub-daemon（借用沙箱只读隔离）、frontend（共享开关+管理+方案查看）三端。

文件清单来源：`git diff --name-only 1686a208 HEAD`（变更基线 1686a208 → HEAD 30ae305e），与 design.md「实现产出全清单」一致。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|-------------|
| backend | 数据结构变更 | `workspace/member_runtimes/model.py`（+shared 列+部分索引）、`agent/model.py`（+DaemonBorrowAudit 表）、迁移 `202607251400/500/600`（shared 列+审计表+business_member 角色种子，renumber 自 1100/1200/1300 解碰撞 ql-001） | workspace_member_runtimes 加 shared bool；新增 daemon_borrow_audit 表；新增 business_member 角色 + daemon:borrow 权限 | false |
| backend | 逻辑变更 | `agent/borrow_resolver.py`（新）、`agent/placement.py`（4 路 resolver 接入）、`workspace/member_runtimes/queries.py`（resolve_shared_daemon_for_borrow）、`workspace/member_runtimes/resolver.py`（writeback 接入） | 4 路派发（dispatch/decide/writeback/interactive）收敛到 _resolve_borrowed_or_own_runtime helper，先自有零回归无则借用三重校验 | false |
| backend | 逻辑变更 | `agent/service.py`（persist_borrow_run_output 落 file+审计 usage）、`daemon/run_sync/service.py`（close_interactive_run 钩子） | 借用 run 完成回调落 FileService（owner_type=workspace）+ 审计 usage | false |
| backend | 接口变更 | `workspace/member_runtimes/router.py`+`service.py`（PUT /my-binding/shared + GET /shared-daemons）、`file/router.py`+`service.py`（GET /api/file/list）、`auth/permissions.py`（DAEMON_BORROW+daemon group）、`workspace/members_service.py`（ROLE_KEY_WHITELIST+business_member）、`core/config.py`（text/markdown 白名单） | lender 共享/撤销端点、owner 管理端点、方案文件列表端点、权限点+角色白名单、markdown 白名单 | false |
| backend | 测试 | `agent/tests/test_borrow_resolver.py`、`test_placement_borrow_integration.py`、`test_borrow_run_output.py`、`test_daemon_borrow_audit_model.py`、`tests/modules/workspace/test_member_runtimes*.py`、`test_members_service_business_member.py`、`test_migration_borrow_shared.py`、`tests/modules/auth/test_business_member_role.py`、`test_permissions.py`、`file/tests/test_file_api.py` | 4 路一致性/借用三重校验/落 file/审计/迁移元数据全覆盖（198 测试绿） | false |
| sillyhub-daemon | 逻辑变更 | `src/daemon.ts`（borrow-sandbox: marker 检测→prepareWorkspace 独立 cwd+登记）、`src/interactive/session-manager.ts`（registerBorrowSandbox+写守卫按 lease 隔离只读 root，绕过 lender runtime 缓存 R-02） | 借用 lease 独立沙箱目录 + PolicyEngine 按 lease 隔离只读，借用 agent 不可写开发代码区 | false |
| sillyhub-daemon | 测试 | `tests/daemon-borrow-sandbox.test.ts`、`tests/interactive/session-manager-borrow-sandbox.test.ts` | 沙箱 cwd + 写边界 deny（12 passed） | false |
| frontend | 新增/接口变更 | `components/workspace/shared-daemon-{manager,toggle}.tsx`、`components/agent/borrowed-solution-files{,-panel}.tsx`、`lib/workspace-binding.ts`（canBorrow+共享端点封装）、`lib/file/api.ts`（listFiles）、`workspaces/[id]/{page,members/page,agent/page,files/page}.tsx`、`components/workspace-member-row.tsx`（business_member 选项） | lender 共享开关、owner 管理、业务触发无感、方案查看、角色选项 | false |
| frontend | 测试 | `shared-daemon-{manager,toggle}.test.tsx`、`borrowed-solution-files{,-panel}.test.tsx`、`borrow-trigger-contract.test.ts`、`workspace-binding.test.ts`、`workspace-member-row.test.tsx`、`agent/__tests__/page.test.tsx` | 组件+触发契约测试（31 passed） | false |

## 未匹配文件

| 文件 | 说明 |
|------|------|
| `meta.json` | sillyspec 任务元数据（工具生成），非业务代码 |
| `sillyhub-daemon/src/cli.ts`、`config.ts`、`spawn-env.ts` | **属同期变更 13fc1dc9（ql-002 spawn claude CLAUDE_CONFIG_DIR 隔离），非本变更范围**，因 git diff 区间 1686a208→HEAD 包含而被列出，不计入本变更模块影响 |

## needs_review 说明

所有命中模块 needs_review=false：变更范围明确（borrow 全链路），三重交叉验证（design 声明 / plan 任务 / git diff 真实）一致，198 测试 + mypy/ruff/tsc 全绿，verify PASS WITH NOTES（仅遗留真实多组件部署 e2e，本项目惯例）。
