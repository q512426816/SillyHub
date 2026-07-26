---
author: qinyi
created_at: 2026-07-26 11:26:00
change: 2026-07-25-daemon-borrow-for-business
verdict: PASS_WITH_NOTES
risk_profile: integration-critical
---

# 验证报告 — daemon-borrow-for-business

## 结论

**PASS WITH NOTES**

实现质量达标(14 task 全落地、4 路 resolver 收敛、沙箱写边界 R-02 正确应对、198 测试全绿、mypy/ruff/tsc clean),且首轮 verify 的 P0 部署阻断(迁移 revision 碰撞)**已在 quick ql-20260726-001-ac8a(commit `30ae305e`)修复**:3 迁移 renumber 为 `202607251400/1500/1600`(1400 down_revision 接 llm-provider 的 1100),`alembic heads` 实测单 head `202607251600`,生产 `alembic upgrade head` 不再报 Multiple heads。

**Notes(不阻断 archive)**:真实多组件端到端借用(业务人员经 live daemon+backend+frontend 跑完借出→沙箱→落方案)未在本次执行,留部署后补;单测/集成层面 4 路 resolver 一致性、借用查询三重校验、沙箱写边界、落 file、审计均已覆盖(见 Runtime Evidence)。

> 首轮 FAIL 仅因迁移碰撞(已修),实现本身无返工。本轮重跑确认碰撞解除,其余结论不变。

## 任务完成度

14/14 task 代码全部落地（commit `6d0dd066`，merge `af55984a`）。逐项核查：

| Task | 内容 | 落地证据 | 结论 |
|---|---|---|---|
| task-01 | `workspace_member_runtimes.shared` 列 + 部分索引 + 迁移 | `model.py:81-85`（Boolean nullable=False default false）、`model.py:33-37`（`ix_wmr_shared` PG 部分索引 `WHERE shared=true`）、迁移 `202607251100`（**revision 碰撞，见风险节**） | 代码✓ 迁移✗ |
| task-02 | `daemon_borrow_audit` 新表 + 迁移 | `agent/model.py:681-748`（FK CASCADE user/ws/run + RESTRICT daemon_instance + 3 索引）、迁移 `202607251200` down→1100 线性 | ✓ |
| task-03 | `DAEMON_BORROW` 权限 + `business_member` 角色 + 种子 + 白名单 | `permissions.py:88`（`DAEMON_BORROW="daemon:borrow"`）、`permissions.py:193`（`daemon` 前缀落 AGENT 组）、迁移 `202607251300` 种子（`task:run_agent`+`daemon:borrow`+`workspace:read`）、`members_service.py:46-48`（`ROLE_KEY_WHITELIST` 加 `business_member`） | ✓ |
| task-04 | lender `PUT /my-binding/shared` + owner `GET /shared-daemons` | `member_runtimes/router.py`、`service.py` 共享/撤销端点（+93/+95 行） | ✓ |
| task-05 | `borrow_resolver._resolve_borrowed_or_own_runtime` + `resolve_shared_daemon_for_borrow` | `borrow_resolver.py:44-131`（先自有零回归→权限闸→shared+online）、`queries.py:171-253`（SQL `shared=TRUE AND daemon_id IS NOT NULL AND user_id<>actor AND status='online'` + provider 解析）；三重校验顺序权限→shared→online ✓ | ✓ |
| task-06 | placement dispatch + decide 接入 | `placement.py:1015-1061`（无 binding/离线兜底，命中借则 stamp flag，未命中抛原文案）、`:1201-1234`（decide 同语义） | ✓ |
| task-07 | writeback 接入 | `resolver.py:123-153`（无自有→helper，命中写回 lender runtime） | ✓ |
| task-08 | interactive `_get_online_runtime` 接入（spike-01=前置解析） | `placement.py:602-623`（先 user 级查自有零回归→None+workspace_id 才借→仍 None 抛原文案） | ✓ |
| task-09 | daemon 沙箱（候选 B 按 lease 隔离只读 policy） | `daemon.ts:465/782-790/2789-2822`（marker→prepareWorkspace slug→独立 cwd + lazy 沙箱管理器零回归）、`session-manager.ts:1141-1168`（借用 session **跳过 lender runtime 缓存**，写路径须落 borrowRoot 内否则 deny，R-02 正确应对） | ✓ |
| task-10 | 落 FileService + markdown 白名单（spike-02） | `service.py:1788-1879`（只对 `borrowed=True`+`completed` 落 file，`uploaded_by=borrower` `owner_type=workspace`）、`run_sync/service.py:966`（close_interactive_run 钩子接线）、`config.py:229`（`text/markdown` 已入白名单） | ✓ |
| task-11 | 写 `daemon_borrow_audit` | `placement.py:138 _insert_borrow_audit_row`，dispatch/interactive 两路（:446/:679）调用；`service.py:1880 _update_borrow_audit_usage` 补 usage | ✓ |
| task-12 | 前端 lender 开关 + owner 管理 | `shared-daemon-toggle.tsx`/`shared-daemon-manager.tsx`/`workspace-member-row.tsx`（business_member 选项） | ✓ |
| task-13 | 前端 业务触发 + 方案查看 | `borrowed-solution-files.tsx`/`-panel.tsx`、`files/page.tsx`、`agent/page.tsx` 门禁放宽 | ✓ |
| task-14 | 单测 + 跨变更核查 | 见测试节；R-02 写边界/4 路一致性/审计单测齐全 | ✓ |

