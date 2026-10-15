---
author: qinyi
created_at: 2026-10-15 12:57:30
change: 2026-10-15-zcode-engine-appserver
---

# 决策记录（Decisions）

<!-- 增量落盘：每解决一个有实现影响的问题当场追加一条；幂等按 D-xxx@vN 判重 -->
<!-- 引用规范：evidence 等处的源码位置写仓根相对全路径+行号（裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦） -->

## D-001@v1: ZCode 引擎发现策略——三段式探测（env 覆盖 → PATH → Desktop 固定路径）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: ZCode 不是 PATH 上的独立 CLI（Desktop 应用内嵌引擎），daemon 如何发现与启用（用户 2026-10-15 四选一确认）
- answer: A：三段式——`SILLYHUB_ZCODE_PATH` env 覆盖 → PATH `which zcode`（官方独立 CLI 未来发布时自动命中）→ Desktop 固定安装路径回退（Windows `%LOCALAPPDATA%\Programs\ZCode\resources\glm\zcode.cjs`；macOS/Linux 按安装约定补充路径表）。spawn 形态：`node <zcode.cjs 路径> app-server`。用户自行安装 Desktop（或未来独立 CLI），平台只负责发现、版本探测与提示，不托管安装。
- normalized_requirement: agent-detector 注册新探测项（bin=zcode、envPath=SILLYHUB_ZCODE_PATH、versionPattern 匹配 `zcode version` 输出、minVersion=0.16.9），探测命中后额外解析 Desktop 内嵌路径形态（.cjs 文件而非可执行 bin，spawn 经 process.execPath）；三段全 miss 时 zcode 引擎在该 runtime 不可用，单聊入口隐藏/禁用；不新增自动安装逻辑。
- impacts: [FR-探测注册, task-agent-detector]
- evidence: sillyhub-daemon/src/agent-detector.ts:37-46（env → which → 不可用既有优先级）；sillyhub-daemon/src/agent-detector.ts:52-64（AgentProviderSpec 形状）；C:/Users/qinyi/AppData/Local/Programs/ZCode/resources/glm/zcode.cjs（实测 spawn `node zcode.cjs app-server` + `--version` 输出 0.16.9）；用户 AskUserQuestion 轮次 2026-10-15 P0-1
- 故障面: Desktop 自动更新改变内嵌引擎路径/版本（app-update.yml 在位）→ 探测缓存失效；缓解：daemon 启动重扫 + 版本门警告（D-004）+ 协议失败结构化报错兜底
- 退役判据: Z.ai 发布官方独立 CLI 进 PATH 或提供官方集成面（ACP/SDK）时重议

## D-002@v1: 会话数据隔离边界——配置面 per-session 隔离，会话库接受机器共享
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: ZCODE_DATA_BASE_DIR 实测只重定向 v2 配置面（provider_config/credentials/setting），会话数据库机器全局共享（~/.zcode/cli/db，databaseId 跨隔离运行相同实证），隔离边界怎么定（用户 2026-10-15 三选一确认）
- answer: A：接受共享——v2 配置面按平台会话隔离（ZCODE_DATA_BASE_DIR 指向 per-session 目录，LlmProvider 密钥/配置不串台、可随会话清理），会话数据库接受机器级共享（同机同用户语义，平台会话在 Desktop 会话列表可见）。不为本变更深挖会话 DB 路径覆盖。
- normalized_requirement: providers.ts 注册 perSessionDir（zcode-home/<sessionId>，内含 .zcode/v2/ 配置面），驱动 spawn 时注入 env ZCODE_DATA_BASE_DIR 指向该目录；会话库共享语义写入 design 兼容策略（平台会话标题与 Desktop 互通可见、不提供按平台会话独立清理 zcode 会话库的承诺）；配置面目录随现有 per-session 清理管线销毁。
- impacts: [FR-模型路由, FR-生命周期, task-settings, task-provider注册]
- evidence: 实测（2026-10-15）：隔离目录运行时 v2 配置/telemetry-state 落盘隔离目录、databaseId=993106b6f5… 与非隔离运行相同且隔离目录无 db 文件；dsh 先例 per-session DSH_HOME（.sillyspec/changes/2026-10-15-dsh-engine-acp/design.md:121）；用户 AskUserQuestion 轮次 2026-10-15 P0-2
- 故障面: 多 app-server 子进程并发写共享 SQLite（Desktop+CLI 本就多进程共存，WAL 模式设计内）；平台侧会话列表清理不覆盖 zcode 库（残留可见性，非功能性问题）
- 退役判据: ZCode 暴露会话 DB 路径覆盖入口时升级为全隔离

