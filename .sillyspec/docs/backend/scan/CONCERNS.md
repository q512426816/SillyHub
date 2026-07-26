---
author: qinyi
created_at: 2026-07-27 00:35:31
source_commit: 6e78b29a
updated_at: 2026-07-26T16:35:31Z
generator: sillyspec-scan
---

# 关注点(Concerns)

> 仅列已核实真实问题，每条标注来源（审计文档 / 代码文件:行 / 记忆索引 / code-quality 文档）。颜色按严重度：🔴 正确性/阻塞、🟡 半成品/数据质量、🟢 已就绪可盘活/低风险。

## 代码质量

### 🔴 正确性 bug（界面骗人级，审计 P0）

- **interactive kill 是假停（僵尸）** — `backend/app/modules/daemon/lease_service.py:340` 的 `_ws_cancel_stub` 只打一行日志、什么都不发；lease 置 cancelled + AgentRun 置 killed 后，daemon 里的 claude/codex 进程继续跑到自然结束 / idle expire，仍在烧 token。来源：`docs/agent-platform-deep-audit-2026-07-12.md` §2 发现 1。
- **MissionControl.cancel 造僵尸** — `backend/app/modules/agent/control.py:83-99` cancel mission 时只改 AgentRun.status，不调 `cancel_lease`，daemon 不被通知，worker 继续跑（与上面同病）。来源：同审计 §2 发现 4 / §3 P0-2。
- **scan 文档全量结构性过期** — 停在 `source_commit ba87eec`（即本扫描的前一版），与当前主分支漂移；sillyspec.db changes 表为空（进度跟踪失效）。来源：审计 §5.5 已知技术债。

### 🟡 半成品 / 数据质量（审计 P1-P2 + code-quality DEFER）

- **预算只挡新派发、不杀在跑的** — `backend/app/modules/agent/control.py:76-80` `can_dispatch_worker` 是 pre-dispatch 门，已派出的 worker 不再检查；`budget_tokens` 字段全代码无任何强制点；默认 `budget_usd=4.0` 硬编码（`spec_workspace/bootstrap.py:257`、`change/dispatch.py:943`）。来源：审计 §2 发现 4 / §3 P2-1。
- **写代码 team mission 断链** — `finalize_execute_mission`（`agent/finalizer.py:167-186`）是 Wave 4 占位、全代码无调用点；`collect_completed_artifacts` 未把 daemon 上报的 patch 存成 `AgentArtifact(kind="patch")`；硬阻塞 C：`execution.py:104-130` 给每个 worker 传同一个 `root_path`（v1 共享 worktree，并行写互相覆盖 + patch 基线漂移，D-006 延后）。来源：审计 §2 发现 3 / §3 P2-2。
- **daemon-client spec 同步断裂** — scan/runtime 页空根因：session 不 end → `postSpecSync` 不触发 + `.sillyspec` 包裹错位 + daemon 无 HTTP 只能 lease 轮询；修复变更待 plan。来源：记忆索引 `daemon-client-spec-sync-broken.md`。
- **PPM 父表删除不级联（软关联）** — PPM FK 为软关联无约束（migration `202607220900`），删父行不会 FK 违约 500，而是留孤儿子行（`ppm/task/service.py:437` 注释明示）；4 父表（plan/problem/task/project）子表需逐表确认 + 显式级联。来源：`docs/code-quality-hardening-2026-07-24.md` §8 G1-G3 DEFER。
- **PPM 全域缺乐观锁** — 需 version 列 migration（多表）+ update WHERE version + 前端并发 409 协调；复用 `agent/coordinator.update_with_optimistic_lock` 范式，走专项 brainstorm。来源：同上 §8。
- **缓存 token 聚合不一致（A6）** — daemon 端 `sillyhub-daemon/src/adapters/stream-json.ts` L461 `+=` / L549 `=` / L706 `+=` 语义微妙（message_start 累加每 call 增量 vs message_delta 累计覆盖），盲目改破坏计费（SAFE=N），需真实数据 diff 验证；backend 聚合消费侧需对齐。来源：code-quality §3/§7 A6 DEFER + 记忆 `claude-cache-token-semantics`。
- **残余 N+1 查询** — `ppm/problem/import_commit._build_module_maps`（每项目 4 表 JOIN）、`ppm/plan/import_commit` 两段循环（per-user kanban 计数器）；低频手动 Excel 导入，N 小，DEFER。来源：code-quality §7 Wave B DEFER。
- **file 存储一致性收尾债** — upload 补偿 / soft_delete reaper / import_commit 原子化（platform-file-center 收尾）。来源：code-quality §7 §8。
- **mypy 实质偏弱** — `[tool.mypy]` `strict=false` + `disable_error_code` 关闭 9 类（`attr-defined/union-attr/assignment/arg-type/valid-type/operator/call-overload/call-arg` 等），`ignore_missing_imports=true`；新增代码类型错误基本不被拦截。来源：`backend/pyproject.toml`。