## 设计一致性

D-001~D-010 全部落地且与 design.md 吻合：

- **D-002/D-008（4 路收敛 helper）**：4 路派发（dispatch/decide/writeback/interactive）统一调 `_resolve_borrowed_or_own_runtime`，避免「decide 通过但 dispatch 报错」语义割裂（R-01）。
- **D-006@v2（business_member 端点鉴权澄清）**：复用现有 agent 端点，business_member 带 `task:run_agent`（过端点鉴权）+ `daemon:borrow`（借用回退授权），不新建 `/borrow-run` 端点。代码与决策一致。
- **D-007@v2（候选 B 按 lease 隔离）**：核心风险 R-02（借用复用 lender runtime_id → 命中 lender 写缓存继承代码区写权限）由 `session-manager.ts:1141-1148` 显式绕过 PolicyEngine runtime 缓存、按 sessionId 隔离沙箱 root 解决。写边界单测通过。
- **D-010（落 file 钩子）**：close_interactive_run 回调挂 `persist_borrow_run_output`，仅 borrowed lease 生效，普通 lease 零回归。
- **R-05（权限缓存失效）**：决策记录明确迁移体不调 Redis（防部署期 Redis 未就绪卡死），缓失效落在 `members_service` grant 后的 `invalidate_all_permissions`。决策与实现一致。
- **兼容策略（§9 零回归）**：`shared` 默认 false、`DAEMON_BORROW` 默认不授、helper 第 1 步自有 daemon 原路径返回——三道零回归闸门均在代码中体现。

设计层面无偏差。

## 探针结果

### 探针 1：alembic 迁移链完整性（首轮失败 → 已修复 PASS）

**修复后实测（commit 30ae305e 后）**：
```
$ python -m alembic heads
202607251600 (head)        ← 单 head，重复 revision 告警消失
$ python -m alembic history（链尾）
202607251000 → 202607251100 (llm_providers, llm-provider 变更)
202607251100 → 202607251400 (borrow shared, 本变更)
202607251400 → 202607251500 (borrow audit)
202607251500 → 202607251600 (borrow permission, head)
```

- 首轮 verify 发现的 P0（`202607251100` revision 被 daemon-borrow 与 llm-provider 双占 → 双 head + 重复 revision → 生产 `alembic upgrade head` 报 Multiple heads → crash-loop）已在 quick ql-20260726-001-ac8a（commit `30ae305e`）修复:daemon-borrow 3 迁移 renumber 为 `202607251400/1500/1600`,1400 down_revision 接 llm-provider 的 1100,成单 head 线性链。
- 根因（已记录 memory）:execute 时 worktree base 落后 main,未感知 llm-provider 已占 1100,撞 id;SQLite 单测 create_all 绕过 upgrade 故 198 测试全绿却未暴露,仅 `alembic heads` 触发。
- 生产影响解除:`deploy/docker-compose.yml:136` 的 `alembic upgrade head` 现可线性应用。
- 并行插曲:修复期间 commit `13fc1dc9`(ql-002)顺带纯重命名了 3 迁移文件名(1100→1400 等,`|0` 零内容改)但未改 revision 内容(碰撞仍在),`30ae305e` 补全内容修复。

### 探针 2：4 路 resolver 借用兜底一致性（通过）

- dispatch（`placement.py:1015-1030` 无 binding / `:1048-1061` 离线）：raise 前调 helper，命中 stamp flag，未命中抛原 `NoOnlineDaemonError("工作区未绑定守护进程")`。
- decide（`:1201-1234`）：同语义。
- writeback（`resolver.py:123-153`）：同语义。
- interactive（`:608-623`）：spike-01 前置解析，先 user 级查自有，None+workspace 才借。
- 4 路文案不变、零回归 ✓。单测 `test_placement_borrow_integration.py` 覆盖。

### 探针 3：写边界 R-02（通过）

- `session-manager.ts:1146-1168`：borrow session 不查 lender runtime 缓存，写路径须 `isPathUnderAnyRoot(np, [borrowRoot])`，否则 deny（中文文案「借用 agent 仅可写沙箱目录，不可写开发代码区」）。
- UNC 路径拒绝。
- 单测 `session-manager-borrow-sandbox.test.ts` 通过。

