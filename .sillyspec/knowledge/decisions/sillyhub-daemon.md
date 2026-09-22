# 决策知识 — sillyhub-daemon

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 : plan 模式采用强确认交互
状态：implemented
锚点：`frontend/src/components/daemon/plan-approval-card.tsx`
最近确认：04bb45fe
理由：强确认，类似 askuser 弹窗。

## D-004@v1 : CLI 边界 = 平台侧先行，sillyspec 工具同步配套（daemon 零改动兼容）
状态：implemented
变更：2026-08-29-change-delete-closure-and-spec-pull
锚点：`sillyhub-daemon/tests/test_bundle_metadata_compat.test.ts`
最近确认：0ec935c9
理由：平台先提供端点（spec-bundle 拉取/墓碑写路径），CLI 侧删除/归档墓碑上报（X1）与 pull --spec（X2）作跨仓任务在 sillyspec 仓落地（分支 sillyspec/2026-08-29-change-delete-closure-and-spec-pull：b86a593/16c21b0/fb35dc0）。daemon 本体零改动：bundle tar 新增顶层 PLATFORM-BUNDLE.json 经 test_bundle_metadata_compat 实证 pullSpecBundle/spec_version 判定兼容（.runtime 排除规则不变）；pull/push 时机口径维持现状（lease claim 按 latest_spec_version 判定，人拉/CLI 拉均为主动快照语义）。

## D-002@v1 : 数据链路走方案 A——git_log 模块扩展独立轻量 status 端点
状态：implemented
变更：2026-08-26-workspace-git-status
锚点：backend/app/modules/git_log/router.py
最近确认：86d6c405
理由：复用 git_log 模块与 host-fs 平名通道，daemon 加单方法 git_status、backend 加 GET /git-log/status、前端共享组件。

## D-001@v1 自启注册形态：daemon CLI 新增 autostart 子命令
状态：implemented
变更：2026-08-30-daemon-autostart
锚点：sillyhub-daemon/src/cli.ts:340（现有命令注册区，autostart 组追加于此）
最近确认：b243c765
理由：CLI 子命令（`sillyhub-daemon autostart enable/disable/status`），前端复制一条命令执行即"一键"；安装脚本仅在尾部提示该命令，不内置注册逻辑。

## D-002@v1 保活策略：仅开机启动，不崩溃保活
状态：implemented
变更：2026-08-30-daemon-autostart
锚点：sillyhub-daemon/src/autostart.ts（平台策略产物生成，设计 §2）
最近确认：b243c765
理由：仅开机/登录后启动一次，不配置 KeepAlive/Restart 型保活。

## D-003@v1 三平台原生机制，不引入外部依赖
状态：implemented
变更：2026-08-30-daemon-autostart
锚点：sillyhub-daemon/src/autostart.ts（设计 §2 平台矩阵）
最近确认：b243c765
理由：Windows=schtasks ONLOGON 用户级计划任务+VBS 隐藏窗口；macOS=LaunchAgents plist（RunAtLoad，无 KeepAlive）+node 绝对路径；Linux=systemd user service+WantedBy=default.target+enable-linger（best-effort）；WSL 无 systemd 时明确报错不静默失败。

## D-004@v1 凭据策略：autostart enable 复用 start 的凭据落盘语义
状态：implemented
变更：2026-08-30-daemon-autostart
锚点：sillyhub-daemon/src/cli.ts:startAction（凭据管线复用点）
最近确认：b243c765
理由：enable 接受与 start 相同的 --server/--api-key/--token 语义（loadConfigFn 合并 CLI 覆盖 + saveConfigFn 落盘 per-server config）；开机任务命令只带 --server，凭据从落盘 config 读；均无凭据时报错 exit 1 不注册。自启场景推荐 API Key（长效），JWT 会过期。

## D-005@v1 实现架构：方案 A——daemon 内置 TS autostart 模块
状态：implemented
变更：2026-08-30-daemon-autostart
锚点：sillyhub-daemon/src/autostart.ts（新文件）
最近确认：b243c765
理由：A——`src/autostart.ts` 内置模块，运行时 process.execPath 取 node 绝对路径，直接调 schtasks/launchctl/systemctl 注册。

## D-006@v1 Windows 注册命令降级链：schtasks 优先 → PowerShell Register-ScheduledTask 兜底（主代理追认实机发现）
状态：implemented
变更：2026-08-30-daemon-autostart
锚点：sillyhub-daemon/src/autostart/windows.ts:registerViaPowerShell
最近确认：b243c765
理由：降级链——schtasks 优先（蓝图参数逐字保留，task-06 argv 断言不受影响）；access denied 时走 PowerShell Register-ScheduledTask（-EncodedCommand base64 防转义；语义对应 /SC ONLOGON→AtLogOn 本用户 Interactive、/RL LIMITED→RunLevel Limited、/F→-Force）。

