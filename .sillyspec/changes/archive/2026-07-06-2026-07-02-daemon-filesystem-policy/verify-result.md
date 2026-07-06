---
author: WhaleFall
created_at: 2026-07-03T13:30:00
change: 2026-07-02-daemon-filesystem-policy
stage: verify
---

# Verify Result: Daemon Filesystem Policy Engine

## 变更风险分级（change_risk_profile）

**integration-critical + deployment-critical**

触发关键词：`daemon` / `backend` / `session` / `lease` / `heartbeat` / `cross-process` / `cli.ts`。变更跨 sillyhub-daemon（宿主机本地进程）↔ backend（FastAPI）↔ frontend 三层，含 WS 跨进程推送、session/lease 生命周期、daemon cli.ts 启动路径、backend migration。按风险门控需**真实集成 + 部署启动证据**。

## 结论

🔴 **FAIL**（按 integration-critical 风险门控：agent session 集成证据缺失 → 降级 FAIL）

**非代码质量失败**——代码层全过 + 部署层 Runtime Evidence 已收集（migration 真实 PG + 服务 healthy + 审计页可达 + 新代码进容器）。失败项是**agent session 集成层证据缺失**：daemon 重启 + 实际 claude/codex session 跑 Tool 拦截/Codex 审批/WS 热更新未真机回归（需用户交互层操作）。

## 检查结果汇总（step 1-6）

| 检查项 | 结果 |
|---|---|
| 规范锚定（proposal/design/tasks/requirements/plan/decisions 全存在） | ✅ |
| 决策追踪（D-001@v1~D-008@v1 全 accepted，无 P0/P1 unresolved/superseded） | ✅ |
| 任务完成度（22/22 task，代码在 main a54f9a52 + review.json 全 pass） | ✅ |
| 探针 1 未实现标记（TODO/FIXME/HACK/XXX 零） | ✅ |
| 探针 2 设计关键词覆盖（PolicyEngine/canWrite/canRead/POLICY_UPDATE/PolicyAuditLog/AuditSink/resolveRealPath/extractShellWritePaths 全覆盖） | ✅ |
| 探针 3 测试覆盖（daemon policy 6 + backend audit 2 + frontend 2） | ✅ |
| 探针 4 决策→FR→task→实现映射 | ✅ |
| design §13 14 条验收 | ✅ 13 条单测过 + #10 Python open 降级（D-001 接受） |
| 单元/集成测试（daemon 1641 / backend 400 / frontend 561 passed） | ✅ |
| 质量扫描（ruff All checks passed / mypy Success / tsc 零错 / lint 仅既有 warning） | ✅ |

代码层实现与 design.md 高度一致（偏差均 allowed_paths 限制或数据模型缺口的合理调整，已记录各 task review + VERIFY-REPORT.md）。

### 决策覆盖矩阵（D-001@v1~D-008@v1）

| 决策 | 内容 | 覆盖 task |
|---|---|---|
| D-001@v1 | 务实方案非 OS 沙箱 | task-05（canRead allow + 写类 audit）、验收 #10 降级 |
| D-002@v1 | 按 runtime 隔离 | task-02 PolicyCache、task-12 去并集、task-14/16 接入 |
| D-003@v1 | batch 跑完再生效 | task-16 spawn 快照冻结 |
| D-004@v1 | WS push POLICY_UPDATE | task-06/07/08/13 |
| D-005@v1 | realpath 规范化 | task-01 path-utils |
| D-006@v1 | audit 全量回传 | task-04 AuditSink、task-09 PolicyAuditLog、task-10 端点、task-19/20 前端 |
| D-007@v1 | 不偷偷加 homedir | task-02 PolicyCache 严格按配置 |
| D-008@v1 | canRead 不记 audit | task-04/05/18 |

## Runtime Evidence（2026-07-03 部署验证 — 部分收集）

### ✅ 已真机验证（部署后自动验证）

1. **migration policy_audit_log** 在真实 PostgreSQL 建成（`psql to_regclass('public.policy_audit_log')` 返回 `policy_audit_log`，alembic upgrade head 在 backend 启动时执行成功）。
2. **backend 部署 healthy** + `commit_sha: a54f9a52c2cd`（= main HEAD，新代码生效，`/api/health` 返回 status=ok/db=ok/redis=ok）。
3. **frontend 审计页 `/runtimes/[id]/audit` 可达**（HTTP 200，Next.js 路由 7.06 kB 构建进镜像）。
4. **audit 模块进容器**（model.py/router.py/schema.py/service.py + PolicyAuditLog grep 命中）。
5. **审计端点注册**（POST /api/daemon/audit/batch + GET /api/daemon/workspaces/{wid}/runtimes/{rid}/policy-audit 挂载到 daemon router）。

