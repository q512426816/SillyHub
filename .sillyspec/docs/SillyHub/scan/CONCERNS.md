---
author: qinyi
created_at: 2026-07-27 00:35:31
source_commit: 5a00fc7e
updated_at: 2026-07-26T16:35:31Z
generator: sillyspec-scan
---

# 关注点(Concerns)

本文件只列真实问题,依据为审计文档、代码质量加固记录与 grep 到的 TODO/FIXME/deprecated。按严重度用 🔴 / 🟡 / 🟢 分组。代码仍在演进,动手前请核实行号是否漂移(`docs/agent-platform-deep-audit-2026-07-12.md` 性质为带 file:line 的事实文档)。

## 🔴 严重(正确性 / 进度跟踪失效)

- **sillyspec.db changes 表为空**:进度跟踪系统失效(2026-07-03 重建 db 后未关联既有目录),`status / continue / resume` 失灵(同上 🔴 P0)。

## 🟡 中等(半成品 / 待部署 / 体验缺口)

- **预算控制只挡新派发不杀在跑的**:`backend/app/modules/agent/control.py:76-80` `can_dispatch_worker` 仅 pre-dispatch 门,已派出的 worker 不再检查,可烧穿预算;`budget_tokens` 字段全代码无任何强制点(审计发现 4 / P2-1)。
- **diff_summary 字段早有但前端零展示**:`frontend/src/lib/agent.ts:24` 已含字段,后端 `diff_collector.py` 产出,全前端仅 `tasks/[tid]/page.tsx:749-753` 一行纯文本展示(审计 P1-3)。
- **待部署验证的 migration**:daemon-entity-binding 等多个变更的 PostgreSQL migration 待 apply + 端到端部署验证;并行变更新 migration 易撞 revision/down 分叉致多 head → 启动 crash-loop(SQLite 抓不到,PG 才暴露)(`ROADMAP.md` 🟠 P1)。
- **A6 缓存 token 聚合不一致**:`sillyhub-daemon` 的 `stream-json.ts`(L461 `+=` / L549 `=` / L706 `+=`)语义微妙且 SAFE=N(改变计费数字),需真实 Claude 输出 diff 验证,六批代码质量加固均 DEFER(`docs/code-quality-hardening-2026-07-24.md` §2/§6 A6)。
- **PPM 父表删除不级联(孤儿数据)**:plan / problem / task / project 的外键为软关联无约束(migration `202607220900`),删父行不留 500 而是留孤儿子行(MED 数据质量);全域缺乐观锁;第五批仅修 file / workspace 部分,余下 DEFER(§8 G 批)。

## 🟢 低(代码质量 / 维护性 / 体验)

### 代码质量

- **spec_profile 关键逻辑未实现(TODO 占位)**:`backend/app/modules/spec_profile/provider.py:75`("TODO: implement in follow-up task")、`policy.py:61`("TODO: implement stage conflict detection")、`policy.py:97`("TODO: implement document conflict detection")——阶段冲突与文档冲突检测尚未实现,模块为骨架。backend 源码 TODO 全集中在此模块。
- **daemon interactive 兼容入口 @deprecated**:`sillyhub-daemon/src/interactive/types.ts:212`、`claude-sdk-driver.ts:220` / `:240` 三处标注 `@deprecated`(task-02/03 driver provider-neutral 化后保留的兼容别名),应在确认无外部引用后清理。frontend 与 daemon 源码无 TODO/FIXME/HACK 标记。
- **N+1 与索引债(DEFER)**:约 10 处 N+1 查询(`list_daemon_instances`、`get_pending_leases`、`dialogs`、`import_commit`、`_find_role_members`、`_cleanup_before_dispatch`、`reparse`、`placement`、`list_missions` 等);六批加固已改 6 处批量化(B2/B3-B5/B6-B11)+ 3 处索引(`agent_run_workspaces.agent_run_id` / `PlanTask.ps_plan_node_detail_id` / `daemon_task_leases (runtime_id,status,created_at)`,migration `202607250100`),余下因"查询逻辑改动有风险 / 低频导入 N 小"DEFER(`code-quality-hardening-2026-07-24.md` §2/§5/§6/§8 DEFER 清单)。
- **session-manager `_store` end/fail 不清**:`sillyhub-daemon/src/interactive/session-manager.ts:1777` 附近,MEDIUM 内存泄漏;`_store.delete` 会与 `get()` 校验 / list / flush 落盘 / restore 交织,需设计"哪些 session 可驱逐 + 与持久化协调",六批 DEFER(§9 ND)。
- **死代码残留**:`agent/service.py:177` tool_failure 监控死代码(LOW,后端算了 `service.py:64-223` 但注释明说 non-blocking/no alert/no display,P3-2);frontend `lib/daemon.ts` `streamQuickChat` 已在第四批 F7 删除、第五批 G3 清注释。
- **god 文件未拆分**:daemon `daemon.ts` / `task-runner.ts` 高耦合(lease payload 鸭子类型几十处),无低风险切片,六批维持不做。
- **commit hook 可被复合命令绕过**:`git add && git commit` 以 `git add` 开头会绕过 claude PreToolUse 层(仅触发 git pre-commit 的 ruff,不触发 mypy + 前端全量检查)。

