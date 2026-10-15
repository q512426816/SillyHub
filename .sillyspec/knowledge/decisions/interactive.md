# 决策知识 — interactive

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 实施路线——渐进下沉（双轨兼容）而非契约替换或最小注册表
状态：implemented
变更：2026-09-03-agent-provider-abstraction
锚点：未记录
最近确认：c6c74aa49
理由：方案A 渐进下沉。driver 内归一化吐 AgentEvent，backend/前端双轨兼容新旧两种事件格式，验证稳定后再退役旧文本协议（退役为后续 change）

## D-002@v1 会话级信号的承载方式——status 事件 subtype + 有状态归一化器，raw 降格为调试通道
状态：implemented
变更：2026-09-03-agent-provider-abstraction
锚点：未记录
最近确认：c6c74aa49
理由：①会话级信号全部事件化为 status 型 + subtype 枚举（session_started/bash_status/plan_mode/agent_task_status/task_notification），SessionManager 改按 subtype 分发；②depth 状态机等跨消息状态由有状态归一化器类（ClaudeEventNormalizer，每会话实例）内部维护；③envelope.raw 仅在 SILLYHUB_DEBUG_RAW_EVENTS=1 时携带，下游禁止依赖（cli.ts 的 SDKMessage 接线随之演进）

## D-003@v1 usage 实时透传语义——任意携带 usage 的事件即更新，不限 turn_result
状态：implemented
变更：2026-09-03-agent-provider-abstraction
锚点：未记录
最近确认：c6c74aa49
理由：对齐现行为：任意携带 usage 的 AgentEvent（含 partial text/thinking flush 事件）→ daemon lift → backend 更新 agent_runs token 统计 + SSE summary 实时透传（现链路锚点 daemon.ts:3564-3586、service.py:357-370）

## D-004@v1 partial override 撤回的事件化表达——override:true + segment_id
状态：implemented
变更：2026-09-03-agent-provider-abstraction
锚点：未记录
最近确认：c6c74aa49
理由：text/thinking 事件增加可选 override:boolean——true 表示替换同 segment_id 已落库 partial 行；backend 行为对齐现有 stale 撤回链（DELETE by (run_id, segment_id) → INSERT）。partial/override 归一化逻辑移植自 daemon session-manager 现实现（非 backend _extract_sdk_messages，后者对 stream_event 恒返回空）

## D-005@v1 AgentEvent v2 契约补遗——status 增 thinking_tokens 子类型、usage 增 ctx_tokens 字段
状态：implemented
变更：2026-09-03-agent-provider-abstraction
锚点：未记录
最近确认：c6c74aa49
理由：契约微扩：AgentStatusSubtype += 'thinking_tokens'；AgentEventUsage += ctx_tokens?: number。归一化器对应产出（thinking_tokens 子类型事件、usage 差分携带 ctx_tokens）

## D-006@v1 双轨渲染已知改进差异的取舍——主 agent Task tool_result 配对（新轨 call_id 优先）与 cache_* 完整帧聚合（新轨更全）
状态：implemented
变更：2026-09-03-agent-provider-abstraction
锚点：未记录
最近确认：c6c74aa49
理由：均接受为已知改进差异（新轨行为更正确），以豁免/可执行登记形式固化（dual-path fixture 豁免 #2 + TestDocumentedFormatDivergences/§2 差异冻结测试），不要求新轨复刻旧轨缺陷；旧轨本身零改动（回退轨保真）

## D-001@v1 cursor 交互式 driver 架构——每轮 respawn + --resume chatId 薄 driver
状态：implemented
变更：2026-09-08-cursor-interactive-session
锚点：未记录
最近确认：35f3d6528
理由：方案A 每轮 respawn。每个 UserTurnInput spawn 一次 `cursor-agent -p --output-format stream-json [--resume chatId] [--model] <prompt>`，NDJSON 逐帧归一化为 AgentEvent v2，result 帧 + 进程退出 = turn 收敛；chatId 从帧内 session_id 捕获（`create-chat` 子命令兜底）；Windows 经 resolveWindowsCmdShim（含 cursor 坏 ps1 版本目录增强）。B/C 否决：worker 实测是 Cursor 云端 worker 注册通道（K8s 探针/标签/池分配，非本地 stdio 会话协议）；cursor-agent 无 --input-format/SDK 控制协议（批量适配 D-008@v1 已证参数集分叉），ClaudeSdkDriver 握手必挂

