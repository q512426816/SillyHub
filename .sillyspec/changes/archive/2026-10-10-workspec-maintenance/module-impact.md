---
author: qinyi
created_at: 2026-10-10 19:20:00
change: 2026-10-10-workspec-maintenance
version: 2（archive 终审——以 worktree 分支 commit 393186cd4 的 26 文件 diff 为准复核；provider_caps.py/provider-caps.ts 为 gen 脚本行尾幻影（零 hunk），不入矩阵）
---

# 模块影响分析（Module Impact）— 2026-10-10-workspec-maintenance

> 模块 ID 取自 `.sillyspec/docs/multi-agent-platform/modules/_module-map.yaml`（根视角）。
> 基准：worktree 分支 `sillyspec/2026-10-10-workspec-maintenance`（HEAD 393186cd4）。

## 影响矩阵

| 模块 ID | 触及文件 | 影响类型 | 需要的文档动作 | 更新结果 |
|---|---|---|---|---|
| backend | backend/app/modules/workspace/linked_repos/（新子模块 8 文件：model/schema/service/router/__init__×2/conftest/test）、backend/app/modules/daemon/linked_repos_sync.py（新）、backend/app/modules/daemon/tests/test_linked_repos_sync.py（新）、backend/app/modules/daemon/router/machines.py、backend/app/modules/daemon/router/__init__.py、backend/app/main.py、backend/migrations/versions/20261010190000_create_workspace_linked_repos.py、backend/openapi.json | 新增能力（三表+六端点+RPC 编排+回报端点；main.py sibling 挂载；_ENDPOINT_ORDER 登记） | backend 模块卡片补「关联仓」契约段；_module-map main_symbols 补 linked_repos 子模块与 linked_repos_sync | done |
| sillyhub-daemon | sillyhub-daemon/src/linked-repos-sync.ts（新）、src/protocol.ts（未改——平名注册零协议改动）、src/daemon.ts、src/hub-client.ts、src/sillyspec-manager.ts、tests/linked-repos-sync.test.ts（新） | 新增能力（linked_repos_sync RPC handler + 双落盘例程 + 回报方法 + bin 解析导出） | daemon 模块卡片 main_symbols 补 runLinkedReposSync/postLinkedReposSyncResult；_module-map 同步 | done |
| frontend | frontend/src/components/workspace/linked-repos-card.tsx（新）、linked-repos-form.tsx（新）、__tests__/linked-repos-card.test.tsx（新）、frontend/src/lib/linked-repos.ts（新）、frontend/src/lib/api-types.ts（再生成）、frontend/src/app/(dashboard)/workspaces/[id]/page.tsx | 新增 UI（工作区详情「关联仓」卡片，双主题） | frontend 模块卡片 main_symbols 补 LinkedReposCard；_module-map 同步 | done |

## 未匹配文件

| 文件 | 原因 | 处置 |
|---|---|---|
| backend/migrations/versions/20261010190000_create_workspace_linked_repos.py | 迁移产物目录按惯例不进模块卡 | 已并入 backend 模块行覆盖，卡片动作不需要 |
| .sillyspec/changes/2026-10-10-workspec-maintenance/prototype-workspace-linked-repos.html | 变更目录产物，归 prototype 模块惯例 | archive 后由 prototype 模块入口收录，本次无卡片动作 |

## 备注

- 本变更不动 sillyspec 工具仓（零工具侧改动，D-008）——`workspace add` / `register-repo`
  仅作为被 spawn 的外部命令消费。
- verify 阶段 reconcile 曾把主仓并行演进（borrow-sandbox / live-token-speed 等 21 文件）
  误圈为 undeclared（warning 不阻断）——工具口径缺陷已按 CLAUDE.md 规则 15 记录至
  docs/sillyspec/（见「docs/sillyspec 工具缺陷记录」行，archive 提交一并入库）。