## D-001@v1 sillyspec 版本上报与远程升级的技术方案（machine-sillyspec-version）
状态：implemented
变更：2026-08-31-machine-sillyspec-version
锚点：sillyhub-daemon/src/sillyspec-manager.ts
最近确认：b690c91e
理由：版本与升级状态随 register/heartbeat 心跳上报（仿 pending_update 模式）；手动升级走 WS 即时消息 daemon:sillyspec_update（仿 daemon:self_update，fire-and-forget）；自动定期升级由 daemon 本机定时器执行（默认 1h，忙时推迟）。三套环节均有既有先例，风险最低。

## D-001@v1 恒读 SQLite，文件仅作失败兜底
状态：implemented
变更：2026-09-10-zcode-session-sqlite-read
锚点：未记录
最近确认：20cf7bc46
理由：恒读 SQLite（文件存在也不读文件）；库读失败（schema 漂移/库损坏/会话不在库/node:sqlite 不可用）才回落文件路径。

## D-005@v1 分派插入点在 allowed_roots 守卫之后、registry 之前
状态：implemented
变更：2026-09-10-zcode-session-sqlite-read
锚点：未记录
最近确认：20cf7bc46
理由：assertWithinAllowedRoots(path) 守卫先行（安全铁律，分派不得绕过越界检查），守卫通过且 format=zcode 时先走读取器，失败落回 registry→lstat→文件解析现流程。

## D-006@v1 node:sqlite 生效版本带与类型声明
状态：implemented
变更：2026-09-10-zcode-session-sqlite-read
锚点：未记录
最近确认：20cf7bc46
理由：运行时生效版本 ≥22.13.0 / ≥23.4.0（22.5–22.12、23.0–23.3 带 flag 导入即抛错 → 自动文件回落），engines 不 bump；devDep @types/node bump 至 22.13+ 或本地 .d.ts。

## D-001@v1 ctx_tokens 派生位置——归一化器源头上报处派生（方案 A），否决消费侧统一派生（方案 B/C）
状态：implemented
变更：2026-09-13-ctx-usage-all-providers
锚点：sillyhub-daemon/src/interactive/providers.ts:ProviderCaps（caps 键落点）+ sillyhub-daemon/src/interactive/usage-ctx.ts:ctxTokensFromNetInput（公式单源落点，execute 新建）
最近确认：未记录
理由：用户原话指定方向：「都要接入的，并且需要统一抽象出来（我记得最近刚刚做了个统一抽象的事情，就是怕后面再接新 agent 又遗漏一些功能）」。据此选方案 A（各归一化器在 usage 构造处用共享 helper 派生 + ProviderCaps 第 11 键声明走既有三端生成与守护链）。

## D-003@v1
状态：implemented
变更：2026-09-19-tool-report-session-replay
锚点：sillyhub-daemon/src/agent-log/parse-zcode-model-io.ts（SYSTEM_REMINDER_BLOCK_RE 剥离先例）
最近确认：53c67e02a
理由：跨 harness 通则——仅真人输入渲染为用户气泡；task-notification / system-reminder（zcode）、isMeta 与注入上下文（claude-code）、纯 tool_result 载体 user 行（claude-code）归一化为系统事件或工具段

## D-004@v1
状态：implemented
变更：2026-09-19-tool-report-session-replay
锚点：sillyhub-daemon/src/agent-log/parse-zcode-model-io.ts:66（NormalizedLogMessage）、backend/app/modules/platform_sync/router.py:849（messages 端点）
最近确认：53c67e02a
理由：四层打通——daemon 解析器透传 usage/turn/model/耗时 + 全会话累计 → RPC 返回结构 → 平台 GET /agent-logs/{id}/messages schema → gen:types → 前端映射到 SessionTurnView token 字段与会话用量环；老 daemon 字段可选、缺省显示「未知」；cursor-agent 回放 token 恒「未知」（数据不落盘，非解析器可解）

## D-005@v1
状态：implemented
变更：2026-09-19-tool-report-session-replay
锚点：sillyhub-daemon/src/agent-log/parse-zcode-model-io.ts（extractModelIoLine 需补读顶层字段）
最近确认：53c67e02a
理由：zcode 按顶层 turnId 聚轮（实证 115 次调用聚 3 轮：子代理通知续跑/系统提醒/真人提问各一）；cursor-agent transcript 按 turn_ended 事件切轮；claude-code 按真人 user 消息天然切轮；每轮可挂自己的 token 小计；CLI 命令原文不在任何日志中（边界有、命令文本无），轮起点的「用户气泡」有真人文本用原文、无则用系统事件标记

