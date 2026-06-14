---
author: qinyi
created_at: 2026-06-14 23:50:00
---

# Verify Result — Agent Runtime Selection

> 变更：`2026-06-14-agent-runtime-selection`
> 阶段：verify（QA 视角验收）
> 对照：design.md §6/§7/§10 + requirements.md FR-01~FR-08 + proposal.md 成功标准 1-6
> worktree：`.sillyspec/.runtime/worktrees/2026-06-14-agent-runtime-selection/`

## 1. 验收基线

- 功能需求 FR-01~FR-08（requirements.md）
- 成功标准 1-6（proposal.md）
- 文件清单 design.md §6.1（后端）/ §6.2（前端）/ §6.3（daemon 无改动）
- 接口签名 design.md §7
- 风险登记 R-01~R-06（design.md §10）

## 2. 功能需求验收

| FR | 需求 | 代码证据 | 测试证据 | 结论 |
|---|---|---|---|---|
| FR-01 | Workspace 持久化 default_agent（PATCH null=清空 / 省略=不变） | `workspace/model.py:84` default_agent 列；`workspace/schema.py` Create L94 / Update L135（exclude_unset）/ Read L169 | `test_schema_default_agent.py` | ✅ |
| FR-02 | provider 解析优先级（显式 > workspace.default_agent > None） | `agent/service.py` 三入口 resolved_provider L291/678/903 | `test_service_provider.py` | ✅ |
| FR-03 | placement 严格匹配 + 无在线回退 + 告警 | `agent/placement.py:285` `_get_online_runtime(provider)`；L310 `log.warning("placement_provider_fallback", wanted, actual)` | `test_placement_fallback.py` | ✅ |
| FR-04 | 自动调度链路内部读 default_agent | `start_stage_dispatch` 内部 resolved_provider（L678），dispatch.py 自动调度无需改入参 | `test_service_provider.py` stage 分支 | ✅ |
| FR-05 | task 触发显式 provider | `agent/schema.py:21` AgentRunCreate.provider；`router.py:245` 透传；前端 `tasks/[tid]/page.tsx:250` createAgentRun 透传 | `test_schema_provider.py` | ✅ |
| FR-06 | 手动 stage dispatch / scan-generate 显式 provider | `change/dispatch.py:500/653` provider；`start_scan_dispatch` provider；前端 stageProvider / scanProvider | `test_dispatch_provider.py` 3 用例 + `test_scan_provider.py` 4 用例 | ✅ |
| FR-07 | 前端设置页默认 agent 下拉 | `AgentProviderSelect.tsx`（distinct online provider + PROVIDER_META + 离线标注）；`workspaces/[id]/page.tsx:473` + handleSaveDefaultAgent L137 | 编译覆盖 | ✅ |
| FR-08 | 触发面板下拉默认联动 | `workspaces.ts` Workspace.default_agent；task/stage/scan 面板状态默认 null（跟随 workspace.default_agent） | 编译覆盖 | ✅ |

## 3. 成功标准验收（proposal.md）

| # | 成功标准 | 验收 | 结论 |
|---|---|---|---|
| 1 | 旧配置行为不变（default_agent=NULL 时维持现状） | FR-02 第三块 + `_get_online_runtime(provider=None)` 走 ORDER BY last_heartbeat；test 覆盖 | ✅ |
| 2 | 默认 agent 生效（设 claude → 分发命中 claude） | resolved_provider 解析 + placement 严格匹配；test_service_provider + test_placement_fallback | ✅ |
| 3 | 显式覆盖（触发传 codex 覆盖默认 claude） | FR-02 显式 > 默认；test 覆盖 | ✅ |
| 4 | 回退不失败（指定 provider 离线 → 跨 provider 回退 + 告警） | FR-03；test_placement_fallback | ✅ |
| 5 | 前端可用（设置页 + 触发面板下拉） | typecheck exit 0 + next build exit 0；FR-07/08 | ✅ |
| 6 | daemon 零 diff | `git status` worktree 无 daemon 文件改动（design §6.3） | ✅ |