## D-003@v1: 模型路由——平台 LlmProvider 接管（per-session provider_config.json 注入）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 平台 LlmProvider（base_url/api_key/model）对 zcode 会话是否接管（用户 2026-10-15 二选一确认）
- answer: A：接管。会话绑定 LlmProvider 时向 per-session 配置面写 `provider_config.json`（ZCode 个人 Provider 体系：api.type 按 base_url 形态判 anthropic-messages / openai-chat-completions、api.baseUrl、access.type=api-key、personalModelIds/modelOrder 含所选 model），spawn 后经 state.updated 模型目录/setModel 选用；未绑定时不在配置面写 provider（回落机器默认已登录 Provider/账号）。实测：注入配置后模型轮跑在注入 Provider 上。
- normalized_requirement: 新增 zcode-settings.ts 写入器（照 codex-settings.ts 先例）生成 per-session `.zcode/v2/provider_config.json`（schemaVersion=1 + config.providerOrder/providerConfigRules 单条个人 Provider 规则）；providers.ts envInjector 不注 env（密钥落配置文件，非 env 形态——与 dsh apiKeyEnv 不同）；热切换（provider_config_changed）重写 provider_config.json + setModel；caps model_select=true/provider_switch=true。
- impacts: [FR-模型路由, task-settings, task-provider注册]
- evidence: C:/Users/qinyi/.zcode/v2/provider_config.json（本机个人 Provider 实例：api.type ∈ {anthropic-messages, openai-chat-completions} + baseUrl + access.apiKey + personalModelIds/modelOrder）；实测 2026-10-15 隔离目录注入后 state.updated 携带注入 Provider 模型目录且模型轮执行；dsh FR-05 先例（.sillyspec/changes/2026-10-15-dsh-engine-acp/requirements.md:40-41）；用户 AskUserQuestion 轮次 2026-10-15 P0-3
- 故障面: apiKey 明文落 per-session 配置文件（与 codex auth.json 同级安全姿势，目录权限随现有 per-session 管线）；ZCode provider_config schema 变更（0.16.x 演进）→ 写入器 schema 钉版本 + 冒烟校验
- 退役判据: ZCode 提供官方 env 级密钥注入面时切换

## D-004@v1: 版本门语义——最低版本门 + 警告（不硬拒）
- type: compatibility
- priority: P0
- status: accepted
- source: user
- question: ZCode 私有协议 0.16.x 快速演进且 Desktop 自动更新，版本控制语义（用户 2026-10-15 二选一确认）
- answer: A：MIN_VERSIONS 增加条目 `zcode: (0,16,9)`，低于门槛返回警告文本照常放行——与 claude(2.0.0)/codex(0.100.0)/copilot(1.0.0)/pi(0.81.0) 一致；协议破坏（信封/方法面/握手请求变更）由驱动层兜底：请求失败映射结构化 error 事件 + 会话 failed，不重试不降级。不做硬拒（Desktop 自动更新跳版本会误伤）。
- normalized_requirement: sillyhub-daemon/src/version.ts MIN_VERSIONS 含 zcode (0,16,9)；探测版本低于门槛输出与四引擎同格式警告；驱动对 create/send 失败与 runtime-preferences 应答超时（15s）映射结构化错误。
- impacts: [FR-版本门, task-version-gate]
- evidence: sillyhub-daemon/src/version.ts:44（MIN_VERSIONS 表）；sillyhub-daemon/src/version.ts:7（checkMinVersion 警告不硬拒语义）；实测 2026-10-15（requestRuntimePreferences 不应答 15s 超时报 "Client request timed out"）；用户 AskUserQuestion 轮次 2026-10-15 P0-4
- 故障面: 低版本/更新后协议不兼容 → 会话 failed 结构化报错（可接受，有兜底）
- 退役判据: 协议破坏频发时升硬拒重议