## D-006@v1
状态：implemented
变更：2026-09-19-tool-report-session-replay
锚点：sillyhub-daemon/src/agent-log/registry.ts:57（PARSERS 单项注册表——扩展点）
最近确认：53c67e02a
理由：claude-code-jsonl 新增解析器并注册（对话化 + usage 一起落地，含 D-003 归一化）；cursor-agent CLI transcript 新增扫描上报（~/.cursor/projects/*/agent-transcripts/，现 96 份零上报）+ 新增解析器（结构干净 {role,message} JSONL + turn_ended，非 Claude Code 同构）；cursor IDE store.db（cursor-chat-sqlite）维持不做对话化（blob 库、无 token），但其 409 死胡同需给出像样说明；zcode 既有解析器补 D-004/D-005 字段

## D-008@v1
状态：implemented
变更：2026-09-19-tool-report-session-replay
锚点：decisions.md D-001/D-004/D-007
最近确认：53c67e02a
理由：方案A——前端适配器把 NormalizedLogMessage[] 映射为 SessionTurnView 喂 TurnTimeline 真组件；daemon zcode 解析器补 usage/turnId/model/累计 + 新增 claude-code、cursor-agent 解析器与 cursor-agent 扫描上报；平台 messages schema 加可选字段 + gen:types；平台库零表结构改动，按需现读

## D-001@v1 根治方案选 A——全链强制 workspace_id + daemon 映射查根
状态：implemented
变更：2026-09-09-conflict-root-workspace-scoping
锚点：未记录
最近确认：35f3d6528
理由：**方案 A**。对比 RPC `sillyspec_conflict_snapshot` 与裁决指令 `sillyspec_resolve` 全链（REST 请求体 → WS payload → daemon 消息处理 → 前端弹窗下传）强制携带 `workspace_id`；daemon 用 `_sillyspecStatusRoots.get(workspaceId)` 解析根，**映射未命中不得回退单槽位**，抛 RpcError `workspace_root_unknown`（提示该工作区尚未被本机会话认领）；无 workspace_id 的旧调用形态保留单槽位 legacy 语义。辅防：无 workspaceId 的 claim 不再覆盖单槽位。与根因文档 `docs/sillyspec/conflict-compare-wrong-status-root.md` 已定稿口径一致。

## D-001@v1 P0-1 artifact 承接通道与 kind 取值
状态：implemented
变更：2026-09-10-review-dispatch-platform-fixes
锚点：未记录
最近确认：f1bdbef95
理由：用户原话「daemon 在 worker 终态时把最终 assistant 消息（或 worker 按约定标记的结构化段）落为 kind=summary/kind=final_output 的 artifact」。实现取：复用 backend worker_done 端点现成语义（AgentArtifact kind=summary 挂分身首 run，可重复置位取最新），kind 沿用 summary——sillyhub-daemon/src/mcp-server.ts:542-547 已向调用方声明该契约，final_output 全仓不存在，新值徒增消费方分支。

## D-002@v1 P0-2 独立配额池的作用域与实现层次
状态：implemented
变更：2026-09-10-review-dispatch-platform-fixes
锚点：未记录
最近确认：f1bdbef95
理由：用户原话「支持按 workspace 或按 agent_profile 独立配置（独立池或不同 provider）」。探查证实 profile 绑定链路已全通，真缺口=llm_provider schema 锁死 claude + daemon injector REGISTRY 无 pi；补齐后 per-(user, agent_kind=pi) 默认与 profile/workspace(default_agent_profile_id) 两条路都开放，不在本变更里强选一条。

## D-003@v1 隐藏/系统注入消息过滤判据
状态：implemented
变更：2026-09-10-zcode-session-sqlite-read
锚点：未记录
最近确认：20cf7bc46
理由：message.data.semantics.uiVisibility=='hidden' || transcriptVisibility=='hidden' || visibility=='model-only' 任一命中即整条跳过；对齐文件 parser 剥 `<system-reminder>` 的既有语义。

## D-004@v1 tool part 单条产 tool_use + tool_result 两段
状态：implemented
变更：2026-09-10-zcode-session-sqlite-read
锚点：未记录
最近确认：20cf7bc46
理由：单条 part（data={tool, callID, state:{status, input, output|error, …}}）产两段：tool_use（input 2KB 摘要）+ tool_result（output 4KB 摘要，is_error=status=='error'）；status ∈ running/pending（无 output）只产 tool_use。

## D-001@v1 非 claude 引擎完整开放会话级供应商切换（含「不指定（本机默认）」）
状态：implemented
变更：2026-09-11-session-provider-switch-codex-pi
锚点：sillyhub-daemon/src/codex-settings.ts, sillyhub-daemon/src/provider-file-settings.ts（新增）
最近确认：225dd771d
理由：用户裁决：肯定要开放——本变更的目的就是与 claude 完全对齐。技术落地（保住不丢历史）：codex 切回本机默认**不丢 CODEX_HOME**（thread 历史存在 `$CODEX_HOME/sessions` 下，丢目录即断 resume），改为把宿主 `~/.codex` 的 auth.json / config.toml **镜像拷贝**进 per-session 目录（宿主无文件则清空 = 如实反映宿主未登录）；pi 切回本机默认 = 丢弃 `PI_CODING_AGENT_DIR` env 回宿主 `~/.pi`（pi 会话历史在 daemon 自管 `--session-dir`，pi-rpc-driver.ts:719，不受影响）。

## D-003@v1 daemon 侧接入点 = reload 内核统一接入（方案 A）
状态：implemented
变更：2026-09-11-session-provider-switch-codex-pi
锚点：sillyhub-daemon/src/interactive/session-manager.ts:_reloadSessionNow
最近确认：225dd771d
理由：用户裁决方案 A：把 applyProviderFileSettings（+ codex null 切换宿主凭证镜像扩展）从 task-runner.ts 抽到独立共享模块（provider-file-settings.ts），session-manager `_reloadSessionNow` 构造 newEnv 时对 codex/pi kind 调用并把 CODEX_HOME / PI_CODING_AGENT_DIR 并入新 env（文件层 env 最后合并盖过下层，与 daemon.ts:8285 spawn 路径同模式）；顺带删 reloadWithProvider 的 claude-only 守卫（session-manager.ts:1502）使 PROVIDER_CONFIG_CHANGED 默认供应商热切换对 codex/pi 也走确定性 reload。否决 B（payload 携带实现细节字段污染消息契约 + 热切换路径享受不到）、C（破坏 driver provider-neutral 契约）。

## D-002@v1 触发时机=仅 turn 空闲可压（轮中禁用）
状态：implemented
变更：2026-09-14-session-ctx-compact
锚点：未记录
最近确认：1aacbb3d9
理由：用户选「仅空闲时可压」——turn running 时按钮禁用（提示「轮运行中」），turn 空闲后才可压缩；不打断用户正在跑的任务（各引擎原生 /compact 也都是空闲交互语义）。

## D-003@v3 pi/codex 结果回传定案 ws RPC（send_rpc + registerRpcHandler），砍 SESSION_COMPACT 控制机器
状态：implemented
变更：2026-09-14-session-ctx-compact
锚点：未记录
最近确认：1aacbb3d9
理由：复用既有 ws RPC 请求-结果通道：backend 端点 ws_hub.send_rpc(daemon_id, 'session_compact', {session_id}, timeout=15)（backend/app/modules/daemon/ws_hub.py:502-560，DaemonRpcTimeout/Offline/RemoteError 异常齐备）；daemon 侧 registerRpcHandler('session_compact')（sillyhub-daemon/src/daemon.ts:6438-6456 既有四先例）→ sessionManager.compact → CompactResult 即 RPC result。SESSION_COMPACT 控制机器三件套（backend protocol.py/control_commands.py + daemon protocol.ts/daemon.ts 三点接线）全部弃用；「无 schema 迁移 / control-dispatcher 零改动」在 v3 下为真。
supersedes：D-003@v2（仅回传机制部分，其余维持）

## D-002@v1 架构=compact 同款 RPC 模式（可选 driver 方法+daemon RPC handler+caps 键）
状态：implemented
变更：2026-09-14-session-thinking-level
锚点：未记录
最近确认：28915f71b
理由：方案 A：照 2026-09-14-session-ctx-compact 刚验证的 RPC 模式——driver.ts 加可选 `getThinkingLevels?(handle)`/`setThinkingLevel?(handle, level)` 两契约方法；daemon.ts 注册 `session_get_thinking_levels`/`session_set_thinking_level` 两 RPC handler；backend 两端点（GET 档位列表+POST 切换）；caps 第 13 键 `thinking_level`（claude/pi/codex=true、cursor=false）。B（进程重启式）否决：切档重启子进程丢流式状态体验差；C（inject 文本）否决：pi/codex 不认文本且档位查询无通道。