## 测试结果

| 套件 | 命令 | 结果 |
|---|---|---|
| 后端借用核心 | `pytest app/modules/agent/tests/test_borrow_resolver.py test_daemon_borrow_audit_model.py` | 34 passed |
| 后端 4 路/落file/共享/角色/迁移/权限 | `pytest test_placement_borrow_integration.py test_borrow_run_output.py test_member_runtimes.py test_members_service_business_member.py test_migration_borrow_shared.py test_business_member_role.py test_file_api.py test_member_runtimes_model.py test_permissions.py` | 121 passed |
| daemon 沙箱 + 写边界 | `pnpm test daemon-borrow-sandbox.test.ts session-manager-borrow-sandbox.test.ts` | 12 passed |
| 前端借用组件 | `pnpm test shared-daemon-manager/toggle borrowed-solution-files(-panel) borrow-trigger-contract workspace-binding workspace-member-row` | 31 passed |
| mypy | `mypy borrow_resolver/placement/service/queries/resolver/members_service/permissions/model` | clean（8 文件） |
| ruff | `ruff check` 借用相关 + 3 迁移 | All checks passed |
| daemon tsc | `pnpm typecheck` | clean |

**合计 198 测试全绿，质量门全过。** 但测试通过 ≠ 可部署：迁移碰撞在 SQLite 单测下不可见（探针 1）。

## 变更风险等级

**integration-critical**（design/plan 含 daemon / lease / agent_run / session / complete 关键词，CLI `detectChangeRisk` 自动判定）。

按门控：integration-critical 变更若结论 PASS/PASS WITH NOTES 须有真实集成证据。本报告结论为 FAIL（部署阻断），门控不适用放宽，但下方仍提供 Runtime Evidence 佐证缺陷真实性。

## Runtime Evidence（integration-critical 必填）

**0. P0 修复证据（本轮新增,首轮 FAIL 的阻断已解除）**:
   - 修复 commit `30ae305e`(quick ql-20260726-001-ac8a):renumber 3 迁移 revision 1100/1200/1300→1400/500/600。
   - `alembic heads` = 单 head `202607251600`(无重复告警);`alembic history` 线性链 llm(1100)→borrow(1400→1500→1600)。
   - 3 迁移元数据测试 24 passed(断言新 revision/down_revision 链)。
   - ruff format + ruff check Passed(pre-commit hook)。

1. **迁移链实测**（本机 backend venv,权威 `alembic heads`):单 head `202607251600`,生产 `deploy/docker-compose.yml:136` 的 `alembic upgrade head` 可线性应用(非子代理手算,官方命令输出,[[alembic-heads-subagent-misreport]])。

2. **生产部署命令**（`deploy/docker-compose.yml:136`）：
   ```
   alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 ...
   ```
   多 head → 此命令必失败 → backend crash-loop。

3. **碰撞双方源文件**（均 down_revision=202607251000）：
   - `backend/migrations/versions/202607251100_daemon_borrow_shared.py:26-27`（本变更）
   - `backend/migrations/versions/20260725_create_llm_providers.py:15-16`（llm-provider 变更）

4. **测试证据**：198 单测全绿但未覆盖「alembic upgrade head 多 head」场景（SQLite create_all 绕过 upgrade），故测试绿与部署阻断并存——这正是该缺陷危险处（[[migration-chain-fragmentation-pattern]]：SQLite 抓不到 PG 才暴露）。

5. **写边界集成证据**：daemon 侧沙箱 + PolicyEngine 按 lease 隔离由 `session-manager-borrow-sandbox.test.ts`（12 passed）覆盖，R-02 闭环。

## 修复状态（首轮 P0 已闭环）

首轮 verify 的 P0 迁移碰撞已修复(quick ql-20260726-001-ac8a,commit `30ae305e`):采用方案 A(renumber 本变更 3 迁移到未占用 id 1400/500/600,1400 接 llm-provider 的 1100)。本项目未上线不要求历史兼容(CLAUDE.md 规则 11),重命名安全。修复已落 main,本轮 verify 重跑确认碰撞解除。

## 遗留/风险

- ~~P0 迁移碰撞~~ **已修复**(commit `30ae305e`)。
- 端到端集成未跑(需真实 daemon+backend+frontend 联调借用全链路);单测层面 4 路/沙箱/落 file/审计均已覆盖,真实多组件 e2e 留部署后补(本项目惯例,见同类变更「遗留部署 e2e」)。
- 前端 `workspace-member-row.test.tsx` 有 `<tr> cannot appear as a child of <div>` 测试渲染告警(测试未包 table wrapper 所致,组件本身是 `<tr>`,非真实缺陷)。
