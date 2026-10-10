---
author: qinyi
created_at: 2026-10-10 23:59:32
---

# 决策记录（Decisions）— 2026-10-10-all-engines-mcp-injection

> 本变更决策台账。只记录有实现/验收影响的决策；rejected 条目否决理由/复潮条件必填。

## D-001@v1 方案选型：谓词能力化 + 各 driver 原生消费 mcpServers
- type: architecture
- status: accepted
- source: user+code
- question: 全引擎 MCP 注入的落地架构选哪种？
- answer: 方案 A——daemon 谓词按能力矩阵放开（caps.mcp 驱动），各 driver start() 原生消费 mcpServers 写各自引擎的 per-session 配置（pi=PI_CODING_AGENT_DIR、codex=CODEX_HOME config.toml、cursor=spike 定落点、claude=现状不动）。
- normalized_requirement: 非 claude 引擎在 caps.mcp=true 时，主控/普通会话创建链路产出与 claude 相同的 MCP 配置表（platform ∪ workspace 三件套 + 内置双 server），由各 driver 按引擎原生机制落地生效。
- impacts: [FR-全引擎注入, cli.ts 谓词, driver-factory resolveMainAgentMcp, pi-rpc-driver, codex-app-server-driver, cursor-driver]
- evidence: sillyhub-daemon/src/cli.ts:993-997（现状谓词 provider!=='claude' 一律拒）；sillyhub-daemon/src/interactive/driver.ts:300-320（契约预留 driver 透传方向）；用户会话原话「路线 A，并且不仅仅要支持 claude code pi 还要支持其他的一起哦」+「确认，做完全部流程」
- priority: P0
- 锚点: sillyhub-daemon/src/cli.ts:993（isMainAgentSession 谓词）
- 模块域: sillyhub-daemon
- 故障面: 谓词能力化后，某引擎 caps 翻 true 但其 driver 消费通道有缺陷时，平台 MCP 配置会注入到无法正确消费的引擎会话（工具不可见或调用挂起）——由 SPIKE 前置 + 翻值与实测绑定（D-003/D-004/D-006）与单点回退兜底
- 退役判据: 各引擎原生统一 MCP 配置协议成熟且 daemon 三套 per-session 落盘通道可合并为一套通用机制时，收编单通道

## D-002@v1 分身 mission_worker 维持 claude-only
- type: governance
- status: accepted
- source: user+code
- question: 全引擎放开是否包含分身会话（mission_worker）？
- answer: 不包含。分身谓词 isWorkerSession 维持 claude-only，遵循既有治理决策 D-008@v1（2026-08-26-workspace-mcp-edit「分身维持受限注入，其放开另议」），本次不动。
- normalized_requirement: stage=mission_worker 的会话在任意引擎下均不进入本次放开范围；worker 受限注入行为与现状逐字节一致。
- impacts: [cli.ts isWorkerSession, driver-factory 分身分支]
- evidence: .sillyspec/knowledge/decisions/sillyhub_daemon_mcp.md（D-008@v1 原文）；sillyhub-daemon/src/cli.ts:1118-1120；用户会话（2026-10-10 brainstorm step3 输出列为可否决默认项，用户后续确认设计未推翻）
- priority: P1
- 锚点: sillyhub-daemon/src/cli.ts:1118（isWorkerSession 谓词）
- 模块域: sillyhub-daemon

## D-003@v1 cursor spike 驱动：实测不可用则如实标记暂缺
- type: scope
- status: accepted
- source: user+code
- question: cursor headless MCP 审批为上游已知坑，实测不可用时怎么办？
- answer: SPIKE-02 先行实测（headless 审批行为 + 配置落点隔离）；确认不可用则不强行 hack，caps cursor.mcp 维持 false，providers.ts 注释如实记录坑点与复评条件（上游修复后翻值）。
- normalized_requirement: cursor 通道的最终形态（true/false）以 SPIKE-02 实测记录为唯一依据；禁止在无实测证据时预翻 caps 值。
- impacts: [cursor-driver, providers.ts, SPIKE-02]
- evidence: 用户会话（brainstorm step3 可否决默认项，设计确认时未推翻）；cursor-driver.ts:95（现状显式忽略 mcpServers）；上游社区反馈 headless MCP 审批未实现（cursor forum/CI 场景）
- priority: P1
- 锚点: sillyhub-daemon/src/interactive/providers.ts:276（cursor caps 注释块）
- 模块域: sillyhub-daemon

