---
author: WhaleFall
created_at: 2026-07-02T14:58:00
change: 2026-07-02-daemon-filesystem-policy
---

# Decisions: Daemon Filesystem Policy Engine 需求澄清 Grill 记录

> 6 个有实现影响的决策记录。每条含稳定 ID（D-xxx@vN），design.md §11 追踪覆盖关系。

## D-001@v1: 方案深度=务实方案（非 OS 沙箱）
- type: architecture
- status: accepted
- source: user
- question: 面对孙进程(Python/Node)文件操作无法在用户态拦截的根本约束，本次重构的方案边界？
- answer: 务实方案——统一 Policy 引擎覆盖所有 Tool 层入口；Python/Node 脚本内部 open()/fs.write 不硬拦，靠 prompt 约束 + audit log 事后追溯。
- normalized_requirement: 所有 Tool 层写入口（Write/Edit/MultiEdit + Bash/PowerShell/CMD 命令解析 + CC/Codex canUseTool + batch spawn 注入）经统一 FilesystemPolicy 校验；脚本内部系统调用不做硬拦截，靠 prompt + audit。
- impacts: [design §3 非目标, §5 总体方案, R-01, R-02, 验收 #10]
- evidence: 用户第 1 轮回答；daemon.ts 用户态进程无法拦截孙进程系统调用（CC/Codex 子进程 spawn 后 daemon 看不到孙进程 open()）
- priority: P0

## D-002@v1: 策略隔离=按 runtime（=provider），非 per-Agent 实体
- type: term/premise
- status: accepted
- source: code+user
- question: 策略粒度 per-agent 还是 per-runtime？Goal 文档 Map<AgentId,Policy> 的 Agent 指什么？
- answer: 项目无独立 Agent 实体，runtime≈agent 种类(provider)。按 runtime 隔离，daemon 不取并集，PolicyCache = Map<runtime_id, RuntimePolicy>。backend DaemonRuntime.allowed_roots 模型不改。
- normalized_requirement: daemon PolicyCache 为 Map<runtime_id, RuntimePolicy>；session/lease 按 runtime_id 取所属 policy；移除 daemon.ts:1682 并集逻辑；backend DaemonRuntime.allowed_roots 不变；每 runtime 独立 allowed_roots，互不串扰。
- impacts: [design §5.1.2, §5.2, R-09, 验收 #1]
- evidence: daemon model.py:54 provider 字段；model.py:89 allowed_roots runtime 级别；无 Agent 表（agent 模块仅 AgentRun/AgentSession）；daemon.ts:1682 现并集逻辑；用户第 2 轮回答
- priority: P0

## D-003@v1: batch 热更新=跑完再生效，不杀在跑任务
- type: boundary
- status: accepted
- source: user
- question: batch 任务运行中 allowed_roots 冻结（子进程 --settings 一次性注入不能热重载），前端改可写目录后对正在跑的 batch 任务怎么处理？
- answer: batch 任务跑完再生效——正在跑的 batch 保持旧配置到跑完，不中断；新起的 batch 用新配置；interactive session 下次 tool 调用立即生效。
- normalized_requirement: 热更新对 interactive 立即生效；对在跑 batch 不生效（不杀进程、不中断）；对新起 batch 在 spawn 时读最新 PolicyCache 生效。验收"立即生效"限定 interactive 语义 + 新起 batch。
- impacts: [design §5.3, 生命周期表 batch spawn/end, 验收 #2 #3]
- evidence: task-runner.ts:461 spawn 时快照 allowed_roots；CC --settings 子进程启动后不可热重载；用户第 3 轮回答
- priority: P0

## D-004@v1: 同步机制=加 WS push（POLICY_UPDATE）+ 心跳兜底
- type: architecture
- status: accepted
- source: user
- question: 前端改 allowed_roots 后同步到 daemon 的延迟：当前靠 15s 心跳轮询无 WS push，要立即生效是否加 WS push？
- answer: 加 WS push——backend PATCH 后主动推 POLICY_UPDATE，daemon 立即更新 PolicyCache，sub-second 延迟；心跳 15s 保留作兜底（防 WS 断线丢消息）。
- normalized_requirement: backend ws_hub 新增 send_policy_update(rid, roots)；protocol 新增 POLICY_UPDATE 消息（带 version 去重）；daemon ws-client 监听并更新 PolicyCache；PATCH allowed-roots 端点改完 DB 后触发 push；心跳保留兜底全量 reloadAll。
- impacts: [design §5.3, §7.2, backend ws_hub/protocol/router 改造, R-07, 验收 #2]
- evidence: 现无 WS push（ws_hub 无 send_policy_update）；心跳 15s 轮询（config.ts:222）；用户第 3 轮回答
- priority: P0

## D-005@v1: 路径规范化=含 realpath，防 ../symlink/junction/UNC，8.3 不做
- type: architecture
- status: accepted
- source: user
- question: 路径规范化要多严？Goal 文档要求防 .. / junction / symlink / UNC / 8.3。realpath 能防前三个，8.3 需 Windows 原生 API。
- answer: 含 realpath——normalize→resolve(折叠..)→realpath 解析 symlink/junction（存在）/realpath 父目录+拼名（不存在）→大小写归一→拒 UNC。8.3 短名不做（需 Windows 原生 API GetLongPathName，Node 无内置，YAGNI）。
- normalized_requirement: path-utils.resolveRealPath 实现上述链；对不存在路径 fallback realpath 父目录；UNC 路径直接 deny；8.3 不防（文档标注限制）。
- impacts: [design §5.1.1, R-03, R-04, 验收 #11]
- evidence: 现有 write-guard.ts:44 仅 pathResolve 无 realpath；用户第 4 轮回答
- priority: P1

## D-006@v1: audit log=ALLOW+DENY 全量回传 backend 落 PolicyAuditLog + 前端审计页
- type: architecture
- status: accepted
- source: user
- question: Policy Audit Log 落在哪？给谁看？ALLOW 要不要也记？
- answer: 给平台用户看（非本地运维）→ 必须前端可查 → 回传 backend 落 PolicyAuditLog 表 + 前端审计页。ALLOW+DENY 全量记，daemon 批量上报（100条/5s）+ 限流 + 失败落盘 + PolicyAuditLog 定期清理（保留 30 天）。
- normalized_requirement: backend 新增 PolicyAuditLog 表（runtime_id/workspace_id/decision/provider/tool/path/reason/created_at）+ POST /daemon/audit/batch 端点 + GET 审计查询端点；daemon AuditSink 批量上报 + 限流 + 失败落盘 ~/.sillyhub/daemon/audit-failed.jsonl；前端新增审计页（按 runtime 查，筛选 decision/provider/tool/path/时间 + 分页）。
- impacts: [design §5.1.5, §7.3, §7.4, backend audit 模块新增, frontend 审计页, R-05, 验收 #12]
- evidence: 用户第 4-5 轮回答（"给平台用户看的" + "ALLOW+DENY 全量记"）
- priority: P1

## D-007@v1: homedir 兜底=严格按 admin 配置，不偷偷加 homedir
- type: boundary
- status: accepted
- source: user
- question: 按 runtime 隔离后（移除并集），homedir 兜底还要不要？现状并集时始终加 homedir。
- answer: 严格按 admin 配置，PolicyCache 不偷偷加 homedir。新 runtime 默认 `[homedir]`（沿用现有默认值），但 admin 修改后严格按配置。安全边界=admin 配的 roots（真可控）。
- normalized_requirement: PolicyCache[rid].allowedRoots = admin 配置原样，不自动补 homedir；新 runtime 注册默认 allowed_roots=[homedir]（沿用 model.py 现有默认）；admin 想保留 homedir 需显式配进列表；迁移期可能 DENY 原靠兜底通过的写（回归风险已知接受，需通知 admin 配全）。
- impacts: [design §3, R-09, 验收 #1]
- evidence: 现有 daemon.ts:1703 并集时 `union.add(homedir())`；用户第 6 轮回答
- priority: P1

## D-008@v1: canRead 不记 audit，仅写类决策记
- type: boundary
- status: accepted
- source: user
- question: canRead（读校验，含 list_dir）要不要也记 audit？list_dir 高频会刷爆 PolicyAuditLog。
- answer: canRead 不记 audit。仅 canWrite/canCreate/canDelete/canRename 记录 ALLOW/DENY。audit 量大幅降低，审计页定位为「写行为审计」。
- normalized_requirement: PolicyEngine.canRead 不调 auditSink.record；仅写类校验产出 AuditEvent；审计页只展示写类决策。
- impacts: [design §5.1.5, R-10, 验收 #12]
- evidence: list_dir 高频调用（前端浏览目录树一次几十次 RPC）；用户第 6 轮回答
- priority: P1