### 依赖风险

- **sillyhub-daemon pnpm overrides 硬钉 Claude Agent SDK 多平台子包**:`sillyhub-daemon/package.json` 的 `pnpm.overrides` 将 win32/linux/darwin 的 x64/arm64/musl 共 8 个平台子包全部绑定到 `npm:@anthropic-ai/claude-agent-sdk@0.3.181`,主依赖也硬钉 `0.3.181`;升级需同步改 8 条 override + 主依赖,跨平台打包链路长,任一平台 SDK 子包缺失即安装失败。
- **asyncpg 在 Windows 装不上**:后端生产用 PostgreSQL(asyncpg),本地开发用 Docker 起 Postgres、后端连容器;backend 测试须用 `backend/.venv/Scripts/python.exe`(全局缺 aiobotocore)。生产 asyncpg 与单测 aiosqlite 走不同 async 驱动,存在 JSONB / 数组 / UPSERT 方言差异风险。
- **daemon bundle / self-update 版本对齐**:光 `cp bundle` 无效,daemon 按 backend manifest 对齐 bundle(升降级都 `need_restart` 退出);`pnpm bundle` 报 `Cannot find module` 多为 `.pnpm` 真实包目录空,需 `pnpm install --force` 才真重下。
- **migration 链断裂**:SQLite 单测验不到 PG 方言差异与多 head;部署前必跑 `alembic heads` 核实单头,并行变更各写 migration 易撞 revision/down 分叉;子代理手算 revision 图漏 merge revision 会误报多 head,以官方 `alembic heads` 为准。
- **SillySpec 工具本身**:21 份已处理工具 bug 存 `docs/sillyspec/finished/`,活跃坑存 `docs/sillyspec/`;`sillyspec --done` 平台 sync 可能挂起(未连接时进程不退出),需 timeout 包裹并以 `--status` 为准。
- **本机多 daemon 实例**:连本地(`daemon-start.bat`)与连远程两类并存,停止按 `--server` 区分别误杀;无自动拉起;多实例会导致 WS 重连风暴。
- **部署 compose 瞬态冲突 / 端口**:`docker compose up` 报容器名 conflict 多为瞬态已自愈,看 `docker compose ps` 实际状态而非急着 `rm -f` 在跑容器;本机访问 docker 映射端口(8001/3001)用 `127.0.0.1`,`localhost` 解析 IPv6 连不通。
- **frontend 双 UI 体系 + 双浏览器自动化**:同时引入 antd 6 + Tailwind 3.4 + @xyflow/react,样式混合类名 / 优先级冲突需持续维护;同时声明 `@playwright/test` ^1.60 与 `puppeteer` ^24.43 两套浏览器自动化依赖,职责重叠且仓库内无独立 playwright config。

## ✅ 已解决（2026-08-06 scan 刷新核实时核实）

以下曾列入 🔴/🟡，经对照当前代码（HEAD `5a00fc7e`）核实已由对应变更修复，移出活跃关注点：

- **interactive kill 假停 / MissionControl.cancel 造僵尸（原 🔴 P0-1/P0-2）**：已由 `2026-08-05-daemon-kill-channel-unify`（merge `99aeb696`，已入 main）统一 kill 通道修复。`backend/app/modules/daemon/lease_service.py` 原 `_ws_cancel_stub`（只打日志不发 WS）已移除，改由 `_send_interactive_cancel`(:550) 实际调用 `DaemonWsHub.send_session_control`(:608) 下发 INTERRUPT→END；`backend/app/modules/agent/control.py:114` `MissionControl.cancel` 现委托 `lease_svc.cancel_lease(r.id)` 收尾每个 active worker。来源 `docs/agent-platform-deep-audit-2026-07-12.md` 发现 1/2。
- **写代码 team mission 断 2 处 + 共享 worktree 硬阻塞（原 🟡 P2-2）**：已由 `2026-07-12-worker-worktree-isolation` + finalizer wiring 修复。`backend/app/modules/agent/execution.py` `collect_completed_artifacts`(:297) 现持久化 `kind="patch"` 的 `AgentArtifact`(:340，供 Finalizer 合并)；`dispatch_worker`(:145) 现为每个 worker 在 `ws.root_path/.worktrees/<run.id>/` 建 per-worker git worktree 副本并作 root_path 下发(:135-177，并发写不互覆)；`finalize_execute_mission`(`backend/app/modules/agent/finalizer.py:219`)已有调用点(`finalizer.py:535`、`mcp_tools.py:255`)。原 D-006 延后项已实现。
- **scan 文档全量结构性过期（原 🔴，source_commit 停在 ba87eec）**：本变更 `2026-08-06-scan-doc-drift-gate` 已把 8 篇 scan 的 `source_commit` 刷新到 `5a00fc7e` 并新增 warn-only drift 检测门（`scripts/scan-drift-check.py` + `.github/workflows/scan-drift.yml`）。残余风险：门为 warn-only 不自动修，scan 仍需人工 LLM 重跑；但过期现已可见（CI warn + PR 评论），不再是隐形债。