## D-004@v1 SPIKE-00 pi 1.0 兼容总探先行，不兼容则截断暂缺
- type: risk
- status: accepted
- source: code
- question: 宿主 pi 0.81.1→1.0 升级对既有 pi 会话链路（rpc 协议/extension API）的破坏风险如何处置？
- answer: SPIKE-00 先行实测三项（rpc 事件流/session-dir/fork 协议兼容性、vendored ask-user/subagent 扩展装载、1.0 MCP 消费形态与 PI_CODING_AGENT_DIR 相互作用）；任一项不兼容且适配量大时截断为 pi.mcp 维持 false + 适配留档，本变更不失控。
- normalized_requirement: pi 通道翻值前置条件 = SPIKE-00 三项实测全通过；spi 基线升级不得破坏既有 pi 会话功能（resume/fork/ask-user/subagent）。
- impacts: [pi-rpc-driver, vendor/pi-extensions, SPIKE-00]
- evidence: sillyhub-daemon/src/pi-rpc-driver.ts:221（R-02 版本脆弱性注释：vendored 拷贝基线 pi 0.81.1）；pi-settings.ts:7（0.81.1 基线）
- priority: P0
- 锚点: sillyhub-daemon/src/interactive/pi-rpc-driver.ts:221
- 模块域: sillyhub-daemon

## D-005@v1 pi MCP 形态优先级：原生配置 > 官方 adapter > vendor 自写扩展兜底
- type: architecture
- status: accepted
- source: user+code
- question: pi 1.0 侧 MCP 消费形态选哪种？
- answer: 按 SPIKE-00 结论择优：优先 pi 1.0 原生 MCP 配置（若 settings.json/等价机制原生支持）；其次官方 pi-mcp-adapter 扩展（读 .mcp.json，vendor 经现有 --extension 通道装载）；兜底 vendor 自写桥接扩展（仿 ask-user 扩展形态 registerTool）。
- normalized_requirement: pi 最终落点必须是「per-session 隔离」的（PI_CODING_AGENT_DIR 重定向内），禁止写宿主全局 pi 配置；per-server env（含 MCP_SESSION_ID）必须随配置透传。
- impacts: [pi-settings.ts, pi-rpc-driver, vendor/pi-extensions]
- evidence: pi-settings.ts:210-216（settings.json 先读后写+未知键保留模式）；pi-rpc-driver.ts:830-842（--extension 装载通道）；vendor/pi-extensions/ask-user/index.ts:41-54（ExtensionAPI registerTool 形态）
- priority: P0
- 锚点: sillyhub-daemon/src/pi-settings.ts:210
- 模块域: sillyhub-daemon
- 故障面: pi 形态分叉（①原生/②adapter/③自写）若在 SPIKE 后仍选错，MCP 配置落盘位置与 pi 实际读取位置错位——工具静默不可见；依赖 SPIKE-00 实测留档为唯一裁定依据
- 退役判据: pi 后续版本原生 MCP 配置稳定（settings.json mcpServers 或等价键成为官方唯一推荐）后，砍掉 adapter/自写扩展两档兜底

## D-006@v1 codex 走 config.toml [mcp_servers.*] 托管段差量替换
- type: architecture
- status: accepted
- source: code
- question: codex 侧 MCP 配置注入通道？
- answer: 扩展 codex-settings.ts 现有托管段差量替换机制写 [mcp_servers.<name>]（command/args/env）；SPIKE-01 实测 app-server 协议模式下是否生效，不生效则评估 initialize capabilities 实验位，仍不通则降级暂缺。
- normalized_requirement: codex 的 MCP 配置必须落在 per-session CODEX_HOME 内（沿用现 per-session 目录机制），非托管行保留语义不变；翻值前置 = SPIKE-01 生效证据。
- impacts: [codex-settings.ts, codex-app-server-driver]
- evidence: codex CLI 官方 config.toml [mcp_servers.*] 机制（web 调研）；sillyhub-daemon/src/codex-settings.ts:38-56（托管段差量替换现状）；codex-app-server-driver.ts:820-829（spawn 形态）
- priority: P0
- 锚点: sillyhub-daemon/src/codex-settings.ts:38
- 模块域: sillyhub-daemon
- 故障面: config.toml 托管段序列化缺陷（数组/子表转义错）可能产出 codex 无法解析的 config.toml，导致 codex 会话启动失败——序列化必须带往返（round-trip）单测覆盖
- 退役判据: codex 官方提供 per-session MCP 配置 CLI 参数或 app-server 协议级 MCP 注入方法后，迁移至官方通道、托管段序列化器退役

