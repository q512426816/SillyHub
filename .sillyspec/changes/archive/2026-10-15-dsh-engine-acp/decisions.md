---
author: qinyi
created_at: 2026-10-15 12:08:02
generated_by: sillyspec-fourpiece-init
change: 2026-10-15-dsh-engine-acp
---

# 决策记录（Decisions）

<!-- 增量落盘：每解决一个有实现影响的问题当场追加一条（格式见 brainstorm Step 3 模板）；幂等按 D-xxx@vN 判重 -->
<!-- 引用规范：evidence 等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工） -->

## D-001@v1: dsh 二进制发现策略——照 agent-detector 先例
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: dsh 在用户机器上如何被发现与启用（用户 2026-10-15 三选一确认）
- answer: A：在 sillyhub-daemon/src/agent-detector.ts 注册第 13 个探测项——`env 覆盖（SILLYHUB_DSH_PATH）→ PATH which → 不可用`，用户自行安装 dsh（`npm i -g @deepseek-ai/dsh` 或任意方式），平台只负责发现、`--version` 探测与提示；不做平台托管自动安装，不做仅显式配置。
- normalized_requirement: daemon 启动探测列表包含 dsh（bin=dsh，envPath=SILLYHUB_DSH_PATH，versionPattern 匹配 dsh 版本输出）；探测不到时 dsh 引擎在该 runtime 标记不可用，单聊创建入口隐藏/禁用；不新增自动安装逻辑。
- impacts: [FR-探测注册, task-agent-detector]
- evidence: sillyhub-daemon/src/agent-detector.ts:37-46（探测优先级 env → which → 不可用的既有实现）；sillyhub-daemon/src/agent-detector.ts:52-64（AgentProviderSpec 形状：bin/envPath/versionPattern/minVersion）；用户 AskUserQuestion 轮次 2026-10-15 P0-1
- 故障面: 用户机器装了 dsh 但不在 daemon 进程 PATH（如 GUI 启动继承环境不全）→ 误报不可用；缓解：SILLYHUB_DSH_PATH 显式覆盖 + 探测结果提示
- 退役判据: 平台转为托管安装引擎（如 claude SDK 依赖模式）时重议

## D-002@v1: dsh 版本门语义——最低版本门 + 警告（不硬拒）
- type: compatibility
- priority: P0
- status: accepted
- source: user
- question: dsh 处于 0.2.x alpha（官方预告破坏性变更），版本控制采用什么语义（用户 2026-10-15 三选一确认）
- answer: A：MIN_VERSIONS 增加条目 `dsh: (0,2,1)`，低于门槛返回警告文本但照常放行——与 claude(2.0.0)/codex(0.100.0)/copilot(1.0.0)/pi(0.81.0) 四引擎行为完全一致；alpha 破坏性变更风险由驱动层兜底（ACP 握手/协议失败时显式报错并终止会话，不静默错乱）。不做硬拒分支，不做精确钉死单版本。
- normalized_requirement: sillyhub-daemon/src/version.ts MIN_VERSIONS 含 dsh (0,2,1)；探测到 dsh 版本低于 0.2.1 时输出与四引擎同格式的警告；ACP 驱动对 initialize/session 揥手失败映射为结构化错误（会话 failed + 错误文案），不重试不降级。
- impacts: [FR-版本门, task-version-gate]
- evidence: sillyhub-daemon/src/version.ts:44（MIN_VERSIONS 表）；sillyhub-daemon/src/version.ts:7（checkMinVersion 低于门槛返回警告文本——非硬拒语义）；sillyhub-daemon/src/agent-detector.ts:64（minVersion 可选字段）；用户 AskUserQuestion 轮次 2026-10-15 P0-2
- 故障面: 低于门槛的 dsh 放行后遇协议破坏性变更 → 驱动握手失败显式报错（可接受，有结构化错误兜底）
- 退役判据: dsh 发布稳定版（≥1.0）或频繁出现低版本协议踩坑时升为硬拒重议

## D-003@v1: 驱动层实现方式——自研 ACP 驱动（方案 A）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: dsh 驱动层实现方式（自研 ACP 驱动 / 官方 ACP SDK 客户端 / headless 批处理，Step4 三选一）
- answer: 方案 A：新写 `sillyhub-daemon/src/interactive/dsh-acp-driver.ts`，复用 codex 同款 `adapters/json-rpc.ts` 分帧/关联基建，手写 ACP v1 方法面（initialize / session/new / session/prompt / session/cancel / session/update 通知 / session/request_permission / session/set_config_option）到 AgentEvent 的映射；对照 dsh 仓库 packages/subagent/subagent-acp 参考客户端实现。理由：ACP v1 方法面比 codex app-server 还小；与三驱动同构、注册表/caps 三端镜像/审批管线零摩擦；不给 daemon 添新依赖。
- normalized_requirement: 驱动文件实现 InteractiveDriver 契约（start/consume/interrupt 必选；compact/steering/getThinkingLevels 按需——compact 不实现、setThinkingLevel 经 set_config_option reasoning_effort 可选实现）；协议帧走 adapters/json-rpc.ts；不新增 npm 依赖。
- impacts: [FR-ACP驱动, task-driver]
- evidence: sillyhub-daemon/src/interactive/codex-app-server-driver.ts:820（JsonRpcAdapter('codex') 复用先例）；C:/Users/qinyi/IdeaProjects/deepseek-harness/packages/subagent/subagent-acp（参考客户端）；用户 AskUserQuestion 轮次 2026-10-15 Step4
- 故障面: ACP 通知语义映射手写出错（如 tool_call 生命周期错序）→ 单测钉 ACP spec 样例事件序列防偏
- 退役判据: ACP 协议大版本升级致手写映射维护成本超过 SDK 接入成本时重议

