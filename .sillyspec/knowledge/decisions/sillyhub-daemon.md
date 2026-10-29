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

## D-001@v1 方案选型：谓词能力化 + 各 driver 原生消费 mcpServers
状态：implemented
变更：2026-10-10-all-engines-mcp-injection
锚点：sillyhub-daemon/src/cli.ts:993（isMainAgentSession 谓词）
最近确认：a62c8e24d
理由：方案 A——daemon 谓词按能力矩阵放开（caps.mcp 驱动），各 driver start() 原生消费 mcpServers 写各自引擎的 per-session 配置（pi=PI_CODING_AGENT_DIR、codex=CODEX_HOME config.toml、cursor=spike 定落点、claude=现状不动）。
故障面：谓词能力化后，某引擎 caps 翻 true 但其 driver 消费通道有缺陷时，平台 MCP 配置会注入到无法正确消费的引擎会话（工具不可见或调用挂起）——由 SPIKE 前置 + 翻值与实测绑定（D-003/D-004/D-006）与单点回退兜底
退役判据：各引擎原生统一 MCP 配置协议成熟且 daemon 三套 per-session 落盘通道可合并为一套通用机制时，收编单通道

## D-005@v1 pi MCP 形态优先级：原生配置 > 官方 adapter > vendor 自写扩展兜底
状态：implemented
变更：2026-10-10-all-engines-mcp-injection
锚点：sillyhub-daemon/src/pi-settings.ts:210
最近确认：a62c8e24d
理由：按 SPIKE-00 结论择优：优先 pi 1.0 原生 MCP 配置（若 settings.json/等价机制原生支持）；其次官方 pi-mcp-adapter 扩展（读 .mcp.json，vendor 经现有 --extension 通道装载）；兜底 vendor 自写桥接扩展（仿 ask-user 扩展形态 registerTool）。
故障面：pi 形态分叉（①原生/②adapter/③自写）若在 SPIKE 后仍选错，MCP 配置落盘位置与 pi 实际读取位置错位——工具静默不可见；依赖 SPIKE-00 实测留档为唯一裁定依据
退役判据：pi 后续版本原生 MCP 配置稳定（settings.json mcpServers 或等价键成为官方唯一推荐）后，砍掉 adapter/自写扩展两档兜底

## D-006@v1 codex 走 config.toml [mcp_servers.*] 托管段差量替换
状态：implemented
变更：2026-10-10-all-engines-mcp-injection
锚点：sillyhub-daemon/src/codex-settings.ts:38
最近确认：a62c8e24d
理由：扩展 codex-settings.ts 现有托管段差量替换机制写 [mcp_servers.<name>]（command/args/env）；SPIKE-01 实测 app-server 协议模式下是否生效，不生效则评估 initialize capabilities 实验位，仍不通则降级暂缺。
故障面：config.toml 托管段序列化缺陷（数组/子表转义错）可能产出 codex 无法解析的 config.toml，导致 codex 会话启动失败——序列化必须带往返（round-trip）单测覆盖
退役判据：codex 官方提供 per-session MCP 配置 CLI 参数或 app-server 协议级 MCP 注入方法后，迁移至官方通道、托管段序列化器退役

## D-011@v1 执行期裁决：SPIKE-01/02 因宿主引擎不可用受阻，codex/cursor 维持 false 留复评
状态：implemented
变更：2026-10-10-all-engines-mcp-injection
锚点：sillyhub-daemon/src/interactive/providers.ts:226（codex caps 注释块，task-08 留档落点）
最近确认：a62c8e24d
理由：codex 0.162.0 主包在但缺 @openai/codex-win32-x64 平台二进制（npmjs ETIMEDOUT 限断、npmmirror 未同步、yarnpkg 断连，多路重试均失败）；cursor-agent CLI 未安装且同网络无法安装。按 D-003/D-006 红线（禁止无实测证据翻值）：codex.mcp/cursor.mcp 维持 false；codex 通道机制代码（config.toml [mcp_servers.*] 序列化+单测）照计划交付（机制就绪待复评，翻值即活），cursor 通道走留档分支（注释三要素）。
故障面：机制代码与 caps 状态暂时分离（codex 代码就绪但 false）——翻值动作被 D-003/D-006 红线锁在 SPIKE 复评之后，防止未验证通道进生产会话
退役判据：codex/cursor 引擎在宿主可用且 SPIKE-01/02 复测通过翻值后，本裁决自动失去约束对象