### 🟢 已就绪可盘活 / 低风险维护项

- **WS Hub 早已完整就绪** — `backend/app/modules/daemon/ws_hub.py:42` `DaemonWsHub.send_session_control`（含 SESSION_INTERRUPT/END/INJECT/RESUME）现成可用，`_ws_cancel_stub` 的 "Wave 2 实现" 注释为陈旧误导；修上面 P0-1 不需要补 Hub。来源：审计 §2 发现 2。
- **只读 team mission 链路完整可用** — 只差入口（`spec_workspace/router.py:273` 透传 `mode` 参数 + 前端按钮），即可用上 agent 团队做并行分析。来源：审计 §3 P1-1。
- **断点续跑后端全通、前端无按钮** — `coordinator.py:236-311` `resume_run` + interactive SESSION_RESUME 已就绪（claude/codex），缺前端入口。来源：审计 §3 P1-2。
- **deprecated 代码保留（有意）** — `agent/coordinator.py:484/575` `start_sillyspec_run` deprecated（仍可调，发 `deprecated_method_called` 事件）；`ppm/problem` 的 problem_change 模块 D-005 deprecated 但保留（`ppm/problem/fsm.py:11`、`router.py:11`）；`workspace/member_runtimes/model.py:7` 部分列 deprecated 只读；`workflow/fsm.py` ChangeFSM deprecated（用 StageEnum+TRANSITIONS 替代）。非 bug，按迁移节奏保留。
- **真实 TODO（3 处，spec_profile 模块）** — `spec_profile/policy.py:61`（stage 冲突检测）、`spec_profile/policy.py:97`（document 冲突检测）、`spec_profile/provider.py:75`（follow-up task）。来源：grep `TODO` `backend/app`。

## 依赖风险

### 🔴 阻塞 / 易踩

- **alembic migration 多 head 分叉** — `backend/migrations/versions/` 共 117 个 migration 文件；并行变更易撞 revision/down 分叉致多 head → 启动 crash-loop。SQLite 单测抓不到（PG 才暴露），需用官方 `alembic heads` 核实单头，新 migration 接真实 head + 唯一 id。来源：记忆索引 `migration-chain-fragmentation-pattern.md`。
- **worktree migration 污染部署** — 未合并 worktree 的 migration 若 apply 到本地 PG，切 main 部署会断链 crash-loop；修复需 `down -v` 重置（勿 stamp）。来源：记忆索引 `worktree-migration-pollutes-deploy.md`。

### 🟡 方言 / 环境

- **单测 SQLite vs 生产 PostgreSQL 方言差异** — `date_trunc` 等需方言分支；asyncpg 在 Windows 装不上（README §常见问题），本地连容器 PG；aiosqlite 存本地 naive 时间比较要转本地。来源：记忆索引 `backend-test-sqlite-vs-pg.md`、`README.md`。
- **daemon-client spec_root cwd 风险** — daemon-client 平台模式 daemon 跑 gate 的 spec_root 若是 specDir（只有 spec 文档，无 backend/frontend 代码），`cd backend` 会找不到目录；待 sillyspec gate 发版后真实联调确认。来源：`.sillyspec/local.yaml` 坑 3。
- **后端 venv 路径不可达** — 全局/项目根 `.venv` 缺 aiobotocore，pytest 必须用 `backend/.venv/Scripts/python.exe`；git bash 绝对路径 `.venv` 有时不可达。来源：记忆索引 `backend-venv-test-env.md`。
- **生产密钥管理走 env 无 KMS** — `SECRET_KEY`、`SILLYSPEC_MASTER_KEY`、`PLATFORM_BOOTSTRAP_ADMIN_PASSWORD` 全部 env/`.env`，无 KMS/Vault 集成，容器编排需自行保证密钥注入与轮转。来源：`app/core/config.py`。
- **OpenTelemetry 仍是 stub** — `app/core/telemetry.py` 仅 `log.info("telemetry.init", status="stub")`，未真正接入 exporter；生产链路追踪会落空。来源：旧 scan + 代码注释。

### 🟢 已缓解

- **backend 全量 ~12min 超 gate 10min timeout** — sillyspec 3.24+ 已支持 `SILLYSPEC_TEST_TIMEOUT_MS` 环境变量配置（`local.yaml` 坑 2 已解）。
- **预存非业务模块 errors 阻塞 verify** — `local.yaml` 已用 `test_strategy: module` 子模块粒度（ppm/llm_provider/frontend/daemon 各自独立 test）规避，未命中不跑。