## D-004@v1: 落选——官方 @agentclientprotocol/sdk 客户端包（方案 B）
- type: architecture
- priority: P0
- status: rejected
- source: user
- question: 同 D-003 问句
- answer: 落选。核心劣势：daemon 新增 npm 依赖（供应链与版本面扩大），且 SDK client 的进程生命周期管理与平台 SessionManager 模式的适配未知、需额外调研成本；收益（协议演进保护）在已钉最低版本门 + dsh alpha 现实下敞口有限。
- normalized_requirement: 不引入 @agentclientprotocol/sdk 作为 daemon 依赖
- impacts: []
- evidence: 用户 AskUserQuestion 轮次 2026-10-15 Step4（三选一落选）
- 否决理由: 新依赖 + 未知适配成本 > 协议演进保护收益
- 复潮条件: ACP 协议演进频繁致手写映射维护成本显著上升，或官方 SDK 提供与 SessionManager 兼容的进程托管抽象

## D-005@v1: 落选——headless --json 短命进程批处理通道（方案 C）
- type: architecture
- priority: P0
- status: rejected
- source: user
- question: 同 D-003 问句
- answer: 落选。核心劣势：一次一任务、无审批代答、无 mid-turn 取消、多轮对话需手动 --session-id 续跑——不满足"平台上进行会话"的核心需求本体（仅适合批处理场景，与本次变更目标正交）。
- normalized_requirement: 不以 headless 批处理通道充当交互式会话引擎
- impacts: []
- evidence: 用户 AskUserQuestion 轮次 2026-10-15 Step4（三选一落选）
- 否决理由: 不满足会话交互核心需求
- 复潮条件: 出现批处理/CI 型 dsh 任务接入需求时，可作为独立变更另行立项（与本变更不冲突）

## D-006@v1: 执行期任务边界合并——task-03 驱动与 task-04 注册的类型依赖
- type: architecture
- priority: P1
- status: accepted
- source: code
- question: task-03 驱动单独收口时 typecheck 必挂——InteractiveProvider 联合类型由 providers.ts 的 INTERACTIVE_PROVIDERS 注册表推导（keyof typeof），'dsh' 不入注册表则 DshAcpDriver 的 provider: 'dsh' 类型不合法（TS2430/2416 实测 2026-10-15）
- answer: task-03 与 task-04 的 providers.ts 注册面合并执行（驱动 + 注册表条目同批落地后才可能 typecheck 全绿）；测试仍按各自 verify 命令分开跑，wt-commit 按 task 文件集合分开提交。非破坏性局部裁决（不推翻 D-xxx、allowed_paths 并集仅限本两任务边界）。
- normalized_requirement: sillyhub-daemon typecheck 在 task-04 注册条目落地后全绿；dsh-acp-driver.test.ts（14 用例）与 task-04 的 registry/settings 测试各自独立通过
- impacts: [task-03, task-04]
- evidence: sillyhub-daemon/src/interactive/providers.ts:772（InteractiveProvider = keyof typeof INTERACTIVE_PROVIDERS 推导）；typecheck 实测错误 TS2430/TS2416/TS2322
- 故障面: 两任务文件在中间态（驱动已写、注册未写）typecheck 红——已通过合并执行消除中间态
- 退役判据: 若未来 InteractiveProvider 改为独立字面量联合（不随注册表推导），可解除合并恢复独立收口

## D-007@v1: 执行期任务边界修正——task-07 单一源实为 runtimes.ts
- type: architecture
- priority: P1
- status: accepted
- source: code
- question: task-07 任务卡 allowed_paths 点名 session-list-panel.tsx，但 SESSION_ENGINE_OPTIONS 是导入方——真单一源是 frontend/src/lib/daemon/runtimes.ts 的 SESSION_SUPPORTED_PROVIDERS + PROVIDER_META（连带 pre-session-picker.test.tsx 的 mock PROVIDER_META）
- answer: 边界修正为 runtimes.ts（+page.test.tsx 断言 + session-list-panel.tsx 仅头注释同步）——D-006 同款执行期裁决先例，commit a8f8b228/21f94d01 留痕；评审员建议补记本条目（execute-review note 级）。
- normalized_requirement: SESSION_SUPPORTED_PROVIDERS 含 dsh 且群聊 GROUP_SUPPORTED_PROVIDERS 不含（page.test 源级钉断言双向锁定）
- impacts: [task-07]
- evidence: frontend/src/lib/daemon/runtimes.ts:175-199（定义）；frontend/src/components/sessions/session-list-panel.tsx:158（导入方）；execute-review-2026-10-15-142448 note 3
- 退役判据: 引擎选项单一源若迁址，条目随迁