## 4. 非功能验收

- **兼容性**：新增列 nullable、API 字段全可选；`default_agent=NULL` 行为与变更前一致 ✅
- **可回退**：provider 离线回退不失败（除完全无在线 runtime）；告警可观测 ✅
- **可观测**：`placement_provider_fallback` 带 wanted/actual ✅
- **性能**：无新索引（点查 by workspace id）；回退仅多一次查询 ✅
- **数据安全**：项目未上线可清库（规则 7）✅

## 5. 测试证据

- 后端 `uv run pytest -q`（worktree/backend）：**1056 passed, 7 skipped**。7 skip 与本变更无关（scan_dispatch `_post_scan_reparse` 未实现 6 个 + Windows 路径 1 个）。
- 本变更新增 6 个测试文件：`test_placement_fallback.py` / `test_schema_default_agent.py` / `test_schema_provider.py` / `test_service_provider.py` / `test_dispatch_provider.py` / `test_scan_provider.py`，覆盖 FR-01~FR-06。
- 前端 `pnpm exec tsc --noEmit`（worktree/frontend）：**exit 0**；`next build`：**exit 0**。
- 质量门禁：`ruff check`（7 文件）All checks passed；`mypy`（placement/service/model）Success no issues。

## 6. QA 发现与风险

### 发现 1（信息性，已澄清）— migration 文件名 revision 偏差
design.md §6.1 列 `backend/app/migrations/versions/202606141200_add_workspace_default_agent.py`，实际文件 `backend/migrations/versions/202606280900_add_workspace_default_agent.py`。
- **落地确认**：migration 文件存在且完整（alembic `op.add_column("workspaces", Column("default_agent", String(64), nullable=True))` + `downgrade` DROP COLUMN；revision=202606280900, down_revision=202606270900）。design §6.1 第 2 行**已落地**。
- **路径/文件名偏差**：design 写 `app/migrations/.../202606141200`，实际 `migrations/.../202606280900`。文件名 revision 按实际 alembic 链生成（接 `202606270900` 前序 migration），design 的 `202606141200` 是占位示例编号；目录 `backend/migrations/`（非 `backend/app/migrations/`）。功能等价，无影响。
- **建表机制澄清**：本项目 alembic 与 create_all 并存——alembic 是正式迁移（`backend/README.md` 推荐 `uv run alembic upgrade head`，alembic.ini + migrations/env.py 就绪），create_tables.py（create_all）用于测试/初始建表。两条路径都会建出 default_agent 列（测试 conftest.py:89 create_all 已验证列存在）。
- **结论**：design §6.1 第 2 行已落地，文件名 revision 偏差不阻塞。

### 发现 2（提示，技术债）— transitionChange 双定义
`@/lib/changes.ts` 与 `@/lib/workflow.ts` 各有一个 `transitionChange`。`page.tsx` 实际 import `workflow.ts` 版本。两个版本均已加 provider 参数、行为一致，但双定义是技术债（非本变更引入）。

### 发现 3（运行时依赖）— T15 端到端未跑
T15（claude+codex+hermes 多 provider 真实运行时全链路）需真实 daemon 环境。本次以单测覆盖 FR-01~FR-04、编译覆盖 FR-05/07/08、daemon 零 diff 覆盖成功标准 6。真实多 daemon 端到端留待运行时环境验证。

## 7. 结论

✅ **verify 通过**。

- FR-01~FR-08 全部覆盖（代码 + 测试/编译证据）。
- 成功标准 1-6 全部达成。
- 非功能需求满足。
- daemon 零改动确认。
- 发现项均为非阻塞（migration 偏差有规则 7 缓解、双定义是既有技术债、T15 运行时依赖）。

**可进入 archive。**