## D-007@v1 frontend 零手写 UI 改动，仅生成产物同步
- type: scope
- status: accepted
- source: code
- question: frontend 侧需要哪些改动？
- answer: 零手写 UI。caps.mcp 现无任何 frontend 消费点，本次放开是能力增益不减；唯一改动 = gen-provider-caps.mjs 重跑自动更新 frontend/src/lib/provider-caps.ts + backend provider_caps.py 产物 + 守护测试。
- normalized_requirement: frontend 不新增/修改手写组件；HTML 原型跳过（零界面变化）成立。
- impacts: [gen-provider-caps.mjs 产物, test_provider_caps_alignment.py]
- evidence: 探索结论：frontend 全库 grep caps.mcp 仅命中 MCP 设置页（非按引擎门控），无消费点；frontend/src/lib/provider-caps.ts 为脚本生成产物
- priority: P2
- 锚点: sillyhub-daemon/scripts/gen-provider-caps.mjs:36
- 模块域: sillyhub-daemon, backend, frontend

## D-008@v1 rejected：方案 B 文件设置层透传（driver 层零改动）
- type: architecture
- status: rejected
- source: ai
- question: MCP 注入是否可完全走文件设置层（fileSettings writer）而 driver 层零改动？
- answer: 否决。
- normalized_requirement: N/A（rejected）
- impacts: [design §总体方案]
- evidence: sillyhub-daemon/src/interactive/session-manager/driver-factory.ts:104-176（MCP_SESSION_ID 注入/mcpRefs 过滤/内置双 server 动态组装全在 driver 选项层，文件层需重做）；cursor-driver.ts:95（cursor 无 per-session 文件层）
- priority: P1
- 否决理由: MCP_SESSION_ID env 注入、mcpRefs 白名单过滤、内置双 server 运行时组装都在 driver-factory 层现成，文件层透传要把这套逻辑重做一遍且 cursor 无 per-session 文件层，driver.ts 契约（driver.ts:300-320）预留方向本就是 driver 透传。
- 复潮条件: driver 选项管道被废弃重构，或各引擎文件层原生支持 per-session env 注入时重评。

## D-009@v1 rejected：方案 C 分引擎灰度（先 pi+codex，cursor 观望）
- type: scope
- status: rejected
- source: ai
- question: 是否分批灰度（先机制明确的 pi+codex）？
- answer: 否决。
- normalized_requirement: N/A（rejected）
- impacts: [design §非目标]
- evidence: 用户会话原话「不仅仅要支持 claude code pi 还要支持其他的一起哦」
- priority: P2
- 否决理由: 与用户「一起打通」的明确表态冲突；spike 驱动本身已提供逐引擎降级保护（D-003/D-004），无需预设灰度。
- 复潮条件: SPIKE-00/01/02 集体失败导致全引擎不可行时，按引擎逐个降级收口。

## D-010@v1 rejected：路线 B（vendor 自写桥接扩展为主路径，不升级 pi 基线）
- type: architecture
- status: rejected
- source: user
- question: pi 侧是否保持 0.81.1 基线用自写 MCP 桥接扩展？
- answer: 否决（用户明确选路线 A）。
- normalized_requirement: N/A（rejected）
- impacts: [D-005@v1 形态优先级]
- evidence: 用户会话原话「路线 A，并且不仅仅要支持 claude code pi 还要支持其他的一起哦」；providers.ts:243-245（0.81.1 时代 pi.mcp=false 如实标记）
- priority: P1
- 否决理由: pi 1.0（2026-10-01）已原生支持 MCP，上游在演进原生 MCP；保持 0.81.1 + 自写桥接偏离上游演进，桥接层长期自维护成本高。
- 复潮条件: SPIKE-00 显示 pi 1.0 rpc/extension 面大改、升级适配成本显著超过自写桥接时重评。