## D-005@v1: 驱动层实现方式——自研 ZCode 私有协议驱动（无备选，落选项登记）
- type: architecture
- priority: P0
- status: accepted
- source: assistant
- question: zcode 驱动层实现方式（自研私有协议驱动是唯一可行路径；ACP 与官方 SDK 均不存在，事实性落选登记）
- answer: 自研 `zcode-app-server-driver.ts`：spawn `node zcode.cjs app-server --cwd <dir>`，NDJSON 信封 `{id, method, params}` / `{id, result}` / `{id, error:{code,message,data}}`（strict 校验，多余键拒绝——实测 jsonrpc/requestId 键均被拒）；无 initialize 握手，启动门为 startup/storageState 通知（phase=ready）；服务端→客户端请求分发器必答（session/requestRuntimePreferences（create/send 各一道，15s 超时）、interaction/requestPermission（审批代答桥）、interaction/requestUserInput、interaction/requestOfficialMcpAuthHeaders）；方法面 session/create{workspace:{workspacePath,workspaceKey}} / session/send{sessionId,content} / session/stop / session/close / session/setModel / session/setThoughtLevel / session/compact；通知面 state.updated（含模型目录）/ v4/telemetry/event（stream.chunk token 级流式、tool_call、tool.lifecycle、usage.delta、turn.started/terminal）/ computer-use/operation-event（turn 边界）。
- normalized_requirement: 驱动文件实现 InteractiveDriver 契约（start/consume/interrupt 必选；compact/setThinkingLevel 可选实现——协议均有对应方法）；信封适配不直接复用 adapters/json-rpc.ts 的 `jsonrpc:"2.0"` 出站帧（sillyhub-daemon/src/adapters/json-rpc.ts:258-307 硬编码），以独立轻量 NDJSON 分帧器或信封 profile 扩展承载；不新增 npm 依赖。
- impacts: [FR-驱动, task-driver, task-events]
- evidence: 实测 2026-10-15 四轮协议探测（session/list、session/create、session/send 全链路含 token 流式与 stop/close）；引擎本体 C:/Users/qinyi/AppData/Local/Programs/ZCode/resources/glm/zcode.cjs（信封 union {id,method,params}|{method,params}|{id,result}|{id,error} strict zod、方法常量表、kind 枚举 stream.chunk/tool_call/tool.lifecycle/usage.delta/turn.terminal）；dsh D-003 先例（.sillyspec/changes/2026-10-15-dsh-engine-acp/decisions.md:39-50）
- 故障面: 私有协议无公开 spec，版本演进破坏映射 → 单测钉实测事件序列 + D-004 结构化报错兜底
- 退役判据: ZCode 官方发布 ACP profile 或集成 SDK 时重议

## D-006@v1: 落选——等待官方 ACP/SDK 支持面（事实性落选登记）
- type: architecture
- priority: P1
- status: rejected
- source: user
- question: 是否等 Z.ai 官方 ACP profile / 集成 SDK 再接（用户 2026-10-15 探测策略问题选项 C 关联）
- answer: 落选。ZCode 0.16.9 无 ACP profile（`--profile acp` 不存在、引擎包内 agentclientprotocol 零匹配），无官方集成 SDK，发布时间不可控；私有协议实测反推成本可控（自解释 zod 报错）。
- normalized_requirement: 不以等待官方支持面为前置条件
- impacts: []
- evidence: 实测 2026-10-15（`node zcode.cjs --help` 全量子命令清单无 acp；zcode.cjs grep agentclientprotocol=0）
- 否决理由: 等待时间不可控 vs 实测反推成本已验证可控
- 复潮条件: 官方 ACP/SDK 发布时按 D-005 退役判据重议

