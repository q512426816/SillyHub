---
author: qinyi
created_at: 2026-09-10 11:38:02
---

# 决策记录（Decisions）— zcode 会话读取恒走本地 SQLite

## D-001@v1: 恒读 SQLite，文件仅作失败兜底
- 模块域: sillyhub-daemon, backend
- type: architecture
- priority: P0
- status: accepted
- source: user（三轮确认 + 方案选择）
- question: 数据源是"文件优先库兜底"还是"恒库文件兜底"？
- answer: 恒读 SQLite（文件存在也不读文件）；库读失败（schema 漂移/库损坏/会话不在库/node:sqlite 不可用）才回落文件路径。
- normalized_requirement: format=zcode-model-io-jsonl 的 messages/content 读取主路径恒为 SQLite 查询；文件路径仅为灾备。
- impacts: [FR-01, FR-03, Phase 1/2/3]

## D-002@v1: DB 路径不截断，仅文件回落路径保留 256KB
- 模块域: backend
- type: definition
- priority: P1
- status: accepted
- source: user（设计展示中途修正）
- question: raw 合成文本要不要沿用 256KB 尾部截断？
- answer: 不截断——按会话查询天然有界，对话窗口即上界；仅 read_file 回落路径保留原 256KB 截断语义。
- impacts: [FR-02, Phase 3]

## D-003@v1: 隐藏/系统注入消息过滤判据
- 模块域: sillyhub-daemon
- type: consistency
- priority: P1
- status: accepted
- source: design-grill（X13，独立审查实证）
- question: DB user 消息中约 77%（9,124/11,785）为系统注入（synthetic/hidden），不过滤会产生假用户气泡且不触发回落，怎么滤？
- answer: message.data.semantics.uiVisibility=='hidden' || transcriptVisibility=='hidden' || visibility=='model-only' 任一命中即整条跳过；对齐文件 parser 剥 `<system-reminder>` 的既有语义。
- impacts: [Phase 1 映射表, fixture 用例]

## D-004@v1: tool part 单条产 tool_use + tool_result 两段
- 模块域: sillyhub-daemon
- type: feasibility
- priority: P1
- status: accepted
- source: design-grill（X12，实证 5000 抽样 keyset）
- question: 设计初版假设 tool part 有 use/result 两形态（留待 execute 实证），实证不存在两形态，怎么映射？
- answer: 单条 part（data={tool, callID, state:{status, input, output|error, …}}）产两段：tool_use（input 2KB 摘要）+ tool_result（output 4KB 摘要，is_error=status=='error'）；status ∈ running/pending（无 output）只产 tool_use。
- impacts: [Phase 1 映射表, fixture 用例]

## D-005@v1: 分派插入点在 allowed_roots 守卫之后、registry 之前
- 模块域: sillyhub-daemon
- type: boundary
- priority: P1
- status: accepted
- source: design-grill（X3/DI-01）
- question: SQLite 分派插在 readAgentLogMessages 现流程哪一步？
- answer: assertWithinAllowedRoots(path) 守卫先行（安全铁律，分派不得绕过越界检查），守卫通过且 format=zcode 时先走读取器，失败落回 registry→lstat→文件解析现流程。
- impacts: [Phase 2]

## D-006@v1: node:sqlite 生效版本带与类型声明
- 模块域: sillyhub-daemon
- type: compatibility
- priority: P2
- status: accepted
- source: design-grill（X8/X9/TS-01）
- question: engines >=20 下 node:sqlite 可用性与 TS 编译怎么处理？
- answer: 运行时生效版本 ≥22.13.0 / ≥23.4.0（22.5–22.12、23.0–23.3 带 flag 导入即抛错 → 自动文件回落），engines 不 bump；devDep @types/node bump 至 22.13+ 或本地 .d.ts。
- impacts: [Phase 1, 文件变更清单]

## D-007@v1: 伪 jsonl 固定九字段封闭序列化
- 模块域: backend
- type: definition
- priority: P2
- status: accepted
- source: design-grill（X2/PS-01）
- question: raw 合成的行结构？
- answer: NormalizedLogMessage 九字段（seq/kind/text/tool_name/tool_use_id/tool_input/tool_result/is_error/ts）逐行全量 JSON，封闭列举；content 回落捕获范围含 not_found/method_not_found（老 daemon）/离线/超时。
- impacts: [Phase 3]