## D-002@v1 接入范围——仅交互式会话最小闭环
状态：implemented
变更：2026-09-08-cursor-interactive-session
锚点：未记录
最近确认：35f3d6528
理由：仅最小闭环：补齐交互式会话链路（driver + 归一化器 + 注册表 + 三端 caps + 前端白名单 + 测试 + 冒烟），对齐 pi 接入先例。liveness 推导器注册与平台侧 Cursor 凭证配置（llm_provider agent_kind 扩展 + CursorCredentialInjector）留后续变更

## D-004@v1 caps 守护测试 EXPECTED_PROVIDERS 同步必改（Grill B-01）
状态：implemented
变更：2026-09-08-cursor-interactive-session
锚点：未记录
最近确认：35f3d6528
理由：否。`backend/app/modules/agent/tests/test_provider_caps_alignment.py:52` EXPECTED_PROVIDERS 为硬编码 `{"claude","codex","pi"}`，test_provider_sets_identical 对三端表断言集合相等——三端表加 cursor 后守护测试必失败。必须同 commit 同步 EXPECTED_PROVIDERS 加 'cursor'（pi 接入 commit 7c4dd4efd 同款先例）。设计文件清单已补该文件

## D-003@v2 聚合形态 = 编译期聚合（落点修订）
状态：implemented
变更：2026-09-11-provider-adapter-registry
锚点：未记录
最近确认：f0211bbcf
理由：Grill 复审发现 @v1 表述「新建 provider-adapter.ts」与实际最优落点不符——ProviderDescriptor（providers.ts:262）已承载五要素，原地扩展 INTERACTIVE_PROVIDERS 为 ProviderAdapter 聚合表改动面最小。@v2 修订：落点=providers.ts 内扩展，不另立契约文件。
supersedes：D-003@v1

## D-001@v1 修复方案——锚点 + 协议标记（方案 A）
状态：implemented
变更：2026-09-15-background-task-permission-lockout
锚点：未记录
最近确认：e21bf19cc
理由：A。daemon `onResult` 在会话的后台任务注册表非空时保留 currentRunId 作后台锚点（任务全部终态注销时清）；写通道守卫 `writeChannelGuardDeny` 新增「status=active + currentRunId 在 + 注册表有存活任务」放行条件；权限请求协议加 `background_task` 标记，backend `handle_permission_request` 据此放宽 active-turn 校验为「按 run_id 直查 + 会话归属校验」
故障面：注册表泄漏（task_notification 永不到达）会让锚点 currentRunId 永不清 → 守卫放行窗口变长；缓解＝锚点仅在 status=active 时有效，下一次 inject 正常切新 run，写策略/人审链路仍全程生效，放行的只是「通道存在性」而非权限本身
退役判据：SDK 未来提供 per-task 权限上下文（canUseTool 带 task 归属）时，锚点机制可退役为直连 task→run 权限路由

## D-008@v1 rejected：方案 B 文件设置层透传（driver 层零改动）
状态：rejected
变更：2026-10-10-all-engines-mcp-injection
锚点：未记录
最近确认：a62c8e24d
理由：否决。
否决理由：MCP_SESSION_ID env 注入、mcpRefs 白名单过滤、内置双 server 运行时组装都在 driver-factory 层现成，文件层透传要把这套逻辑重做一遍且 cursor 无 per-session 文件层，driver.ts 契约（driver.ts:300-320）预留方向本就是 driver 透传。
复潮条件：driver 选项管道被废弃重构，或各引擎文件层原生支持 per-session env 注入时重评。

