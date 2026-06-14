---
author: qinyi
created_at: 2026-06-14T17:25:44
change: 2026-06-14-unified-agent-execution
stage: propose
---

# Proposal — 统一 Agent 执行路径（Daemon-Only）

## 动机

SillyHub 当前存在**两条** Agent 执行路径（DAEMON / SERVER），由 `RunPlacementService.decide_backend()` 分叉。两条路径在**协议机械层重复**（claude 命令构建 / stdin / 解析双写于 Python 与 Node），在**上下文层有缺口**（daemon 仅拿到裸 prompt），且 SERVER 路径在生产容器无 claude CLI 导致静默失败。

本变更删除 SERVER 路径，使 daemon 成为**唯一执行者**，并补齐 / 增强 daemon 至少达到原 SERVER 能力——用户明确要求「daemon 既然是唯一执行者，必须比原来的 SERVER 路径更强」，不能只是「删旧 + 最小补齐」。

## 关键问题（现有方案为什么不够）

1. **协议机械层重复**：`claude_code.py:_build_claude_command` 与 `stream-json.ts:buildArgs` 产出的 claude 启动参数字节级相同；Python `_parse_*` 与 Node `parse` 是两份解析器。改 claude 调用契约要同步改两处，易漂移。

2. **SERVER 路径生产无效**：后端容器无 claude CLI，SERVER 作为**静默 fallback** 存在，产生「看似成功实则失败」的隐性故障——无在线 daemon 时悄悄走 SERVER，子进程起不来却仍标记运行。

3. **daemon 上下文缺口**：`dispatch_to_daemon(run.id, user_id)` 不传 bundle；daemon claim 只拿到裸 prompt（`claudeMd/repoUrl/branch/allowed_paths` 恒 `undefined`），缺失 SERVER 的完整 bundle（`render_bundle_to_claude_md` 渲染的 CLAUDE.md + repo_url/branch/allowed_paths）。

4. **daemon 能力缺口（相对 SERVER）**：`collectDiff`（`workspace.ts:156`）无 `redact_output`、无 50KB 截断、无 `stat_summary`——敏感内容（密钥/token）可泄漏到 diff、大 diff 撑爆 `complete_lease` payload 与存储。

## 变更范围

- **Phase 1 — 删除 SERVER 执行路径**：删除 `claude_code.py` 整文件 + `service.py` 三条执行体（`_execute_run_background` / `_execute_stage_run` / `_execute_scan_run`）+ `_proc_registry` + kill SIGTERM→SIGKILL 链 + `decide_backend` SERVER 分支；无在线 daemon 时抛 `NoOnlineDaemonError` → `AgentRun.failed` + 错误码。
- **Phase 2 — execution-context 端点 + dispatch 扩字段**：新增 `GET /agent-runs/{id}/execution-context` 透传完整 bundle；`dispatch_to_daemon`（`placement.py:124`）签名扩展 `repo_url/branch/allowed_paths/tool_config/timeout_seconds`，写入 `lease.metadata`。
- **Phase 3 — kill / 状态机收口**：`kill_run` 改道 `cancel_lease`；状态映射单一化（lease.status → AgentRun.status）；diff 收口 daemon。
- **Phase 4 — daemon fetch 上下文**：`_runLeaseStateMachine` claim 后 fetch execution-context 填充 `LeaseCtx`，CLAUDE.md 写入与真实 clone 生效。
- **Phase 4.5 — daemon 功能补齐与增强**：
  - **A 类（对齐 SERVER）**：A1 实时流（已等价，核实）、A2 metadata 写回（stats 透传 + usage 拆分累加）、A3 conversation log（条件性，plan 核实前端依赖）、A4 diff 截断 + redact + stat_summary（真实缺口）、A5 bundle 上下文（Phase 2/4 覆盖）。
  - **B 类（增强）**：B1 token 注入（P1）、B2 超时可配（P1）、B3 spawn 重试（P1）、B4 workspace 缓存、B5 stderr 收集、B6 心跳细化、B7 资源限制、B8 流式合并（P2，plan 阶段定是否本 change 做）。

## 不在范围内（显式清单）

- 不改 claude CLI 调用语义（仍是 stream-json NDJSON 协议）。
- 不重做 daemon-nodejs-rewrite 已交付的 lease / claim / heartbeat 机制（保留复用）。
- 不做 SERVER→DAEMON 灰度 / 双跑过渡（用户授权：未上线、数据可清空、无需兼容）。
- 不改 claude CLI 本身。
- Phase 4.5-B 的 **P2 锦上项**（B4 workspace 缓存 / B5 stderr / B6 心跳 / B7 资源 / B8 流式合并）可在 plan 阶段拆独立 change，不硬性纳入本变更。
- 不补 daemon 子项目模块文档（`daemon.md` 缺失，留待后续 scan/归档补）。

## 成功标准（可验证条件）

1. `grep` 确认 claude 命令构建只在 `sillyhub-daemon/src/adapters/stream-json.ts`，后端无 `_build_claude_command`。
2. `GET /agent-runs/{id}/execution-context` 返回完整 bundle（claude_md + prompt + repo/branch + allowed_paths + tool_config），经鉴权 + run 归属校验。
3. 无在线 daemon 时 `AgentRun` → `status=failed` + `error_code=no_online_daemon` + 用户可读消息「未检测到在线 daemon，请启动 sillyhub-daemon 后重试」。
4. `kill_run` 经 `DaemonLeaseService.cancel_lease`，无 `_proc_registry` / SIGTERM 链。
5. 状态映射测试通过（lease.status → AgentRun.status 单一驱动）。
6. daemon 实时流经同一 `agent_run:{id}` channel 可订阅（与 SERVER 等价）。
7. daemon 执行后 `AgentRun.total_cost_usd/duration_ms/input_tokens/output_tokens` 非空且对齐 claude result 消息。
8. daemon 上报 diff 经 50KB 截断 + 后端 redact（含密钥 diff 不泄漏、大 diff 不撑爆存储）。
9. token 注入 claude 子进程 env（claude 能鉴权），且 token 不入日志 / 不入 Redis payload / 不回传前端。
10. spawn 级失败自动重试一次后仍失败才标 `failed`。