## D-007@v1: 驱动承载形态——独立驱动 + 独立轻量信封层 + 每会话一进程（方案 A）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 驱动层承载形态（用户 2026-10-15 Step4 三选一确认：A）
- answer: 方案 A：新写 `zcode-app-server-driver.ts` + 配套轻量 NDJSON 信封层（strict `{id,method,params}`/`{id,result}`/`{id,error}` 编解码 + 服务端主动请求分发器），不动 sillyhub-daemon/src/adapters/json-rpc.ts（codex 在用，零回归面）；进程模型照 codex/dsh 先例——每平台会话 spawn 一个 app-server 子进程，清理阶梯复用。
- normalized_requirement: 信封层独立文件承载（非 adapters/json-rpc.ts 扩展）；驱动实现 InteractiveDriver 契约；不新增 npm 依赖。
- impacts: [FR-驱动, task-driver]
- evidence: sillyhub-daemon/src/adapters/json-rpc.ts:258-307（jsonrpc:"2.0" 硬编码出站帧，扩展需动 codex 生产路径）；实测 2026-10-15（信封 strict 拒多余键、服务端主动请求 id 形如 "server-N" 字符串、startup storageState 就绪门 ~1.5s）；dsh D-003 同型先例
- 故障面: 信封代码与 json-rpc.ts 小幅重复（~百行，私有协议隔离收益大于复用收益）
- 退役判据: daemon 出现第 2 个 ZCode 信封同型引擎（同款 strict 无版本信封）时提炼共享

## D-008@v1: 执行期三类协议形状修正（实测驱动，task-08 冒烟抓出）
- type: consistency
- priority: P0
- status: accepted
- source: assistant
- question: e2e 冒烟与真实引擎交互暴露的协议形状偏差（执行期发现，source 为实测事实非用户选择）
- answer: 三项修正落驱动/归一化层（源代码注释均留实证锚）：①session/create 回包 sessionId 在 `result.session.sessionId` 嵌套路径（顶层无直挂——调研期探测已见该形状，驱动首版误按顶层读取，e2e 首跑即挂「session/create 未返回 sessionId」；修正为双读兼容）；②`session/event` type=`turn.failed` 归一化映射（provider 业务错误如 429 额度用尽：payload.error{type,code,message,attribution{...}} → error 事件 + turn_result(failed) 收敛——首版未映射致轮永久挂起，e2e 120s 超时实证；修正后 B 路径 6s 内结构化收敛）；③fake server 同步为真实形状（防测试与真实协议再次漂移）。
- normalized_requirement: 驱动 create 读 `sessionId ?? session.sessionId` 双路径；归一化器 turn.failed → [error(message+metadata{error_code,error_type,attribution}), turn_result{metadata.turn_status:'failed'}]；相关 fixtures 单测钉真实抓包形状。
- impacts: [FR-02, FR-04, task-03, task-04, task-08]
- evidence: .sillyspec/.runtime/logs/task08-test.log（B 路径收敛 + R-05 实测行）；sillyhub-daemon/src/interactive/zcode-app-server-driver.ts（create 双读注释）；sillyhub-daemon/src/interactive/zcode-events.ts（turn.failed 映射注释）；tests/interactive/zcode-events.test.ts（实测 fixtures）
- 故障面: provider 业务错误轮若不收敛 → 会话软锁死（AgentRun 永挂 running）；本修正闭合该类
- 退役判据: 协议演进致回包/turn.failed 形状再变时按新实测重钉