## D-012@v1 执行期裁决：pi/codex MCP 写盘调用点定在 driver start（非 providers.ts 薄适配）
状态：implemented
变更：2026-10-10-all-engines-mcp-injection
锚点：sillyhub-daemon/src/interactive/pi-rpc-driver.ts:844（start 内写盘调用块）
最近确认：a62c8e24d
理由：writePiMcpConfig/writeCodexMcpServers 作为 pi-settings/codex-settings 导出的独立纯写盘器，调用点在各自 driver start()（运行时函数体内调用）——从 opts.mcpServers + opts.env（PI_CODING_AGENT_DIR/CODEX_HOME）取双参数。懒调用纪律的实质是"模块初始化零跨表求值"（防 ESM TDZ 环），driver start 运行时调用与 providers.ts writer 函数体内调 writePiDir 同性质，不破坏该纪律（pi-settings/codex-settings 均无回引 interactive/ 的反向依赖，无环）。
故障面：driver 内写盘使"配置落盘"与"spawn"耦合在同一函数——写盘失败已按降级 warn 不阻断 spawn 处理（MCP 为增强能力），无新增失败传播面
退役判据：若未来 daemon 侧统一 provider 文件层与 MCP 注入为单次写盘事务，可迁回薄适配模式

## D-013@v1 执行期裁决：task-09 验收方式为引擎侧全链 + 线上复验项
状态：implemented
变更：2026-10-10-all-engines-mcp-injection
锚点：.sillyspec/changes/2026-10-10-all-engines-mcp-injection/acceptance-e2e.md
最近确认：a62c8e24d
理由：引擎侧全链验收（配置注入→pi 连接→工具面可见→JSON-RPC 直调→HTTP 到达本地 backend 401 结构化错误）作为 FR-09 的交付证据；真实上传落文件中心列为 daemon 部署本变更构建后的线上复验项（凭证由 daemon 注入链自动携带，复验动作=平台 pi 会话内让 agent 调 upload_file）。
故障面：引擎侧全链不含 backend 会话定位真实链（e2e 假凭证 401 即止）——生产真实上传的唯一未验证面，由线上复验项闭合
退役判据：daemon 部署后线上复验通过（真实上传成功落文件中心），本裁决的复验项闭环

## D-001@v1 daemon 上行同步执行「串行两条 CLI」（platform sync --change + platform sync-docs --change）
状态：implemented
变更：2026-10-13-change-files-refresh-sync
锚点：未记录
最近确认：76ea8a958
理由：串行两条：先 `sillyspec platform sync --change X`（spec 树增量 → apply_ops 落平台镜像目录 + 进度六表，文件树变新鲜）再 `sillyspec platform sync-docs --change X`（四件套全文 upsert 进 DB documents 列）。字面与目标双覆盖；无差异时两条均秒级短路。

## D-002@v1 触发机制采用「GET 内同步 RPC」（send_rpc 阻塞等 daemon 跑完再返回）
状态：implemented
变更：2026-10-13-change-files-refresh-sync
锚点：未记录
最近确认：76ea8a958
理由：GET files 端点内经 DaemonWsHub.send_rpc(daemon_id, 'sillyspec_sync_change', {change, workspace_id}, timeout=15) 同步等 daemon 串行跑完两条 CLI 后再 list_files 返回。刷新一次即最新数据；改动面 backend+daemon 两端，前端零改动。

## D-004@v1 daemon 侧防抖——15s TTL + in-flight 去重（模块级内存 Map）
状态：implemented
变更：2026-10-13-change-files-refresh-sync
锚点：未记录
最近确认：76ea8a958
理由：daemon handler 内模块级 Map<workspaceId:change, 时间戳>：15s 内已同步过返回 {skipped:'debounced'} 秒回；同 key 在跑返回 {skipped:'in_flight'}。单机内存态不落盘——daemon 重启清零属可接受（首次刷新重新同步一次）。

## D-002@v1 日志采用拉取尾部+手动刷新（非实时流）
状态：implemented
变更：2026-10-13-daemon-log-config-view
锚点：未记录
最近确认：255a46d66
理由：用户选「拉取尾部+手动刷新」：点开查看最近 N 行（默认可调），带刷新按钮；不做 WebSocket 实时滚动
故障面：大日志文件全量读取导致 RPC 超时——须在 daemon 侧或 backend 侧限制返回尾部字节上限
退役判据：未来出现「盯日志实时排障」高频诉求时，再评估升级为 WS 实时流（可基于现有 daemon:ws 通道扩展）