### ⏳ 剩余待真机（需 daemon 重启 + agent session，用户交互层）

6. **daemon 跨进程 WS**：✅ daemon 重启新代码 + 注册 2 runtime（claude/hermes）+ ws_client_created + `allowed_roots_synced count=4` 心跳同步 PolicyCache（2026-07-03 daemon.log 真机验证 task-12 _syncAllowedRoots → PolicyCache.set 工作）；⏳ PUT 触发的 WS POLICY_UPDATE 主动 push 待 admin 凭证（login 401，DB admin 密码不匹配 env `admin123`，环境问题非本次代码）。
7. **agent session Tool 拦截**（design §13 #4-#9：需实际 claude/codex interactive session 跑 Write/Edit/Bash/PowerShell/CMD 越界写 → 验证 deny + 中文 reason + audit 落库）。
8. **Codex batch 带内审批 decline**（§13 #9，需 codex batch 任务 + 真机 probe fileChange payload 字段）。
9. **batch Claude spawn 用 PolicyCache 快照**（§13 #3 D-003 冻结，需 batch 任务跑）。
10. **兼容互连 #14/#15**（需旧/新 daemon 互连 backend）。
11. **Windows junction/symlink realpath**（§13 #11 R-03，需 Windows 真机创建 junction 测试）。

> 6-11 项需宿主机 daemon 重启（新代码）+ 实际 agent session（claude/codex CLI + token + 交互），超出自动化范围，留给用户/runtime 配置后真机回归。

## 遗留风险（非阻断，已记录 VERIFY-REPORT.md）

- E2E-2（P2）：task-20 audit 路由 wid 偏差，后端加 `GET /daemon/runtimes/{rid}/policy-audit` 无 wid 别名路由。
- E2E-3（P2）：task-14 多 runtime `daemon.resolveRuntimeId` 待加（单 runtime 无影响）。
- E2E-4（P2）：task-17 codex fileChange payload 真机 probe 补字段。
- E2E-5（P3）：backend test_session_sse 既有 flake（c1de9497 连接池时序，非本次）。

## 建议路径（达成 PASS 的条件）

1. **宿主机 daemon 重启新代码**（`node sillyhub-daemon/build/bundle/sillyhub-daemon.js start` 或 daemon-dist 安装），注册 runtime。
2. **配置 runtime allowed_roots**（claude/codex 各配，前端 runtimes 页或 PUT 端点）。
3. **真机回归 design §13 #1-#15**：跑 interactive session（Write/Bash/PS/CMD 越界）+ batch（Claude/Codex）+ WS 热更新 + 审计页查看 + 兼容互连。
4. 补本报告 Runtime Evidence（真机测试结果截图/日志）。
5. 解决遗留 P2（wid 别名路由 / resolveRuntimeId / codex payload probe）。

补齐 agent session 集成证据后，本变更可重判 PASS 并归档。

## 附：已完成且可信的部分

- daemon Filesystem Policy Engine 核心逻辑（policy/ 5 模块）单测全覆盖（path-utils 18 + runtime-policy 20 + shell-paths 30 + audit-sink 13 + filesystem-policy 14 = 95 tests）。
- backend audit 落库 + claim_token 鉴权 + 分页筛选单测（test_audit 20 + test_model 6 = 26 tests，ruff/mypy 全过）。
- daemon 装配 + 热更新 + 各 Tool 接入单测（daemon-multi-runtime / daemon-policy-update / session-manager-allowed-roots / task-runner-policy-cache / task-runner-approval-decision / file-rpc / ws-client 全绿）。
- frontend 审计页 + API client + 入口单测（daemon-audit 17 + audit page 5 + runtimes 22 全绿）。
- 22 task Task Review Gate 全 pass（对照 diff + brief + 测试）。
- 部署层真机验证：backend/frontend healthy + migration policy_audit_log 真实 PG + 审计页可达 + 新代码（commit_sha a54f9a52）生效。