## D-009@v1 rejected：方案 C 分引擎灰度（先 pi+codex，cursor 观望）
状态：rejected
变更：2026-10-10-all-engines-mcp-injection
锚点：未记录
最近确认：a62c8e24d
理由：否决。
否决理由：与用户「一起打通」的明确表态冲突；spike 驱动本身已提供逐引擎降级保护（D-003/D-004），无需预设灰度。
复潮条件：SPIKE-00/01/02 集体失败导致全引擎不可行时，按引擎逐个降级收口。

## D-010@v1 rejected：路线 B（vendor 自写桥接扩展为主路径，不升级 pi 基线）
状态：rejected
变更：2026-10-10-all-engines-mcp-injection
锚点：未记录
最近确认：a62c8e24d
理由：否决（用户明确选路线 A）。
否决理由：pi 1.0（2026-10-01）已原生支持 MCP，上游在演进原生 MCP；保持 0.81.1 + 自写桥接偏离上游演进，桥接层长期自维护成本高。
复潮条件：SPIKE-00 显示 pi 1.0 rpc/extension 面大改、升级适配成本显著超过自写桥接时重评。

## D-001@v1 : 注入通道选前导拼接，不动 system_prompt 与 daemon
状态：implemented
变更：2026-08-29-session-user-preamble
锚点：未记录
最近确认：c7346118
理由：现有 4 条注入通道中选「前导拼接」：backend `daemon/session/context.py` 新增前导构建函数，`session/service.py` create_session 的 `_prefix_parts` 接线（变更/页面/PPM/团队简报四前导同款模式）。否决 system_prompt 通道（仅 claude 消费，codex 不支持，且是 per-AgentProfile 语义）与 daemon 侧注入（daemon 纯透传、不认识用户）。

## D-002@v1 : 仅首轮注入 + 覆盖重派重渲染路径；后续轮次与服务身份注入不带
状态：implemented
变更：2026-08-29-session-user-preamble
锚点：未记录
最近确认：c7346118
理由：仅首轮（用户信息+规则留在上下文持续生效，避免每轮膨胀）；掉线重派（batch-session-inherit 的 prompt 重渲染路径）须确认重渲染时同样带上。后续轮次 `_inject_into_session` 与平台审批代写等服务身份注入不带用户前导（由「仅首轮」自然满足）。

## D-003@v2 : 不加 Role 字段，角色名称直接给 agent 自行判断沟通风格
状态：implemented
变更：2026-08-29-session-user-preamble
锚点：未记录
最近确认：c7346118
理由：用户在 brainstorm step 6 明确推翻 Role 加字段方案：「直接给角色名称给 agent 分析就行，不要加字段了」。用户信息块内列出角色名称原文 + 一小段静态沟通适配指引文案，由 agent 根据角色名自行判断用业务语言还是技术语言。无 schema 迁移、无 admin/前端改动，变更范围缩小为 backend daemon/session 模块。
supersedes：D-003@v1

## D-004@v1 : SillySpec 工具规则条件注入（工作区根存在 .sillyspec/ 才拼）
状态：implemented
变更：2026-08-29-session-user-preamble
锚点：未记录
最近确认：c7346118
理由：条件注入：仅会话绑定的工作区根目录检测到 `.sillyspec/` 目录才拼入。无条件注入会诱导 agent 在非 SillySpec 项目擅自 `sillyspec init` 污染用户仓库。无工作区会话不注入该块。

## D-005@v1 : batch（批量任务）路径本期不注入
状态：implemented
变更：2026-08-29-session-user-preamble
锚点：未记录
最近确认：c7346118
理由：本期仅做交互会话（interactive session）；batch 已有 CLAUDE.md prepend 通道，将来可复用同一套模板函数，不纳入本变更范围。

## D-007@v1 : 整体方案选 A（后端前导拼接 + Role 受众字段），否决 B（纯 prompt 猜测）与 C（system_prompt 通道）
状态：implemented
变更：2026-08-29-session-user-preamble
锚点：未记录
最近确认：c7346118
理由：用户在 explore 阶段看到完整对比表后确认「帮我实现吧」= 选 A。A 是唯一同时满足 D-001~D-006 的方案；B 违反 D-003（自由文本角色名不可靠推断）且画像判定失控；C 违反 D-001（codex 不支持 systemPrompt，provider 不对称）。