## D-004@v1 采用方案 B——daemon 专用诊断 RPC（log_tail + config_get）
状态：implemented
变更：2026-10-13-daemon-log-config-view
锚点：未记录
最近确认：255a46d66
理由：用户选方案 B：daemon 注册 daemon_log_tail 与 daemon_config_get 两个 RPC handler（路径由 daemon 侧 getLogFile()/loadConfig 权威解析，尾部截断与脱敏在源头做），backend 新增转发端点（复制 daemon_rpc.py 先例），前端 /runtimes 机器卡加入口。理由：路径权威（SILLYHUB_DAEMON_DIR 重定向不影响）、大文件不全量传、脱敏贴近数据源
故障面：老 daemon（未升级）无这两个 RPC → method_not_found；需在 backend 映射 422 + 前端升级提示
退役判据：若未来 host_fs RPC 支持按约定 key 寻址 + tail 参数，可考虑合并回通用文件读通道

## D-backend-025@v1 治理技术方案选型——子进程封装 + WS 推送 + 预览持久化（方案 A）
状态：implemented
变更：2026-10-16-backend-mem-polling
原编号：D-001@v1
锚点：backend/app/modules/knowledge/vector_search.py:137
最近确认：439cdc46c
理由：**方案 A**。四个机制组合：①嵌入计算子进程封装（闲置自退+OOM 保主进程）；②change-writes 改 WS 事件推送，30s 轮询降 120s 兜底；③会话标题预览持久化为列；④部署内存配额重分配。

## D-backend-026@v1 深扫发现的三处高危内存缺陷纳入本变更任务面
状态：implemented
变更：2026-10-16-backend-mem-polling
原编号：D-004@v1
锚点：backend/app/modules/knowledge/vector_search.py:168
最近确认：439cdc46c
理由：纳入。①knowledge/vector_search.py `_indexes` 无界索引缓存（LRU 工作区上限）；②spec_workspace/service.py `_bundle_gzip_cache` 无全局帽（128MB LRU）；③permission_service.py 权限定时器 pin 已关 session 且 route_key None 路径不提交（idle-in-transaction 元凶，新开短 session+全路径提交）。中危配套（ws_hub _pending_rpcs 泄漏两径/disconnect 无身份校验/附件先读后检/WS 大消息日志）一并治理。

## D-sillyhub-daemon-001@v1 落选——新增 daemon「列记录」RPC（方案 C）
状态：rejected
变更：2026-10-16-conflict-full-tree-compare
原编号：D-011@v1
锚点：未记录
最近确认：d3c425bf6
理由：方案 C 落选（用户选 A）。
否决理由：必须等 daemon 自更新铺开才生效，新增 RPC 带来协议/权限/测试成本，而当前机器侧只有 full-tree 一种已成形形态，收益是假想的未来变化。
复潮条件：机器侧出现第三种以上记录命名形态（如按工作区/轮次改名）导致「猜名字」清单不可维护时，重议升级为目录发现。

## D-backend-035@v1 方案 A——平行状态接口 + 前端 join（选定）
状态：implemented
变更：2026-10-25-explorer-git-status
原编号：D-007@v1
锚点：sillyhub-daemon/src/daemon.ts:7803
最近确认：19783ad99
理由：用户选定方案 A——daemon 新增「改动文件清单」（porcelain v2 文件行 + ignored --directory 聚合 + numstat）与「工作区单文件 vs HEAD diff」两个平名 RPC，backend 暴露两个只读端点；前端一次拉清单建 path→status 映射，explorer 树着色与 Git 日志页修改集合同源消费
故障面：状态清单为拉取式快照，daemon 侧文件变动后页面不自动变色——需手动刷新或重新进页
退役判据：出现「多端同改工作区需秒级感知」的真实场景时重议推送（见 D-009）

## D-backend-036@v1 覆盖范围=盲区补齐 + 轮内统一阶段轴
状态：implemented
变更：2026-10-26-session-stage-progress
原编号：D-002@v1
锚点：`backend/app/modules/daemon/control_commands.py`、`sillyhub-daemon/src/daemon.ts`
最近确认：cf17c6a9f
理由：盲区+统一阶段轴——静默盲区（平台转发→执行器领取→启动准备→等待首响）补齐信号，并把 AI 干活期间已有信号（执行命令/工具调用/输出间隙）统一映射到同一阶段文案体系。
故障面：统一阶段轴依赖三端词表同步——任一端词表漂移（新增 phase 未同步前端映射）会显示原始英文 phase 值；已由兼容策略「未知 phase 显示原始字符串兜底」覆盖。
退役判据：若阶段体系演进为服务端驱动的通用任务阶段模型（跨会话/任务类型复用），本词表并入更大模型后本决策由 v2 收编。

## D-backend-037@v1 实现方案=方案 A 阶段事件推送（新增 turn_phase 事件 kind）
状态：implemented
变更：2026-10-26-session-stage-progress
原编号：D-004@v1
锚点：`backend/app/modules/daemon/router/notify.py`、`sillyhub-daemon/src/daemon.ts`、`frontend/src/lib/daemon/session-sse.ts`
最近确认：cf17c6a9f
理由：方案 A——新增会话 SSE 事件 kind `turn_phase`。启动准备各步骤边界由 daemon 经既有 endStep 钩子新增 HTTP 上报端点发出（照抄 notify_bash_status 已验证模式）；平台转发段由 backend 在控制指令状态机翻转点（delivered/acked）直接发布（零 daemon 改动）；轮内阶段由已有事件映射。前端 SessionEventKind 加 kind、分发器加 case、状态条消费。
故障面：SSE 无历史（Redis pub/sub 无持久化），断线/刷新期间错过的阶段事件不可回放，重连后只能显示最新已知阶段或回退兜底文案——属轻量形态（D-001）可接受范围。
退役判据：若后续引入会话事件持久化回放（可查询历史阶段轨迹），单行实时文案可升级为轨迹回看而不废弃事件本身。

## D-backend-040@v1 阶段展示精度包——at 时钟源/run_id 必填/轮终态清理/防重键/并行边界
状态：implemented
变更：2026-10-26-session-stage-progress
原编号：D-013@v1
锚点：frontend/src/components/daemon/session-panel/turn-state.ts、sillyhub-daemon/src/interactive/session-manager/events.ts
最近确认：cf17c6a9f
理由：我的判断：① at=客户端本地 Date.now()（事件到达时刻，规避时钟偏移）；② run_id 必填（daemon 恒带 firstRunId，daemon.ts:9522 守卫后必非空——「create 前 run 未定」原假设与代码不符），前端对缺失 run_id 的 phase 事件防御丢弃；③ turn_completed/failed/killed 终态分支清空 currentPhase（兑现 R-01「不显示陈旧值」，防断线场景假超时警示）；④ first_event 防重键=(session_id, run_id)（run 级标志，新 AgentRun 自然重置）；⑤ 冷启动三步 Promise.all 并行保持独立上报+覆盖式刷新（跳动亚秒级真实，聚合文案违背轻量）；SWR 跳过步不发事件。
故障面：终态清理若漏接（如新增终态类型未清 phase）会复现假警示——测试断言面需覆盖全部终态枚举。
退役判据：无——精度规则跟随轮生命周期语义。

## D-frontend-024@v1 长操作实时感知走独立 turn_heartbeat 事件通道
状态：implemented
变更：2026-10-29-engine-live-perception
原编号：D-001@v1
锚点：sillyhub-daemon/src/types.ts:AgentEvent
最近确认：de68b356befe540e0c77695de92216fb36c1a5e9
理由：用户选定方案二（新增独立心跳事件），事件名细化为 turn_heartbeat（防与 hub-client 机器级 heartbeat 同名混淆，命名细化不改变决策语义）。载荷：kind（awaiting_first_token/generating_tool_args/generating_text）+ est_chars/est_tokens + precision（authoritative/estimated）+ source + parent_tool_use_id；不落库只透传、节流 1s、估算系数 3.5 字符/token（三项 agent 代定，用户核阅无异议）。估算值与权威 usage 彻底分道：预算软切断、计费聚合、ctx 环零污染（对齐 2026-08-27「实时/终态口径必须同类」）；前端专道消费，估算补显标「约」+弱化灰、权威值落定即隐。
故障面：心跳节流器/计数器轮结束未清理导致跨轮残留（R-02）；估算值误入聚合（R-03，类型级排除防护）
退役判据：引擎侧（Claude SDK/智谱/codex）原生提供流式 usage 增量且覆盖工具参数期时，本心跳桥接层可简化退役
