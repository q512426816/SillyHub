# 决策知识 — daemon

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-002@v1
状态：implemented
变更：2026-08-25-session-spec-binding
锚点：backend/migrations/versions/20260825223000_add_quicklog_session_links.py（播种）
最近确认：a9b06c98
理由：links 为唯一关联真相：读侧全部改走 links；alembic 一次性把存量 change_id 播种成 link 行（ON CONFLICT DO NOTHING）；change_id 列保留并继续写入（创建时锚定主变更的冗余提示，双写），后续变更再评估删列。

## D-003@v1 : 平台共享智能体绑定的守护进程取管理员自己名下
状态：implemented
锚点：未记录
最近确认：3b2df3ff
理由：仅平台管理员自己名下的在线 daemon runtime。依据：避免引入「管理员

## D-002@v2 : 平台共享智能体会话——源码只读 + 指定目录可写
状态：implemented
锚点：未记录
最近确认：3b2df3ff
理由：用户实答（重问轮）：「允许某个目录下写操作，可以生成点文档原型图
supersedes：D-002@v1

## D-004@v2 : 共享机器/智能体由用户在会话中显式选择
状态：implemented
锚点：未记录
最近确认：3b2df3ff
理由：用户实答（重问轮）：「会话选择共享的机器和智能体呀，用户自己选」
supersedes：D-004@v1

## D-006@v1 : 实现方案选 B——统一授权表 daemon_runtime_grants
状态：implemented
锚点：未记录
最近确认：3b2df3ff
理由：用户选定方案 B：新建 daemon_runtime_grants 统一授权表，工作区共享与

## D-011@v1 : 打破 daemon 零改动 Non-Goal——session 级 overlay roots 写守卫增量（spike-02 B 裁决）
状态：implemented
锚点：未记录
最近确认：3b2df3ff
理由：选项 II（最小 daemon 增量）：_judgeWriteViaPolicyEngine 增加 per-session

## D-012@v1 : platform grant 的 pinned runtime 不经共享档案直接钉定 → 404
状态：implemented
锚点：未记录
最近确认：3b2df3ff
理由：否——共享的是智能体而非裸 runtime：authorize_pinned_runtime 的

## D-unmapped-026@v1 dsh 二进制发现策略——照 agent-detector 先例
状态：implemented
变更：2026-10-15-dsh-engine-acp
原编号：D-001@v1
锚点：sillyhub-daemon/src/agent-detector.ts
最近确认：775d86011
理由：A：在 sillyhub-daemon/src/agent-detector.ts 注册第 13 个探测项——`env 覆盖（SILLYHUB_DSH_PATH）→ PATH which → 不可用`，用户自行安装 dsh（`npm i -g @deepseek-ai/dsh` 或任意方式），平台只负责发现、`--version` 探测与提示；不做平台托管自动安装，不做仅显式配置。
故障面：用户机器装了 dsh 但不在 daemon 进程 PATH（如 GUI 启动继承环境不全）→ 误报不可用；缓解：SILLYHUB_DSH_PATH 显式覆盖 + 探测结果提示
退役判据：平台转为托管安装引擎（如 claude SDK 依赖模式）时重议

## D-unmapped-027@v1 dsh 版本门语义——最低版本门 + 警告（不硬拒）
状态：implemented
变更：2026-10-15-dsh-engine-acp
原编号：D-002@v1
锚点：未记录
最近确认：775d86011
理由：A：MIN_VERSIONS 增加条目 `dsh: (0,2,1)`，低于门槛返回警告文本但照常放行——与 claude(2.0.0)/codex(0.100.0)/copilot(1.0.0)/pi(0.81.0) 四引擎行为完全一致；alpha 破坏性变更风险由驱动层兜底（ACP 握手/协议失败时显式报错并终止会话，不静默错乱）。不做硬拒分支，不做精确钉死单版本。
故障面：低于门槛的 dsh 放行后遇协议破坏性变更 → 驱动握手失败显式报错（可接受，有结构化错误兜底）
退役判据：dsh 发布稳定版（≥1.0）或频繁出现低版本协议踩坑时升为硬拒重议

## D-unmapped-028@v1 驱动层实现方式——自研 ACP 驱动（方案 A）
状态：implemented
变更：2026-10-15-dsh-engine-acp
原编号：D-003@v1
锚点：未记录
文件：sillyhub-daemon/src/interactive/dsh-acp-driver.ts
最近确认：775d86011
理由：方案 A：新写 `sillyhub-daemon/src/interactive/dsh-acp-driver.ts`，复用 codex 同款 `adapters/json-rpc.ts` 分帧/关联基建，手写 ACP v1 方法面（initialize / session/new / session/prompt / session/cancel / session/update 通知 / session/request_permission / session/set_config_option）到 AgentEvent 的映射；对照 dsh 仓库 packages/subagent/subagent-acp 参考客户端实现。理由：ACP v1 方法面比 codex app-server 还小；与三驱动同构、注册表/caps 三端镜像/审批管线零摩擦；不给 daemon 添新依赖。
故障面：ACP 通知语义映射手写出错（如 tool_call 生命周期错序）→ 单测钉 ACP spec 样例事件序列防偏
退役判据：ACP 协议大版本升级致手写映射维护成本超过 SDK 接入成本时重议

## D-unmapped-029@v1 落选——官方 @agentclientprotocol/sdk 客户端包（方案 B）
状态：rejected
变更：2026-10-15-dsh-engine-acp
原编号：D-004@v1
锚点：未记录
最近确认：775d86011
理由：落选。核心劣势：daemon 新增 npm 依赖（供应链与版本面扩大），且 SDK client 的进程生命周期管理与平台 SessionManager 模式的适配未知、需额外调研成本；收益（协议演进保护）在已钉最低版本门 + dsh alpha 现实下敞口有限。
否决理由：新依赖 + 未知适配成本 > 协议演进保护收益
复潮条件：ACP 协议演进频繁致手写映射维护成本显著上升，或官方 SDK 提供与 SessionManager 兼容的进程托管抽象

## D-unmapped-030@v1 落选——headless --json 短命进程批处理通道（方案 C）
状态：rejected
变更：2026-10-15-dsh-engine-acp
原编号：D-005@v1
锚点：未记录
最近确认：775d86011
理由：落选。核心劣势：一次一任务、无审批代答、无 mid-turn 取消、多轮对话需手动 --session-id 续跑——不满足"平台上进行会话"的核心需求本体（仅适合批处理场景，与本次变更目标正交）。
否决理由：不满足会话交互核心需求
复潮条件：出现批处理/CI 型 dsh 任务接入需求时，可作为独立变更另行立项（与本变更不冲突）

## D-unmapped-031@v1 执行期任务边界合并——task-03 驱动与 task-04 注册的类型依赖
状态：implemented
变更：2026-10-15-dsh-engine-acp
原编号：D-006@v1
锚点：未记录
最近确认：775d86011
理由：task-03 与 task-04 的 providers.ts 注册面合并执行（驱动 + 注册表条目同批落地后才可能 typecheck 全绿）；测试仍按各自 verify 命令分开跑，wt-commit 按 task 文件集合分开提交。非破坏性局部裁决（不推翻 D-xxx、allowed_paths 并集仅限本两任务边界）。
故障面：两任务文件在中间态（驱动已写、注册未写）typecheck 红——已通过合并执行消除中间态
退役判据：若未来 InteractiveProvider 改为独立字面量联合（不随注册表推导），可解除合并恢复独立收口

## D-unmapped-032@v1 执行期任务边界修正——task-07 单一源实为 runtimes.ts
状态：implemented
变更：2026-10-15-dsh-engine-acp
原编号：D-007@v1
锚点：未记录
最近确认：775d86011
理由：边界修正为 runtimes.ts（+page.test.tsx 断言 + session-list-panel.tsx 仅头注释同步）——D-006 同款执行期裁决先例，commit a8f8b228/21f94d01 留痕；评审员建议补记本条目（execute-review note 级）。
退役判据：引擎选项单一源若迁址，条目随迁

## D-unmapped-043@v1 ZCode 引擎发现策略——三段式探测（env 覆盖 → PATH → Desktop 固定路径）
状态：implemented
变更：2026-10-15-zcode-engine-appserver
原编号：D-001@v1
锚点：未记录
最近确认：9e8ba08fe
理由：A：三段式——`SILLYHUB_ZCODE_PATH` env 覆盖 → PATH `which zcode`（官方独立 CLI 未来发布时自动命中）→ Desktop 固定安装路径回退（Windows `%LOCALAPPDATA%\Programs\ZCode\resources\glm\zcode.cjs`；macOS/Linux 按安装约定补充路径表）。spawn 形态：`node <zcode.cjs 路径> app-server`。用户自行安装 Desktop（或未来独立 CLI），平台只负责发现、版本探测与提示，不托管安装。
故障面：Desktop 自动更新改变内嵌引擎路径/版本（app-update.yml 在位）→ 探测缓存失效；缓解：daemon 启动重扫 + 版本门警告（D-004）+ 协议失败结构化报错兜底
退役判据：Z.ai 发布官方独立 CLI 进 PATH 或提供官方集成面（ACP/SDK）时重议

## D-unmapped-044@v1 会话数据隔离边界——配置面 per-session 隔离，会话库接受机器共享
状态：implemented
变更：2026-10-15-zcode-engine-appserver
原编号：D-002@v1
锚点：未记录
最近确认：9e8ba08fe
理由：A：接受共享——v2 配置面按平台会话隔离（ZCODE_DATA_BASE_DIR 指向 per-session 目录，LlmProvider 密钥/配置不串台、可随会话清理），会话数据库接受机器级共享（同机同用户语义，平台会话在 Desktop 会话列表可见）。不为本变更深挖会话 DB 路径覆盖。
故障面：多 app-server 子进程并发写共享 SQLite（Desktop+CLI 本就多进程共存，WAL 模式设计内）；平台侧会话列表清理不覆盖 zcode 库（残留可见性，非功能性问题）
退役判据：ZCode 暴露会话 DB 路径覆盖入口时升级为全隔离

## D-unmapped-045@v1 模型路由——平台 LlmProvider 接管（per-session provider_config.json 注入）
状态：implemented
变更：2026-10-15-zcode-engine-appserver
原编号：D-003@v1
锚点：未记录
最近确认：9e8ba08fe
理由：A：接管。会话绑定 LlmProvider 时向 per-session 配置面写 `provider_config.json`（ZCode 个人 Provider 体系：api.type 按 base_url 形态判 anthropic-messages / openai-chat-completions、api.baseUrl、access.type=api-key、personalModelIds/modelOrder 含所选 model），spawn 后经 state.updated 模型目录/setModel 选用；未绑定时不在配置面写 provider（回落机器默认已登录 Provider/账号）。实测：注入配置后模型轮跑在注入 Provider 上。
故障面：apiKey 明文落 per-session 配置文件（与 codex auth.json 同级安全姿势，目录权限随现有 per-session 管线）；ZCode provider_config schema 变更（0.16.x 演进）→ 写入器 schema 钉版本 + 冒烟校验
退役判据：ZCode 提供官方 env 级密钥注入面时切换

## D-unmapped-046@v1 版本门语义——最低版本门 + 警告（不硬拒）
状态：implemented
变更：2026-10-15-zcode-engine-appserver
原编号：D-004@v1
锚点：未记录
最近确认：9e8ba08fe
理由：A：MIN_VERSIONS 增加条目 `zcode: (0,16,9)`，低于门槛返回警告文本照常放行——与 claude(2.0.0)/codex(0.100.0)/copilot(1.0.0)/pi(0.81.0) 一致；协议破坏（信封/方法面/握手请求变更）由驱动层兜底：请求失败映射结构化 error 事件 + 会话 failed，不重试不降级。不做硬拒（Desktop 自动更新跳版本会误伤）。
故障面：低版本/更新后协议不兼容 → 会话 failed 结构化报错（可接受，有兜底）
退役判据：协议破坏频发时升硬拒重议

## D-unmapped-047@v1 驱动层实现方式——自研 ZCode 私有协议驱动（无备选，落选项登记）
状态：implemented
变更：2026-10-15-zcode-engine-appserver
原编号：D-005@v1
锚点：未记录
最近确认：9e8ba08fe
理由：自研 `zcode-app-server-driver.ts`：spawn `node zcode.cjs app-server --cwd <dir>`，NDJSON 信封 `{id, method, params}` / `{id, result}` / `{id, error:{code,message,data}}`（strict 校验，多余键拒绝——实测 jsonrpc/requestId 键均被拒）；无 initialize 握手，启动门为 startup/storageState 通知（phase=ready）；服务端→客户端请求分发器必答（session/requestRuntimePreferences（create/send 各一道，15s 超时）、interaction/requestPermission（审批代答桥）、interaction/requestUserInput、interaction/requestOfficialMcpAuthHeaders）；方法面 session/create{workspace:{workspacePath,workspaceKey}} / session/send{sessionId,content} / session/stop / session/close / session/setModel / session/setThoughtLevel / session/compact；通知面 state.updated（含模型目录）/ v4/telemetry/event（stream.chunk token 级流式、tool_call、tool.lifecycle、usage.delta、turn.started/terminal）/ computer-use/operation-event（turn 边界）。
故障面：私有协议无公开 spec，版本演进破坏映射 → 单测钉实测事件序列 + D-004 结构化报错兜底
退役判据：ZCode 官方发布 ACP profile 或集成 SDK 时重议

## D-unmapped-048@v1 落选——等待官方 ACP/SDK 支持面（事实性落选登记）
状态：rejected
变更：2026-10-15-zcode-engine-appserver
原编号：D-006@v1
锚点：未记录
最近确认：9e8ba08fe
理由：落选。ZCode 0.16.9 无 ACP profile（`--profile acp` 不存在、引擎包内 agentclientprotocol 零匹配），无官方集成 SDK，发布时间不可控；私有协议实测反推成本可控（自解释 zod 报错）。
否决理由：等待时间不可控 vs 实测反推成本已验证可控
复潮条件：官方 ACP/SDK 发布时按 D-005 退役判据重议

## D-unmapped-049@v1 驱动承载形态——独立驱动 + 独立轻量信封层 + 每会话一进程（方案 A）
状态：implemented
变更：2026-10-15-zcode-engine-appserver
原编号：D-007@v1
锚点：sillyhub-daemon/src/adapters/json-rpc.ts
最近确认：9e8ba08fe
理由：方案 A：新写 `zcode-app-server-driver.ts` + 配套轻量 NDJSON 信封层（strict `{id,method,params}`/`{id,result}`/`{id,error}` 编解码 + 服务端主动请求分发器），不动 sillyhub-daemon/src/adapters/json-rpc.ts（codex 在用，零回归面）；进程模型照 codex/dsh 先例——每平台会话 spawn 一个 app-server 子进程，清理阶梯复用。
故障面：信封代码与 json-rpc.ts 小幅重复（~百行，私有协议隔离收益大于复用收益）
退役判据：daemon 出现第 2 个 ZCode 信封同型引擎（同款 strict 无版本信封）时提炼共享

## D-unmapped-050@v1 执行期三类协议形状修正（实测驱动，task-08 冒烟抓出）
状态：implemented
变更：2026-10-15-zcode-engine-appserver
原编号：D-008@v1
锚点：未记录
最近确认：9e8ba08fe
理由：三项修正落驱动/归一化层（源代码注释均留实证锚）：①session/create 回包 sessionId 在 `result.session.sessionId` 嵌套路径（顶层无直挂——调研期探测已见该形状，驱动首版误按顶层读取，e2e 首跑即挂「session/create 未返回 sessionId」；修正为双读兼容）；②`session/event` type=`turn.failed` 归一化映射（provider 业务错误如 429 额度用尽：payload.error{type,code,message,attribution{...}} → error 事件 + turn_result(failed) 收敛——首版未映射致轮永久挂起，e2e 120s 超时实证；修正后 B 路径 6s 内结构化收敛）；③fake server 同步为真实形状（防测试与真实协议再次漂移）。
故障面：provider 业务错误轮若不收敛 → 会话软锁死（AgentRun 永挂 running）；本修正闭合该类
退役判据：协议演进致回包/turn.failed 形状再变时按新实测重钉

## D-unmapped-257@v1 否决方案 B——后端推断式（零 daemon 改动）
状态：rejected
变更：2026-10-26-session-stage-progress
原编号：D-005@v1
锚点：未记录
最近确认：cf17c6a9f
理由：（落选）方案 B——backend 仅用已有信号（控制指令状态机、run.status 翻转、首条 log 事件）+ 前端计时推断阶段文案。
否决理由：daemon 内部三段同步（技能/规范/工具配置）对外不可见，推断式区分不了「启动 agent」与「同步文件中」，只能笼统显示「准备中」——用户核心诉求「展示是在启动 agent 还是同步文件中」直接落空；且阶段切换时刻靠启发式计时猜测，语义不精确。
复潮条件：若 daemon 侧始终无法改造（如版本冻结），且用户接受粗粒度「准备中」文案时，可重议。

## D-unmapped-258@v1 否决方案 C——心跳快照轮询
状态：rejected
变更：2026-10-26-session-stage-progress
原编号：D-006@v1
锚点：未记录
最近确认：cf17c6a9f
理由：（落选）方案 C——daemon 把当前阶段写入既有心跳结构化字段（sillyspec_status 先例），backend 落库，前端每 2-3s 轮询显示。
否决理由：心跳间隔+轮询间隔叠加导致阶段切换显示延迟数十秒，与「实时进度」诉求相悖；阶段是瞬时态，轮询会跳过短暂阶段；轮内秒级变化（工具运行/等待模型响应）轮询机制表达不了，仍需事件流兜底=两套机制并存；新增查询端点+轮询逻辑后改动并不比 A 少。
复潮条件：若后续需要「断线/刷新后仍可查当前阶段」的持久化快照能力（作为方案 A 的增量补充而非替代），可复用心跳通道先例重议。

## D-unmapped-259@v1 超时阈值=前端常量 30s（非用户/服务端配置）
状态：implemented
变更：2026-10-26-session-stage-progress
原编号：D-007@v1
锚点：未记录
最近确认：cf17c6a9f
理由：我的判断：前端常量 30 秒（对照生产 TURN_STATUS_ELAPSED_MIN_MS=15s 先例，状态条已有前端常量门槛惯例）；不做服务端下发配置，首版不暴露设置项。

## D-unmapped-260@v1 轮内阶段由客户端从已有事件映射，不发新事件
状态：implemented
变更：2026-10-26-session-stage-progress
原编号：D-008@v1
锚点：未记录
最近确认：cf17c6a9f
理由：我的判断：纯客户端映射——thinking partial→「正在思考」、running 工具段→工具摘要、无事件间隙→「等待模型响应」，全部复用 deriveTurnActivity 既有派生链；不新增轮内 turn_phase 事件（信号源重复且带宽浪费）。

## D-unmapped-261@v1 阶段上报失败静默降级，不阻塞会话主流程
状态：implemented
变更：2026-10-26-session-stage-progress
原编号：D-009@v1
锚点：未记录
最近确认：cf17c6a9f
理由：我的判断：静默降级——上报失败仅记 daemon 日志，不重试队列、不失败会话；阶段展示是纯增强，任何失败都不得影响会话创建/消息注入主流程。与 publish_session_event「异常吞噬+warning」同语义。

## D-unmapped-262@v1 断线/刷新后阶段未知→回退现有兜底文案，不做持久化
状态：implemented
变更：2026-10-26-session-stage-progress
原编号：D-010@v1
锚点：未记录
最近确认：cf17c6a9f
理由：我的判断：回退现有兜底文案（「执行中」+活动摘要派生），不做阶段状态持久化/快照查询——SSE 无历史是通道既有属性（D-004 故障面已登记），轻量形态（D-001）下可接受。

## D-unmapped-269@v1 轻量变更耗时口径=总时长
状态：implemented
变更：2026-10-26-session-change-progress-hover
原编号：D-001@v1
锚点：未记录
最近确认：33f4154a3
理由：显示总时长（创建 → 最后活跃），本次不做相位级耗时。

## D-unmapped-270@v1 全量异常态=异色圈+状态字
状态：implemented
变更：2026-10-26-session-change-progress-hover
原编号：D-002@v1
锚点：未记录
最近确认：33f4154a3
理由：异常态圈变警示色 + 小字状态标注（如「等输入」「修订中 r2」「已失效」「阻断」「失败」），已完成占比退居其次。

## D-unmapped-271@v1 进度展示位置=下拉项内嵌+入口旁单个总进度圈
状态：implemented
变更：2026-10-26-session-change-progress-hover
原编号：D-003@v1
锚点：未记录
最近确认：33f4154a3
理由：下拉列表每项内嵌进度行（全量 5 圈横排/轻量 ①②③ 相位行）+ 悬浮框「变更」按钮旁仅露**单个总进度圈**——只展示最新进行中（updated_at 最新非归档）的一个变更；全量与轻量统一为总进度圈口径（全量=总步骤完成占比，轻量=按相位/任务归一的总完成度）。
故障面：入口圈依赖 active 列表排序，列表查询失败时圈不渲染（降级现状计数徽标，无遮蔽性故障）
退役判据：用户反馈入口圈信息冗余（与计数徽标重复）时可移除，下拉项内嵌进度行不受影响

## D-unmapped-272@v1 数据链路=方案A后端投影扩展
状态：implemented
变更：2026-10-26-session-change-progress-hover
原编号：D-004@v1
锚点：未记录
最近确认：33f4154a3
理由：方案 A：全量细度在 backend enrich_summaries 从 latest_progress 提取（每阶段步骤分组+耗时）；轻量由 daemon 补采集 flow status --json 经 heartbeat 上行后投影进 ChangeSummary；前端单点消费现有 15s 轮询。
故障面：latest_progress 畸形/缺字段时投影 fail-open（R-01），新增失败模式仅为「进度字段空导致前端降级」，不触及既有列表渲染路径
退役判据：若后续平台改为事件驱动进度（SSE/WebSocket 推送），本投影提取器可整体下线，DTO 字段保持 optional 兼容

## D-unmapped-273@v1 execute 阶段圈口径=Task 表 n/m
状态：implemented
变更：2026-10-26-session-change-progress-hover
原编号：D-005@v1
锚点：未记录
最近确认：33f4154a3
理由：execute 圈按 Task 表聚合 done/total 展示「n/m 任务」，不用 Wave 步骤数。

## D-unmapped-274@v1 brainstorm→thin 分流态归轻量渲染
状态：implemented
变更：2026-10-26-session-change-progress-hover
原编号：D-006@v1
锚点：未记录
最近确认：33f4154a3
理由：归轻量渲染（①②③ 相位行）+ 小字「自头脑风暴转入」标注；不走全量 5 圈。

## D-unmapped-275@v1 升厚变更切换全量渲染+标注
状态：implemented
变更：2026-10-26-session-change-progress-hover
原编号：D-007@v1
锚点：未记录
最近确认：33f4154a3
理由：显示「已升厚→走全量」标注并切换为全量 5 阶段圈渲染。

## D-unmapped-276@v2 轻量数据通道=daemon heartbeat 载荷扩展+条目 workspace 维度+backend 全新逐变更写入路径
状态：implemented
变更：2026-10-26-session-change-progress-hover
原编号：D-008@v2
锚点：未记录
最近确认：33f4154a3
理由：①载荷条目加 workspace_id 键（sillyspec_status 是 daemon 实例级全局键、多工作区 status_map 级化，无 workspace 维度无法定位）；②backend 新增逐变更写入路径（既有语义是整包快照直写 daemon_instances，不逐条改 changes 表）：行锁事务 SELECT FOR UPDATE→merge stages["thin_flow"]→UPDATE；③reparse 重建 stages 丢键由下跳 heartbeat 自愈。
supersedes：D-008@v1
故障面：行锁事务防 read-modify-write 竞态；自愈窗口 ≤1 心跳周期内 thin_flow 显示为 None（前端降级现状）；新增失败模式无遮蔽性故障
退役判据：同 D-008@v1（CLI 六表并入协议后整链可移除）

## D-unmapped-277@v1 入口圈选取=前端显式 updated_at 重排
状态：implemented
变更：2026-10-26-session-change-progress-hover
原编号：D-013@v1
锚点：未记录
最近确认：33f4154a3
理由：不可用——前端显式按 updated_at 取 max 重排选取，禁用列表序直接取首。

## D-unmapped-278@v1 heartbeat thin_flow 写入不刷 changes.updated_at
状态：implemented
变更：2026-10-26-session-change-progress-hover
原编号：D-014@v1
锚点：未记录
最近确认：33f4154a3
理由：写 stages["thin_flow"] 不刷 changes.updated_at——updated_at 语义保持"最后变更元数据变更"。

## D-unmapped-279@v1 已归档项不渲染进度行
状态：implemented
变更：2026-10-26-session-change-progress-hover
原编号：D-009@v1
锚点：未记录
最近确认：33f4154a3
理由：不渲染——终态无信息量，保持现状名称+时间。

## D-unmapped-280@v1 落选方案B（前端按需拉详情）
状态：rejected
变更：2026-10-26-session-change-progress-hover
原编号：D-010@v1
锚点：未记录
最近确认：33f4154a3
理由：否决。
否决理由：下拉 N 个变更项=N+1 请求，15s 轮询下放大；悬浮框紧凑场景逐项延迟可见；数据口径散在两端。
复潮条件：变更列表项数百级、ChangeSummary 载荷成为瓶颈时重新评估。

## D-unmapped-281@v1 落选方案C（daemon SSE 实时推）
状态：rejected
变更：2026-10-26-session-change-progress-hover
原编号：D-011@v1
锚点：未记录
最近确认：33f4154a3
理由：否决。
否决理由：会话 SSE 是会话域事件流，混入变更进度域语义膨胀；daemon 离线时前端无数据；15s 轮询对进度展示足够。
复潮条件：用户对进度实时性提出秒级要求且接受通道语义扩展时重议。

## D-unmapped-006@v1 : 打破 daemon 零改动 Non-Goal——session 级 overlay roots 写守卫增量（spike-02 B 裁决）
状态：implemented
原编号：D-011@v1
锚点：未记录
最近确认：3b2df3ff
理由：选项 II（最小 daemon 增量）：_judgeWriteViaPolicyEngine 增加 per-session

## D-unmapped-007@v1 : platform grant 的 pinned runtime 不经共享档案直接钉定 → 404
状态：implemented
原编号：D-012@v1
锚点：未记录
最近确认：3b2df3ff
理由：否——共享的是智能体而非裸 runtime：authorize_pinned_runtime 的

## D-daemon-001@v1 2026-09-27-daemon-queue-stop-gaps——两处独立小修，均落在 sillyhub-daemon/src/daemon.ts：①`_runSillySpecCommand` 的升级等待 `while (i
状态：implemented
变更：2026-09-27-daemon-queue-stop-gaps
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-09-27-daemon-queue-stop-gaps/design.md
文件：sillyhub-daemon/src/daemon.ts, sillyhub-daemon/tests/daemon-hits-periodic-lifecycle.test.ts, sillyhub-daemon/tests/sillyspec-platform-command.test.ts
最近确认：未记录
理由：两处独立小修，均落在 sillyhub-daemon/src/daemon.ts：①`_runSillySpecCommand` 的升级等待 `while (isUpgradeInFlight())` 轮询加总预算常量 `SILLYSPEC_COMMAND_UPGRADE_WAIT_MAX_MS = 300_000`（5 分钟）——超预算后当前命令经 `executor.recordCommandResult` 记 failed 结果槽（错误文案含「请待升级完成后重试」），随后 return 放行链尾，队列后续命令各带独立预算继续；等待段整体移入 try，超时/同步异常统一走既有 catch/finally（`_nudgeHeartbeatAfterCommandResult` 两路径共用）。②`_stopInternal` 在兄弟定时器清理段补 `this._hitsPeriodic?.stop()` 并置空。选此方案而非「排除 deferred 态出等待」：deferred 可在任意时刻翻 running（复查定时器触发即起 npm），排除等待会在 npm 半安装窗口并发 spawn CLI——违背原变更的安全动机；有界超时是唯一既保安全又保活性的形态。预算取 5 分钟依据：running 态升级链正常量级为 npm 树杀上限 120s + 前后探测，5 分钟覆盖且远超前端 150s 回显窗，再长即病态滞留，显式 failed 优于静默无限等待。

## D-daemon-002@v1 2026-10-04-handoff-doc-kind-contract——改 `backend/app/modules/daemon/session/service/takeover.py` 的 `build_handoff_prom
状态：implemented
变更：2026-10-04-handoff-doc-kind-contract
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-04-handoff-doc-kind-contract/design.md
文件：backend/app/modules/daemon/session/service/takeover.py, backend/app/modules/daemon/tests/test_takeover_handoff.py
最近确认：未记录
理由：改 `backend/app/modules/daemon/session/service/takeover.py` 的 `build_handoff_prompt`（纯函数）：按消息契约（`platform_sync/schema.py:513` 钉死的 kind 五值 `user_input/reply/thinking/tool_use/tool_result`）重组装分支——此前判 `kind=="user"/"assistant"` 是死分支（契约里不存在这两值，真实日志只余 tool_name 进「最近操作」，对话与文件节全空，用户实测 200 条消息只看到 8 个工具名）；`tool_input` 按契约的 JSON 字符串摘要解析（新增 `_collect_tool_files`：json.loads，2KB 截断坏 JSON 用 regex 兜底取首个 path 类键，dict 形态保留兼容）；`_build_handoff_first_prompt` 的 cwd 与 tier3 同口径回退所选 entry 的 `agent_cwd`（会话行 cwd 建桶不写恒空，「工作目录」不再恒 unknown）。选契约对齐而非改 daemon 侧发新 kind：契约本身是对的（前端 /agent-logs/{id}/messages 消费同一份五值），错的是 handoff 组装端自造了一套词表。

## D-daemon-003@v1 2026-10-08-ci-sweep-2——2026-10-08 新提交上三线 CI 共 8 用例失败，逐一核对生产意图后确认全部为测试侧未跟上近期有意生产变更（生产代码零行改动）：①frontend g
状态：implemented
变更：2026-10-08-ci-sweep-2
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-08-ci-sweep-2/design.md
文件：backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py, frontend/src/components/git-log/__tests__/git-log-page.test.tsx, sillyhub-daemon/tests/integration/selfupdate-scenarios.test.ts, sillyhub-daemon/tests/provider-adapter-registry.test.ts, sillyhub-daemon/tests/sillyspec-platform-command.test.ts
最近确认：未记录
理由：2026-10-08 新提交上三线 CI 共 8 用例失败，逐一核对生产意图后确认全部为测试侧未跟上近期有意生产变更（生产代码零行改动）：①frontend git-log-page.test 钉 TABS=15，e8da254ce 知识图谱变更插入第 16 个页签（其自身 workspace-tabs.test 已更新，此数量钉漏跟）——改 16 并同步用例名/头注释；②backend test_cleanup_stale_runs_error_code 钉旧 error_detail 文案，9f1f974c4/89a7e9a42 宽限窗变更经评审 P3 有意改文案（reason 兼顾复扫场景、finished_by=stale_run_cleanup，生产注释明载）——期望改新文案并注释溯源；③daemon 心跳平铺形态 d6fabf408 加 machine-id 尾参后 10→11，daemon-heartbeat-pending/sillyspec 两文件已同步改 11，sillyspec-platform-command 6 处与 selfupdate-scenarios 2 处漏跟——补改并带同款尾参注释；④daemon provider-adapter-registry 对账正则锚单数 agent_kind 冒号形态，2026-10-06-provider-multi-agent-kind 把字段改复数 agent_kinds list Literal 致解析失配（防哑绿抛「锚点漂移」）——正则随形态更新，注释锚同步。修测试而非回退生产：四处生产变更均有变更档案与评审留痕，属规则 9 允许的测试过时情形。

## D-daemon-004@v1 2026-10-08-gov-action-stderr-noise——知识信号卡「一键修复路径」的完成提示被 Node SQLite ExperimentalWarning 淹没：daemon `KnowledgeGovernan
状态：implemented
变更：2026-10-08-gov-action-stderr-noise
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-08-gov-action-stderr-noise/design.md
文件：sillyhub-daemon/src/runtime-handler.ts, sillyhub-daemon/tests/knowledge-governance-handler.test.ts
最近确认：未记录
理由：知识信号卡「一键修复路径」的完成提示被 Node SQLite ExperimentalWarning 淹没：daemon `KnowledgeGovernanceHandler.action()` 把 CLI 子进程的 stdout+stderr 拼接取尾 2000 字符 返回，前端只展示末尾 160 字符；sillyspec CLI（Node 22+ `node:sqlite`）每次运行必往 stderr 打两行告警噪声，恰好落在拼接尾部，把真实结果文案（如「N 个无法定位需人工核」） 挤出前端可见区。方案：daemon 侧在拼接 output 前用 `stripNodeWarningNoise()` 按行过滤 stderr 中的 Node 进程告警行。选 daemon 侧而非前端侧：噪声源头在子进程 stderr，在源头 滤一次，成功 output 与失败 `action failed` 前缀两路同时受益；前端尾部展示逻辑不动。

## D-daemon-005@v1 2026-10-09-daemon-api-types-regen——单一动作：在 sillyhub-daemon 目录跑既有 `pnpm gen:types`（scripts/gen-api-types.mjs 消费仓库 bac
状态：implemented
变更：2026-10-09-daemon-api-types-regen
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-09-daemon-api-types-regen/design.md
文件：sillyhub-daemon/src/api-types.ts
最近确认：未记录
理由：单一动作：在 sillyhub-daemon 目录跑既有 `pnpm gen:types`（scripts/gen-api-types.mjs 消费仓库 backend/openapi.json 单一契约源），重生成 src/api-types.ts。动机：2026-10-09 风险审查实证该副本仍是旧 72 项 Permission 联合（含 2026-10-08 RBAC 清理删除的 16 个死键），且落后多轮后端契约（含知识图谱端点）；daemon 源码无按值消费死键的代码（grep 实证），故为类型债而非运行时风险，但仍违反规则 21「生成物不落后后端」精神。选纯重生成而非手改：生成物逐字来自 openapi.json，手改必再造漂移。

## D-daemon-006@v1 2026-10-09-daemon-page-stable-sort——问题根因在后端排序键选择：`/api/daemon/machines`（守护进程页面唯一数据源，前端 15s 轮询）主查询 `ORDER BY case(onl
状态：implemented
变更：2026-10-09-daemon-page-stable-sort
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-09-daemon-page-stable-sort/design.md
文件：backend/app/modules/daemon/grants/queries.py, backend/app/modules/daemon/runtime/service.py, backend/app/modules/daemon/tests/test_machines_router.py
最近确认：未记录
理由：问题根因在后端排序键选择：`/api/daemon/machines`（守护进程页面唯一数据源，前端 15s 轮询）主查询 `ORDER BY case(online→0), last_heartbeat_at DESC`——`last_heartbeat_at` 每次心跳（约 15s 一跳）都被 UPDATE，机器间相对先后随时翻转，页面刷新即乱序；嵌套 runtimes 二次查询仅 `ORDER BY provider`，同 provider 多 agent 并列时 DB 返回顺序不定，agent 卡随之乱跳。 修法：把机器列表排序键换成不变的稳定键——保留 design §5.1 的 online 优先分组，组内改按展示名 `coalesce(display_alias, hostname)` 升序（与机器卡头展示名同口径，用户可预期），`id` 升序兜底保证全序确定；嵌套 runtimes 与「共享给我的」明细查询在 provider 之后追加 `created_at, id` tiebreaker。前端零改动（顺序随响应走），无 API 形状变化。

## D-daemon-007@v1 2026-10-09-graph-text-backslash——单字符集补丁：GRAPH_TEXT_BLACKLIST_RE 在既有元字符全集外补 `\`，并新增 ②b 测试用例（反斜杠三形态 × 三参数位，全部断言 val
状态：implemented
变更：2026-10-09-graph-text-backslash
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-09-graph-text-backslash/design.md
文件：sillyhub-daemon/src/runtime-handler.ts, sillyhub-daemon/tests/knowledge-governance-handler.test.ts
最近确认：未记录
理由：单字符集补丁：GRAPH_TEXT_BLACKLIST_RE 在既有元字符全集外补 `\`，并新增 ②b 测试用例（反斜杠三形态 × 三参数位，全部断言 validation_rejected + 零 spawn）。机理：graph 拼串把锚点包进双引号，尾反斜杠会转义闭合引号，POSIX shell 把后续旗标吞进锚点参数——命令分隔符（;|&`$() 等）均已在黑名单内故无命令注入面，后果限于 CLI 收到粘连参数报错 → 回 internal（stderr 截 500），属消毒面完整性加固。选字符级拒绝而非引号转义处理：正常节点 id 字符集（/ # : @ - _ . 中文）不含反斜杠（实测样本），字符级拒绝与既有 9 类元字符消毒语义同构，不引入「哪些位置的反斜杠才危险」的判定复杂度。

## D-daemon-008@v1 2026-10-10-duration-api-cumulative-fix——答：线上会话 0d6b2ba9 实证（postgres 直查）——claude 引擎 SDK 结果的 duration_api_ms 是**会话级累计快照**（
状态：implemented
变更：2026-10-10-duration-api-cumulative-fix
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-10-duration-api-cumulative-fix/design.md
文件：backend/app/modules/daemon/run_sync/service/close_run_steps.py, backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py, sillyhub-daemon/src/daemon.ts, sillyhub-daemon/tests/daemon-interactive-bridge.test.ts
最近确认：未记录
理由：答：线上会话 0d6b2ba9 实证（postgres 直查）——claude 引擎 SDK 结果的 duration_api_ms 是**会话级累计快照**（逐轮单调递增：2207767→…→3171192，13 秒 轮被写 52.8 分钟），而 duration_ms 是 per-query 墙钟（各轮=本轮墙钟）。close 原样把累计值写进 per-run 列 → 终态 tok/s = 本轮输出 ÷ 会话累计时长 → 逐轮衰减 （0.4 tok/s 实证）。修复两层：① daemon onTurnResult 按会话差分为本轮增量（照搬 同族量 total_cost_usd/_modelUsageBaselineBySession 的既有累计快照差分范式， 含复位报全量与 onSessionEnd/onSessionReloaded 基线回收）；② backend close 物理守卫 （api 时长 > 墙钟为不可能值拒收，保留既有值）防任何引擎再写垃圾。cumulative increment 与各轮墙钟吻合（DB 逐轮核对 +28.7s/+9.9s/+13.2s），差分后语义正确。

## D-daemon-009@v1 2026-10-10-repo-native-no-platform-markers——根因：repo-native 的「零投毒」依赖一条守卫链——sillyspec CLI 的 isSelfReferentialSpecRoot 用 realpa
状态：implemented
变更：2026-10-10-repo-native-no-platform-markers
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-10-repo-native-no-platform-markers/design.md
文件：docs/sillyspec/verify-dynamic-subset-node-test-ts-source.md, sillyhub-daemon/src/spec-sync.ts, sillyhub-daemon/tests/test_init_lease.test.ts
最近确认：未记录
理由：根因：repo-native 的「零投毒」依赖一条守卫链——sillyspec CLI 的 isSelfReferentialSpecRoot 用 realpath 穿透 junction 判回环，回环则拒写平台标记三件套；而 daemon `pullSpecBundle`（sillyhub-daemon/src/spec-sync.ts）的 repo-native 分支在**源项目无 .sillyspec** 时降级走 platform-managed pull（缓存成普通目录），以及 `ensureSpecJunction` 遇**缓存普通目录残留**时返回 false 降级——两种降级都让缓存不再是 junction，守卫链断裂，init 三写把 `.sillyspec-platform.json` / `.sillyspec-platform-managed` / `.sillyspec-platform-cleaned` 投毒进源项目根（deepseek-harness 项目实证：无 .sillyspec 但三件套齐全）。 修法（daemon 单侧，sillyspec CLI 零改动）：① repo-native 分支源项目无 .sillyspec 时不再降级——就地 mkdir 空目录后照常建 junction（「源项目即真理」语义下空真理源就地创建，用户创建工作区时的 ⚠ 写入警示已覆盖该授权）；② `ensureSpecJunction` 普通目录残留从「直接 return false 降级」改为「rename 到 `<wsId>.pre-junction-backup-<时间戳>` 备份后建 junction」，rename 失败才保守降级。两处都把 junction 成功率拉满，守卫链在全部 repo-native 路径闭合。

## D-daemon-010@v1 2026-10-10-run-close-task-sweep——线上实证（会话 47e2ff1a，run 5e485ba2 completed 09:00:41）：`agent_session_task` 17 条卡 run
状态：implemented
变更：2026-10-10-run-close-task-sweep
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-10-run-close-task-sweep/design.md
文件：backend/app/modules/agent/service.py, backend/app/modules/daemon/agent_task_store.py, backend/app/modules/daemon/run_sync/service/close_run_steps.py, backend/app/modules/daemon/tests/test_agent_session_tasks.py
最近确认：未记录
理由：线上实证（会话 47e2ff1a，run 5e485ba2 completed 09:00:41）：`agent_session_task` 17 条卡 running（最后更新停在 08:37，全部属该 run），任务列表在会话结束后仍显示子代理「进行中」。根因：该表只按 `agent_task_status` 事件 upsert（agent_task_store），run 终态的两条路径——close_interactive_run（daemon 收口）与 cleanup_stale_runs（重启判死）——都不清理其任务行，子代理被放弃/未上报终态时永卡 running。修法：agent_task_store 新增 `finalize_running_tasks_for_run`（单 run 批量 UPDATE running→stopped + 可读 message），close_interactive_run 在终态 commit 前同事务调用（原子：run 终态与任务收口同生共死）；新增 `sweep_orphan_running_tasks` 启动兜底（run 已终态但任务仍 running 的存量全量收口，自愈历史脏数据——47e2ff1a 的 17 条在下次部署重启后自动修复，无需手工 SQL），挂在 cleanup_stale_runs 尾部 try/except。不选「读端把终态 run 的 running 任务渲染为停止」——治标且脏数据永存。

## D-daemon-011@v1 2026-10-10-task-wakeup-quiet-threshold——问题根因（生产实证，阿里云会话 0d6b2ba9）：Claude Code 引擎的后台子代理终态每个都触发 daemon 唤醒注入（`scheduleTaskW
状态：implemented
变更：2026-10-10-task-wakeup-quiet-threshold
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-10-task-wakeup-quiet-threshold/design.md
文件：backend/app/modules/daemon/session/service/queue.py, backend/app/modules/daemon/tests/test_session_queue.py, docs/sillyspec/archived-change-resurrect-by-merge.md, sillyhub-daemon/src/interactive/session-manager/background-tasks.ts, sillyhub-daemon/tests/interactive/task-lifecycle.test.ts
最近确认：未记录
理由：问题根因（生产实证，阿里云会话 0d6b2ba9）：Claude Code 引擎的后台子代理终态每个都触发 daemon 唤醒注入（`scheduleTaskWakeup`），13 分钟灌 18 条「后台任务通知」——其中 17 条是 后台调研子代理内部派的秒级搜索步骤（孙任务），唯一的真长任务（12:50）才是唤醒机制原本 服务的对象；忙轮时这些通知还进排队栏与用户消息混排、挤占 5 条额度，队满时被静默丢弃。 方案（两点，都最小侵入）： 1. **daemon 唤醒门槛**：`handleTaskNotificationEvent` 在 completed/failed 唤醒分支前加 时长判定——`elapsed_ms`（服务端权威）优先，缺失用注册表条目 `startedAt` 差值兜底， 实际运行 < `TASK_WAKEUP_MIN_DURATION_MS`（60_000ms）直接 return 跳过 `scheduleTaskWakeup`。60 秒的取值依据：实证噪音全部 ≤15s，真任务 770s，中间留一个 数量级的安全带。门槛只拦「唤醒注入」，emit/落行/注销/清锚点全不动（终态簿记完整， 主代理随时可 TaskOutput 自取短任务结果）。 2. **backend 队满豁免**：`queue.py` 满员检查把 `[后台任务通知]` 前缀条目从计数中剔除 （用户额度只数用户自己的），且通知类注入自身豁免满员拒绝——它走既有 ql-20260827-015 同条合并恒 ≤1 条 pending，无撑爆风险。 不做（FR-04 非目标）：孙任务判别（SDK task 事件无 depth/父 tool_use 稳定信号，需先 spike；门槛已把实证噪音全灭）、排队栏前端分开展示（门槛落地后频率骤降，纯展示优化 留待后续）。

## D-daemon-012@v1 2026-10-10-usage-note-to-daemon-log——`sillyhub-daemon/src/daemon.ts` 的 `onTurnResult` 中删除 [USAGE_NOTE] 消息流发射块，改为在 cos
状态：implemented
变更：2026-10-10-usage-note-to-daemon-log
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-10-usage-note-to-daemon-log/design.md
文件：sillyhub-daemon/src/daemon.ts, sillyhub-daemon/tests/interactive/daemon-usage-note.test.ts
最近确认：未记录
理由：`sillyhub-daemon/src/daemon.ts` 的 `onTurnResult` 中删除 [USAGE_NOTE] 消息流发射块，改为在 cost 快照差分组装完成后（`payload.total_cost_usd` 就绪处）输出一条 daemon 结构化 info 日志（事件 `run_cost_may_include_bg_tasks`，字段 session_id / run_id / cost_delta_usd）。 选"不报 + 日志降级"而非用户备选的"阈值版只在明显异常时报"：SDK 只给会话级累计快照，不存在"本轮真实成本"的真值基准，任何"明显异常"阈值都无法校准——误报会把同样的噪音重新带回会话流，漏报让功能形同虚设。日志带具体差分数字（比原消息流行信息量更大），且不进用户可见的会话流；原 2026-09-15 FR-04 的排障意图（标识"本轮用量可能含后台任务消耗"）完整保留。

## D-daemon-013@v1 2026-10-11-daemon-masked-test-fix——drift 门自 2026-10-09 引入起一直在 Test 步前红灯，daemon 测试面从未在 CI 真正跑过——上一变更清偿 drift 后首次执行即暴
状态：implemented
变更：2026-10-11-daemon-masked-test-fix
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-11-daemon-masked-test-fix/design.md
文件：sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts, sillyhub-daemon/tests/fixtures/claude-sdk-messages/golden-session.events.json, sillyhub-daemon/tests/interactive/golden/claude-events-golden.test.ts, sillyhub-daemon/tests/protocol-session-contract.test.ts
最近确认：未记录
理由：drift 门自 2026-10-09 引入起一直在 Test 步前红灯，daemon 测试面从未在 CI 真正跑过——上一变更清偿 drift 后首次执行即暴露 8 例存量失败，三类全部为测试面滞后于有意生产行为：①协议 MSG 计数钉 24 落后于 0b09d1555 新增的 SILLYSPEC_TOMBSTONE_CLEANUP（实 25）；②golden 事件流快照缺 live-token-speed（21eb98d53）新增的 usage.api_duration_ms 产出键（帧 7/15/29 = 500/1100/400）；③mission_worker 兜底代报 6 例拿 pi 当 mcp=false 载体，而 7bd743230（all-engines-mcp-injection task-08，SPIKE-00 实测）已把 pi.caps.mcp 翻 true——daemon 对 pi 停止代报是防双写的有意行为。修法：①计数钉前移 + 来历注释；②快照按实测产出补三键 + 头注记录 + §2 锚点同步；③机制断言原样换 codex 载体（仍 mcp=false）+ 新增 pi 零代报钉子。生产代码零改动。

## D-daemon-014@v1 2026-10-11-sync-conflict-tri-fix——三处闭环修复 spec 同步乐观锁冲突的「报而不修、修无入口」断裂： 1. **前端（platform-sync-section.tsx）**：把注册表开放行中
状态：implemented
变更：2026-10-11-sync-conflict-tri-fix
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-11-sync-conflict-tri-fix/design.md
文件：frontend/src/components/changes/__tests__/platform-sync-section.test.tsx, frontend/src/components/changes/platform-sync-section.tsx, sillyhub-daemon/src/spec-sync.ts, sillyhub-daemon/tests/spec-sync-incremental.test.ts
最近确认：未记录
理由：三处闭环修复 spec 同步乐观锁冲突的「报而不修、修无入口」断裂： 1. **前端（platform-sync-section.tsx）**：把注册表开放行中「版本冲突面」非空的行，按 conflicting_paths 用 `^changes/(?:archive/)?([^/]+)/` 归因出变更名，去重后并入 renderRows 渲染为 spec 型冲突行——复用既有「查看对比 → ConflictCompareModal → 保本地/取平台」裁决通道。堵「横幅 1 条、区块 0 条、无裁决入口」的口径分裂。 2. **daemon（sillyhub-daemon/src/spec-sync.ts postSpecSyncImpl）**：增量推送收到 conflict=true 且 server_versions 非空时，用响应自带的 server_versions 就地改写**内存**清单缓存（LocalManifest.files[path].version），重算 computeIncrementalOps 并重试恰好一次。多数「他端先推/重复推送」型冲突（生产实证 workflow 工作区：镜像哈希已与本地一致）re-base 后同内容豁免或 base 匹配即全绿；backend 注册表行随全绿自动关闭，形成自愈闭环。真分叉重试仍冲突 → 照旧抛 SpecPushConflict 走人工裁决（此时缺口 1 的行给出入口）。 3. **CLI（sillyspec 仓，跨仓改动）**：`platform sync` 无 --change 从「报错要变更名」改为全树 spec 同步（syncSpecTree 本就是全树 diff，changeName 仅作冲突归因标签，空值时按冲突路径归因：单一变更名兼容 per-change resolve，跨变更归并 'full-tree'）；assertSafeChangeName 字符集扩 CJK `一-鿿`（对齐 assertDatedChangeName slug 集——路径穿越消毒才是该守卫的本职，ASCII 限制是历史误伤，磁盘既有中文名变更由此可同步/裁决）。

## D-daemon-015@v1 2026-10-11-task-sweep-daemon-truth——用户两轮指正击毙了两代启发式：v1「run 终态即收」（后台任务跨轮存活）、v2「5 分钟无心跳即收」（长耗时任务可能静默更久）。
状态：implemented
变更：2026-10-11-task-sweep-daemon-truth
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-11-task-sweep-daemon-truth/design.md
文件：backend/app/modules/agent/provider_caps.py, backend/app/modules/agent/service.py, backend/app/modules/daemon/agent_task_store.py, backend/app/modules/daemon/run_sync/service/close_run_steps.py, backend/app/modules/daemon/tests/test_agent_session_tasks.py, frontend/src/lib/provider-caps.ts, sillyhub-daemon/src/cli.ts, sillyhub-daemon/src/codex-settings.ts, sillyhub-daemon/src/daemon.ts, sillyhub-daemon/src/interactive/codex-app-server-driver.ts, sillyhub-daemon/src/interactive/cursor-driver.ts, sillyhub-daemon/src/interactive/pi-rpc-driver.ts, sillyhub-daemon/src/interactive/providers.ts, sillyhub-daemon/src/interactive/session-manager/background-tasks.ts, sillyhub-daemon/src/pi-settings.ts, sillyhub-daemon/tests/codex-settings-mcp.test.ts, sillyhub-daemon/tests/interactive/session-live-task-ids.test.ts, sillyhub-daemon/tests/mcp-config.test.ts, sillyhub-daemon/tests/pi-settings-mcp.test.ts
最近确认：未记录
理由：用户两轮指正击毙了两代启发式：v1「run 终态即收」（后台任务跨轮存活）、v2「5 分钟无心跳即收」（长耗时任务可能静默更久）。任何基于时间/轮次的推断都猜不准「静默但活着」与「死了没上报」——唯一可靠判据是 daemon 后台任务注册表（mgr._backgroundTasks：task_started 注册 / task_notification 注销 / 会话终态清空=SDK 进程 kill 任务随进程消亡，daemon 自己的权威语义）。本变更把死活判定搬到真相源：daemon 新增 `session_live_tasks` 只读 RPC（既有 rpc_id 请求-响应通道，list_dir 平名注册先例；数据经新 helper sessionLiveTaskIds 只读快照，不建空条目）；后端清扫重写为 `sweep_confirmed_dead_tasks`——会话终态/无 runtime 候选直接收（daemon 语义背书），其余逐 runtime 问活跃集、不在集内才收，daemon 离线/超时/旧版 method_not_found 跳过该批（fail-open 保活）；run 收口不再立即收（只在该 run 有非终态候选时 fire 60s 后的 run 限定确认清扫），启动清理同改确认制；TASK_SWEEP_GRACE/is_async/updated_at 全部移出死判；清扫标记与复活分支保留为误收兜底。

## D-daemon-016@v1 2026-10-11-task-sweep-liveness-guard——用户指正上一变更（2026-10-10-run-close-task-sweep）的核心假设错误：「run 终态 = 任务必死」不成立——后台子代理任务本来就跨
状态：implemented
变更：2026-10-11-task-sweep-liveness-guard
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-11-task-sweep-liveness-guard/design.md
文件：backend/app/modules/daemon/agent_task_store.py, backend/app/modules/daemon/run_sync/service/close_run_steps.py, backend/app/modules/daemon/tests/test_agent_session_tasks.py
最近确认：未记录
理由：用户指正上一变更（2026-10-10-run-close-task-sweep）的核心假设错误：「run 终态 = 任务必死」不成立——后台子代理任务本来就跨轮次存活（主代理开轮派发后轮结束、任务继续跑、跑完发 [后台任务通知] 唤醒新轮继续回复），且线上 agent_session_task.is_async 恒为 false（daemon 上报未打标），按标记排除保护不了它们；run 关闭即清扫会把真实在跑的后台任务错标「已停止」，而迟到 running 心跳又被终态吸收冻结在错误状态（该清扫代码已被并行会话部署上线，一次扫了 112 条，当时恰好零异步任务零实际误伤，语义缺口真实存在）。修法三件：①死判改「最近无心跳」——两个清扫函数条件收紧为 is_async=false 且 updated_at 距清扫时刻超 TASK_SWEEP_GRACE（5 分钟，心跳活跃即豁免）；②清扫行带 RUN_CLOSE_SWEEP_REASON 标记 + upsert 复活分支（标记行收 running 心跳即复活，自愈误收；真实终态行维持吸收）；③close 恒排延迟复扫（宽限+60s 后重跑 finalize，新鲜后沉默的孤儿不靠后端重启收敛）。

## D-daemon-017@v1 2026-10-12-duration-backfill-harness-align——答：用户正确质疑昨日守卫（duration_api_ms > duration_ms 拒收）——子代理并行时 Σ(各代理 API 窗口) > 父轮墙钟是合法形态
状态：implemented
变更：2026-10-12-duration-backfill-harness-align
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-12-duration-backfill-harness-align/design.md
文件：backend/app/modules/daemon/run_sync/service/close_run_steps.py, backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py
最近确认：未记录
理由：答：用户正确质疑昨日守卫（duration_api_ms > duration_ms 拒收）——子代理并行时 Σ(各代理 API 窗口) > 父轮墙钟是合法形态，守卫会拒掉真实值。对照 deepseek-harness 本地源码（packages/session/session-stats/src/projection.ts:154-175）：终态时长权威 =事件层自测窗口逐步累加（llmMs=完成时刻−step 开始、decodeMs=完成−首 token， 按 step 求和），不消费提供方 duration 聚合，Σ窗口>墙钟合法无守卫。本平台等价物 =已建的实时窗口累加（usage.api_duration_ms，claude/codex/pi 桶计时）。故撤销墙钟 守卫，close 元数据降级为回填（列 NULL 才写，实测值权威不覆盖）。

## D-daemon-018@v1 2026-10-12-pi-oldhost-fallback-pin——24h 审查 P2-2 原判「旧版 pi 宿主 mission_worker 产出无人上报」经复核**降级**：daemon.ts:4236 的 +90s 延迟
状态：implemented
变更：2026-10-12-pi-oldhost-fallback-pin
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-12-pi-oldhost-fallback-pin/design.md
文件：sillyhub-daemon/src/daemon.ts, sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts
最近确认：未记录
理由：24h 审查 P2-2 原判「旧版 pi 宿主 mission_worker 产出无人上报」经复核**降级**：daemon.ts:4236 的 +90s 延迟兜底探测（ql-20260911-028）对一切 mission_worker 成功轮生效、`_fallbackWorkerDone` 无 provider 门——旧版 pi 宿主（pi-rpc-driver 运行时探测 major<1 跳过 MCP 注入、会话无 worker_done 工具）实际经该探测在 90s 后收敛，与「claude 分身未调工具」同一安全网形态，90s 延迟属设计内代价而非产出丢失。残余风险是覆盖面无测试钉住、注释未披露（未来重构若给延迟探测加 provider 门或改立即门语义，旧版 pi 收敛面会静默回归）。修法：测试面补 pi 载体钉子（对齐既有 claude 延迟兜底用例的 harness 与断言形态）+ daemon.ts 立即代报门注释与测试头注补披露；生产逻辑零改动。

## D-daemon-019@v1 2026-10-12-regression-review-remediation——回归复审（三代理对抗审查）对六条防线修复的清偿：①**高优先**——daemon-path-guard 给 linked_repos 两 RPC 加的机器白名单
状态：implemented
变更：2026-10-12-regression-review-remediation
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-12-regression-review-remediation/design.md
文件：sillyhub-daemon/src/borrow-sandbox-context.ts, sillyhub-daemon/src/daemon.ts, sillyhub-daemon/src/spec-sync.ts, sillyhub-daemon/tests/daemon-interactive-bridge.test.ts, sillyhub-daemon/tests/daemon-linked-repos-guard.test.ts, sillyhub-daemon/tests/test_init_lease.test.ts
最近确认：未记录
理由：回归复审（三代理对抗审查）对六条防线修复的清偿：①**高优先**——daemon-path-guard 给 linked_repos 两 RPC 加的机器白名单守卫与 ql-20260831-006 产品决策冲突（用户决策明确「工作区绑定会话的默认工作目录就在工作区内，机器白名单不该拦截它」，仓内生产实证 E:\sgm/F:\WorkNew 两处工作区根均不在家目录白名单；会话 cwd 守卫 interactive-cwd-guard 为此专门跳过白名单、错机保护走存在性检查），现网存量部署会被首次 forbidden 拒止。修法：两 handler 白名单门改存在性检查（stat 非目录/不存在即抛错），与 interactive-cwd-guard 同一信任语义；②handleInitLease 头部 throw 穿透 _runInitLease 的「逐步 catch 不上抛」契约 → 改 ok:false 结果体（保 init 统计诊断链），pullSpecBundle 抛错不动（三处调用方均 catch 可见）；③注释勘误：NaN 污染窗口实为 1 轮（set 随即覆写，非「恒 NaN」）、pi 延迟探测补多轮收敛 caveat（workers 行按首 run id 锚定，追问轮 runId 恒 miss——ql-20260911-028 既有行为非本窗口引入）、borrow JSDoc 去具体计数；④num_turns/duration_ms 裸 typeof 叠 isFinite 对齐口径（NaN 单轮字段 NULL 面消除）。

## D-daemon-020@v1 2026-10-12-task-sweep-rpc-route-key——确认制清扫的候选按 `AgentSession.runtime_id`（=`daemon_runtimes.id`）分组，而 `DaemonWsHub` 连接表
状态：implemented
变更：2026-10-12-task-sweep-rpc-route-key
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-12-task-sweep-rpc-route-key/design.md
文件：backend/app/modules/agent/service.py, backend/app/modules/daemon/agent_task_store.py, backend/app/modules/daemon/tests/test_agent_session_tasks.py
最近确认：未记录
理由：确认制清扫的候选按 `AgentSession.runtime_id`（=`daemon_runtimes.id`）分组，而 `DaemonWsHub` 连接表按 `daemon_instance_id` 注册（`gateway_misc.py` 握手 `daemon_local_id`、`ws_hub.py:106`）——runtime 主键是注册时随机 uuid4，与 instance id 永不相等，`is_connected(runtime_id)` 恒 False，确认 RPC 全部被当「离线」跳过。修法：分组后逐 runtime 经既有帮手 `_resolve_daemon_id_for_runtime`（`session/service/helpers.py:133`：`session.get(DaemonRuntime)` 查归属 instance；NULL 回落 runtime_id；行缺失返 None）解析路由键再发 RPC；行缺失时该 runtime 候选整体跳过（fail-open，与离线同语义）。帮手在函数内延迟 import（对齐本模块 `AgentSession` 同款，避免 `session.service` 包级循环依赖）。测试未拦截的根因一并说明：共享夹具 `_create_runtime` 不设 `daemon_instance_id`（恰好走 legacy 回退=错误键）且 `_StubHub` 按错误键收调用——新增用例显式建 instance 并断言映射键。 启动清扫（`cleanup_stale_runs` 内联 await，lifespan 时点执行）在此刻 hub 连接表必空（uvicorn 未开始 accept，单进程 CMD 无 --workers），确认分支恒落空。改为延迟后台任务：对齐 `_recheck_stale_runs_loop` 既有模式——`asyncio.create_task` + `AgentService._background_tasks` 强引用 + `_on_background_task_done` 回收；协程内 `asyncio.sleep(_STARTUP_TASK_SWEEP_DELAY_SECONDS)`（默认 60s，给 daemon WS 重连留窗口）后自开 `get_session_factory()` 独立 session 执行 sweep；全程 try/except 记日志，异常不阻断启动。

## D-daemon-021@v1 2026-10-13-agent-task-stuck-running——「子代理已完成但 UI 永久运行中」有三个叠加根因（排查实证，见 FR 正文）：① daemon `claude-events.ts` `_toolUseSes
状态：implemented
变更：2026-10-13-agent-task-stuck-running
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-13-agent-task-stuck-running/design.md
文件：docs/sillyspec/thin-done-empty-face-no-declared-crosscheck.md, frontend/src/components/daemon/__tests__/task-line-assembler.test.ts, frontend/src/components/daemon/session-log-assembler.ts, sillyhub-daemon/src/interactive/claude-events.ts, sillyhub-daemon/src/interactive/session-manager/background-tasks.ts, sillyhub-daemon/tests/fixtures/claude-sdk-messages/golden-session.events.json, sillyhub-daemon/tests/interactive/claude-events.test.ts, sillyhub-daemon/tests/interactive/task-lifecycle.test.ts
最近确认：未记录
理由：「子代理已完成但 UI 永久运行中」有三个叠加根因（排查实证，见 FR 正文）：① daemon `claude-events.ts` `_toolUseSessionSignals` 的 Task/Agent tool_use 派生 running 事件以 call id 冒充 task_id 且不带 `tool_use_id`，导致 backend 2026-10-12-session-defects task-03 已落地的幽灵成对行写侧收口（依赖事件携带 tool_use_id）对冒名行永不生效——生产会话 47e2ff1a 实证 21 组成对行；② daemon `background-tasks.ts` `handleTaskNotificationEvent` 对注册表别名条目（tool_use 派生懒注册的 call id 条目）从不补发终态，别名条目永卡 running；③ 前端装配器 task 行在 parent_tool_use_id 未命中时整行丢弃（session-log-assembler.ts task 分支），[TASK_NOTIFICATION] 终态信号丢失则派发段永转圈（turn-state.ts 跨轮路由注释实证）。 修法（daemon + frontend 两端各一小刀，不动 backend——其写侧收口与读侧去重 2026-10-12 已落地，本变更让 daemon 数据流满足其触发前提）：daemon 侧派生事件补 `tool_use_id` + 终态时别名条目注销/补发 + 三无场景 WARN 日志；前端装配器提取并持久 task_id、parent 未命中时按 task_id 轮内 DFS 兜底吸收。backend 清扫只写 stopped 的保守语义维持不动（无结果证据时不得标 completed）。

## D-daemon-022@v1 2026-10-13-multiturn-changeid-misjudge——`_apply_session_terminal_status`（backend/app/modules/daemon/session/service/help
状态：implemented
变更：2026-10-13-multiturn-changeid-misjudge
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-13-multiturn-changeid-misjudge/design.md
文件：backend/app/modules/daemon/session/service/helpers.py, backend/app/modules/daemon/tests/test_apply_session_terminal_status.py, backend/app/modules/daemon/tests/test_close_interactive_run_session_status.py, docs/sillyspec/thin-done-empty-face-no-declared-crosscheck.md
最近确认：未记录
理由：`_apply_session_terminal_status`（backend/app/modules/daemon/session/service/helpers.py:147）的多轮判定从 `run.change_id is None` 改为 `session.change_id is None`。依据：`AgentSession.change_id` 语义是"会话本身为 change 而建"（model.py:759，stage 派发在 session/service/create.py:291 写入），而 `run.change_id` 自 2026-10-12-run-level-change-attribution（model.py:767 `current_change_id` 列注释）起被轮级归因给聊天轮打锚，已不再是"会话绑定 change"的可靠信号。线上实证（2026-10-13）：会话 47e2ff1a `session.change_id=NULL` 而 4 轮 run.change_id 全非空，每轮完成后会话被误置 ended；stage 会话 `session.change_id` 非空。改动一个判定锚 + 同步修注释（规则 18），语义等价于恢复归因功能上线前的行为。

## D-daemon-023@v1 2026-10-13-review-risk-fixes——答：2026-10-13 风险审查（最近 24h 两提交只读分析）实证两处缺陷：① bf4c47c07 的 F2b 合并缓冲器只落了 `eventToSubmi
状态：implemented
变更：2026-10-13-review-risk-fixes
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-13-review-risk-fixes/design.md
文件：backend/app/modules/agent/service.py, backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py, sillyhub-daemon/src/event-wire.ts, sillyhub-daemon/src/policy/path-utils.ts, sillyhub-daemon/src/policy/shell-paths.ts, sillyhub-daemon/src/task-runner.ts, sillyhub-daemon/src/task-runner/runner-types.ts, sillyhub-daemon/src/task-runner/spawn-stream.ts, sillyhub-daemon/tests/task-runner/spawn-stream-coalescer.test.ts
最近确认：未记录
理由：答：2026-10-13 风险审查（最近 24h 两提交只读分析）实证两处缺陷：① bf4c47c07 的 F2b 合并缓冲器只落了 `eventToSubmitMessages(ev, coalescer?)` 可选参，唯一生产调用点 `spawn-stream.ts handleLine`（经 `runner._eventToMessages`）未传实例——功能是死代码，提交宣称的碎片行修复未生效；② c782a9249 的 askwait 豁免无时间上限，且注释声称的「daemon 真死由离线清扫兜底」经查只存在于任务表清扫（`sweep_confirmed_dead_tasks` 不碰 AgentRun 且 daemon 离线时 fail-open），daemon 真死场景 run 永远 running、会话楔死。另有 path-utils 注释与实现不一致（anchor 声称双透传实为仅 target）与 isFlagToken 残留放行面未记档两处小项。 方案：① spawn-stream 按 attempt（spawnAndStream 单次调用）创建 `MessageCoalescer`，经 HandleLineEnv 透传给 `_eventToMessages`；attempt 收尾（含取消/超时 break 出循环后）flushAll 残留缓冲并经既有转发通道提交——转发逻辑从 handleLine 内联体提取为模块级 `forwardSubmitMessages` 单源复用，行为逐字节等价；`event-wire.ts` 新增 `coalescerFlushAllMessages`（flushAll 输出附消息级 timestamp，F2a 同口径）。② `_run_awaiting_user_input` 增加 `now` 参数与 24h 上限常量：最后 ask 信号超龄 → 返回 False 走既有判死路径；时限内行为零回归。③④ 两处纯注释对齐/记档，无行为变化。

## D-daemon-024@v1 2026-10-13-sillyspec-version-probe-fast-retry——问题根因：注册期 `probeLocal()`（shell 跑 `sillyspec --version`，30s 超时）瞬态失败（冷启动慢/超时杀树）后 `_
状态：implemented
变更：2026-10-13-sillyspec-version-probe-fast-retry
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-13-sillyspec-version-probe-fast-retry/design.md
文件：sillyhub-daemon/src/daemon.ts, sillyhub-daemon/src/sillyspec-manager.ts, sillyhub-daemon/tests/daemon-heartbeat-sillyspec.test.ts, sillyhub-daemon/tests/sillyspec-manager.test.ts
最近确认：未记录
理由：问题根因：注册期 `probeLocal()`（shell 跑 `sillyspec --version`，30s 超时）瞬态失败（冷启动慢/超时杀树）后 `_version=null`，而唯一的周期性重探入口是第四循环 `_sillyspecLoop`（默认 3600s 且先睡后查）——失败后最长 1 小时内无人重探，心跳第 5 参因「version=null 键不出现=backend 保留 NULL」持续缺席，机器卡长期误显「sillyspec 未安装」。 方案：在 `SillySpecManager` 内加**限频重探入口** `retryProbeLocalIfUnknown()`（version 未知且距上次尝试 ≥`versionRetryMs`，默认 120s，才真正执行一次 `probeLocal()`），daemon `_sendHeartbeatOnce` 每拍在组装 sillyspec 快照**前**以 void fire-and-forget 触发（duck-type 守卫）。自愈时延 = 120s 窗口 + 至多一个心跳间隔（默认 15s），不再依赖 1 小时循环；成功后下一拍心跳即带 version，backend 列收敛、徽标消失。选 manager 内限频而非 daemon 侧计数：限频状态（lastAttemptAt）与探测行为同源单一，daemon 侧零状态、测试可独立注入假钟。

## D-daemon-025@v1 2026-10-13-spawn-flush-e2e-test——答：2026-10-13-review-risk-fixes 独立评审 PASS 但留 P3：spawnAndStream 收尾冲刷（break 出 readl
状态：implemented
变更：2026-10-13-spawn-flush-e2e-test
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-13-spawn-flush-e2e-test/design.md
文件：sillyhub-daemon/tests/task-runner/spawn-flush-e2e.test.ts
最近确认：未记录
理由：答：2026-10-13-review-risk-fixes 独立评审 PASS 但留 P3：spawnAndStream 收尾冲刷（break 出 readline 后 flushAll → forwardSubmitMessages → await pendingForwards）只有组合件单测，收尾序列本身无执行级守护。本变更新增 `tests/task-runner/spawn-flush-e2e.test.ts` 直调 `spawnAndStream(runner, params)` 全函数——沿用 tests/task-runner.test.ts 先例 `vi.mock('node:child_process')` + `tests/helpers/fake-child.ts` 的 FakeChild 驱动真实 readline/decodeStream/收尾序列，fake runner 的 `_eventToMessages` 委托真实 `eventToSubmitMessages(ev, coalescer)`、`client.submitMessages` 捕获转发批次。纯测试新增，零 src 改动。 三条路径各一用例：取消（AbortSignal.abort → onAbort 置 cancelled + kill → FakeChild exit → exitCloser 关 readline → break）、超时（ctx.timeoutSeconds=0.05 武装毫秒级看门狗 → timedOut + kill → exit → break）、正常关闭（_endStdout push null + exit 0）。断言统一：abort/关闭前 delta 已缓冲零直发；收尾后残留冲刷为单行（拼接内容 + timestamp）恰经 client.submitMessages 转发一批；status 分别为 cancelled/timeout/completed。

## D-daemon-026@v1 2026-10-13-task-wakeup-remove——在生产者源头（sillyhub-daemon）整体移除唤醒链：`handleTaskNotificationEvent` 里的 completed/failed
状态：implemented
变更：2026-10-13-task-wakeup-remove
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-13-task-wakeup-remove/design.md
文件：backend/app/modules/platform_sync/schema.py, backend/app/modules/platform_sync/tests/test_agent_log_messages.py, backend/openapi.json, frontend/src/components/agent-log/__tests__/tool-renderers-write-diff.test.tsx, frontend/src/components/agent-log/tool-diff.tsx, frontend/src/components/agent-log/tool-renderers.tsx, frontend/src/components/daemon/agent-log-card.tsx, frontend/src/components/daemon/tool-args-detail.tsx, frontend/src/lib/api-types.ts, sillyhub-daemon/src/agent-log/parse-claude-code-jsonl.ts, sillyhub-daemon/src/agent-log/parse-zcode-model-io.ts, sillyhub-daemon/src/cli.ts, sillyhub-daemon/src/interactive/session-manager.ts, sillyhub-daemon/src/interactive/session-manager/background-tasks.ts, sillyhub-daemon/src/interactive/session-manager/lifecycle.ts, sillyhub-daemon/src/interactive/session-manager/types.ts, sillyhub-daemon/src/interactive/types.ts, sillyhub-daemon/tests/agent-log/parse-claude-code.test.ts, sillyhub-daemon/tests/interactive/task-lifecycle.test.ts
最近确认：未记录
理由：在生产者源头（sillyhub-daemon）整体移除唤醒链：`handleTaskNotificationEvent` 里的 completed/failed 唤醒分支（含 60s 安静阈值判定）删除，`scheduleTaskWakeup`（2s debounce 合并注入）、`onTaskWakeupInject` dep 及 cli.ts 接线（hubClient.injectSessionPrompt origin='task_wakeup'）、`_taskWakeupPending` 状态与 lifecycle 终态清理一并清零。选生产者侧而非 backend inject 端点侧：inject 端点是通用能力（服务凭证 + origin 门控），排队合并/豁免是消费端防御——留着零风险且可支持未来重启用；只删唯一生产者即可让「[后台任务通知]」从此不再产生。终态侧信道（emit/[TASK_NOTIFICATION] 落行/注销/别名收口/清锚点）全部不动，任务完成信息在时间线与任务面板仍可见；主代理在用户下一条消息到达后可用 TaskOutput 自取结果（prompt 文案既有指引，2026-10-10 安静阈值已生产验证该口径）。

## D-daemon-027@v1 2026-10-14-ci-red-batch-fix——main 最新 push（4347239）后三流水线共 5 处红，逐一考古后确认全部是测试债/类型债而非生产 bug，故本变更零生产代码改动，四处分别对齐既有契
状态：implemented
变更：2026-10-14-ci-red-batch-fix
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-14-ci-red-batch-fix/design.md
文件：backend/app/modules/agent/tests/test_mission_session_id.py, backend/app/modules/daemon/tests/test_run_sync_session_gate_failover.py, backend/app/modules/daemon/tests/test_session_events_cross.py, frontend/src/components/daemon/__tests__/agent-replay-body.test.tsx, sillyhub-daemon/src/api-types.ts
最近确认：未记录
理由：main 最新 push（4347239）后三流水线共 5 处红，逐一考古后确认全部是测试债/类型债而非生产 bug，故本变更零生产代码改动，四处分别对齐既有契约： 1. `test_mission_session_id.py::test_agent_sessions_model_fields_unchanged` 字段钉子停在 `engine_fork_anchor`（35 字段），漏同步 2026-10-12-run-level-change-attribution 有意新增的 `current_change_id`（姊妹守卫已由 11c4a5d51 同步，本守卫漏更）——expected 补列并同步 docstring 口径。 2. daemon 两个用例（gate_failover / session_events_cross）的 seed 仍把 change_id 只落在 `AgentRun` 上构造"单轮任务"，而 2fe772561（2026-10-13-multiturn-changeid-misjudge，生产会话 47e2ff1a 三次误关事故驱动）已把多轮/单轮判定锚换成会话级 `session.change_id`——seed 对齐新契约：gate helper 在 change_id 非 None 时同落 session；cross helper 增可选参 `session_change_id`（默认 None，现有调用零影响）。实现侧 `_apply_session_terminal_status` 是正确契约，一行不动（规则 9：非测试逻辑无误，禁止改实现迁就测试）。 3. `sillyhub-daemon/src/api-types.ts` 落后后端 OpenAPI（daemon-log-config-view 机器日志/配置端点已合入后端）——`pnpm gen:types` 重生成。 4. `agent-replay-body.test.tsx` 首用例 waitFor 只等 mock 被调用，CI 慢机并行下 React 渲染滞后一拍即挂——mock 调用等待后追加渲染完成锚 waitFor（`turn-timeline-scroll` 挂载 ⇔ messages 渲染完成，"累计 in…" 同源数据必然就位）。

## D-daemon-028@v1 2026-10-15-pseudo-domain-migration——用户指令「迁真域」的存量清偿面：sillyspec 仓 2026-10-15-module-path-glob-match 修复了模块路径 glob 匹配（扫描
状态：implemented
变更：2026-10-15-pseudo-domain-migration
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-15-pseudo-domain-migration/design.md
文件：backend/app/modules/agent/provider_caps.py, backend/app/modules/agent/tests/test_provider_caps_alignment.py, backend/app/modules/daemon/group/service/helpers.py, backend/app/modules/daemon/group/service/messages.py, backend/app/modules/daemon/group/service/shadow.py, backend/app/modules/daemon/schema.py, backend/app/modules/daemon/tests/test_group_attachment_gate.py, backend/openapi.json, frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx, frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx, frontend/src/components/sessions/session-list-panel.tsx, frontend/src/lib/api-types.ts, frontend/src/lib/daemon/runtimes.ts, frontend/src/lib/provider-caps.ts, sillyhub-daemon/scripts/gen-provider-caps.mjs, sillyhub-daemon/src/agent-detector.ts, sillyhub-daemon/src/api-types.ts, sillyhub-daemon/src/dsh-settings.ts, sillyhub-daemon/src/interactive/dsh-acp-driver.ts, sillyhub-daemon/src/interactive/dsh-acp-events.ts
最近确认：未记录
理由：用户指令「迁真域」的存量清偿面：sillyspec 仓 2026-10-15-module-path-glob-match 修复了模块路径 glob 匹配（扫描卡 146 条 glob paths 在全部归属判定点恒不命中——FR 铸伪域/决策落 unmapped 的根因），修复止增量；本变更清偿平台仓存量。 **判定链**（三条源依次兜底）：来源变更归档 design.md 交付表 → change-patch.json files → git log --grep 变更名 name-only 文件集（sillyspec 仓 frCoverageFiles 第三源同口径）→ 文件集经 modulePathMatches 对平台仓真实模块图（182 模块）求域 → 主域裁决规则（排除 test-utils 与一级聚合 frontend/backend/daemon/sillyhub-daemon → 具体域优先 → 命中文件数降序 → 名称长度降序；无具体域取聚合域）。人工改判两处留痕：deploy-script-version-echo-msys → deploy（机械误判 sillyspec，交付核心是 deploy/scripts；sillyspec(4) 为 .claude/skills 杂项误吸）；release-notes-server-sync → deploy_records（机械给 docs，跟随平台仓既有先例 auto-backend→deploy_records 迁发布记录条目）。 **FR 面**：92 条 auto-* 逐批 redomain --write（22 批）+ fr/unmapped 8 条（横断变更 2026-10-10-live-token-speed-daemon-timing 逐条按主题 anchor 迁移：三引擎计时→interactive、usage 契约→types、backend 提取/tokens SSE→daemon、前端显示→components-daemon、测试→frontend_components）。 **决策面**（442 段，工具= sillyspec 仓 2026-10-15-decision-redomain 新交付）：先数据修复三类脏段（①1 个粘连段：gov-action-stderr-noise 条目丢标题粘在上段尾部——补标题分拆；②3 个完全重复段：同 id 同变更幂等残留——去重；③4 行无主残迹：7b2c hash + 「过滤依赖」理由行不在归档真相源——剥离；修复经归档 decisions.md 核验，EOL 保真 CRLF）；然后 270 批 by-change（主域规则同 FR 面）+ 3 批 anchor（7 月早期变更无交付工件：rbac-permission-cache→auth 6 条、session-user-preamble→interactive 6 条、6 条无变更条目按主题 daemon 迁出）迁出 436 条；unmapped.md 空壳删除、INDEX 失效行自动清。

## D-daemon-029@v1 2026-10-16-provider-switch-transcript-sanitize——新增 daemon 侧纯离线清洗内核 `sillyhub-daemon/src/interactive/transcript-sanitize.ts`，并在 `
状态：implemented
变更：2026-10-16-provider-switch-transcript-sanitize
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-16-provider-switch-transcript-sanitize/design.md
文件：sillyhub-daemon/src/interactive/session-manager.ts, sillyhub-daemon/src/interactive/transcript-sanitize.ts, sillyhub-daemon/src/model-error/classifier.ts, sillyhub-daemon/tests/interactive/session-manager-config-switch.test.ts, sillyhub-daemon/tests/interactive/session-manager-resume-config-dir.test.ts, sillyhub-daemon/tests/model-error/classifier.test.ts, sillyhub-daemon/tests/transcript-sanitize.test.ts
最近确认：未记录
理由：新增 daemon 侧纯离线清洗内核 `sillyhub-daemon/src/interactive/transcript-sanitize.ts`，并在 `session-manager.ts` 的 `_reloadSessionNow` 供应商切换分支接上一个前置步骤：切换供应商（payload 判据 `providerSwitchPayload === true` 且引擎为 claude）时，先把该会话 transcript 里「上一家供应商私有、 新供应商必然无法解析」的块就地改写为等价 `text` 块，再 resume。 判定规则（单一真相导出常量）：私有调用块 = `server_tool_use` / `mcp_tool_use`（Anthropic 服务端工具块， 不是客户端 `tool_use`；第三方 Anthropic 兼容端点只认 `tool_use` ↔ `tool_result` 配对，实测 MiniMax 对这类块回 `400 ... tool result's tool id(...) not found`）；私有结果块 = 引用上述私有 id 的结果块 （`tool_result` 或 `*_tool_result`），无论它落在同一条 assistant 消息里还是相邻记录里。 改写方式**不做删除**：把每个脏块替换成一个 `text` 块（前缀「【历史清理】…」+ 原文内容），因此 ① 记录条数、`uuid`、`parentUuid` 链完全不变（CLI resume 定位与追加逻辑零影响）； ② 原文本信息不丢（如 analyze_image 的分析正文仍留在上下文里）。 写盘前把原文件备份为 `<文件名>.bak-sillyhub-<ISO时间戳>`，写盘走既有 `writeFileAtomic`（要么旧全文 要么新全文）。清洗是幂等的：干净文件再跑 `changed=false`、零写盘零备份。 不选「请求期改写」：要给所有 anthropic 流量做代理改写，越权面/性能面/安全面都不可控。不选「只加错误 提示不改历史」：用户依旧无法在新供应商下继续该会话。

## D-daemon-030@v1 2026-10-16-session-run-status-realtime——会话列表行首状态原本只靠 daemon 10s 日志活性推导链（用户指出：这是基线不是能力），用户触发会话后转圈/完成提示最长延迟 40s，且该链断（阿里云实测
状态：implemented
变更：2026-10-16-session-run-status-realtime
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-16-session-run-status-realtime/design.md
文件：backend/app/modules/daemon/router/session_crud.py, backend/app/modules/daemon/schema.py, backend/app/modules/daemon/tests/test_sessions_list_run_status.py, backend/openapi.json, frontend/src/components/sessions/__tests__/session-list-panel.test.tsx, frontend/src/components/sessions/session-list-panel.tsx, frontend/src/lib/api-types.ts, sillyhub-daemon/src/api-types.ts
最近确认：未记录
理由：会话列表行首状态原本只靠 daemon 10s 日志活性推导链（用户指出：这是基线不是能力），用户触发会话后转圈/完成提示最长延迟 40s，且该链断（阿里云实测）则列表全空白。而后端 AgentRun 状态本是权威实时信号——发消息瞬间 run=running、等审批=pending_approval、跑完即无活跃 run——且 SSE sessions-changed 管道前端已订阅，run 终态即时触发列表刷新。本变更把 run 状态接到列表：schema 加 current_run_status（非 ORM，router 注入），列表端点照 owner_name/terminating_at 先例 IN 批查注入（窗口函数取每会话 created_at 最新活跃 run）；前端 sessionStatusIndicator 升级为 run 信号第一优先（pending_approval→琥珀、pending/running→转圈，压过活性 working），完成通知新增 run 完成触发源（活跃→null 且非终态且不在该会话上，与终态/活性转移来源共键）。日志活性链原样保留为本地 CLI 会话兜底基线。

## D-daemon-031@v1 2026-10-17-audit-risk-followup——24h 审计六处发现的定点最小侵入修复：①会话载入白名单 VALID_PROVIDERS 从手写 Set 改为 INTERACTIVE_PROVIDERS 注册
状态：implemented
变更：2026-10-17-audit-risk-followup
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-17-audit-risk-followup/design.md
文件：docs/sillyspec/active-pitfalls.md, docs/sillyspec/finished/tick-timing-squash-blindspot.md, frontend/src/components/sessions/__tests__/session-list-panel.test.tsx, frontend/src/components/sessions/session-list-panel.tsx, frontend/src/lib/__tests__/logout-storage.test.ts, frontend/src/lib/logout-storage.ts, sillyhub-daemon/src/interactive/session-store-persistence.ts, sillyhub-daemon/src/interactive/zcode-app-server-driver.ts, sillyhub-daemon/src/spec-sync.ts, sillyhub-daemon/tests/interactive/session-store-persistence.test.ts, sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts, sillyhub-daemon/tests/pull-antiresurrect.test.ts
最近确认：未记录
理由：24h 审计六处发现的定点最小侵入修复：①会话载入白名单 VALID_PROVIDERS 从手写 Set 改为 INTERACTIVE_PROVIDERS 注册表键单源推导（照 session-manager PROVIDER_RELOAD_ENGINES 同款手法），消灭「装配加键、白名单漏改」缺陷类（pi/cursor/dsh+zcode 已三次踩坑）；②run 完成角标判定补 `current === null` 前置条件；③登出清理注册表补 `sillyhub:session-completed-unread:` 前缀；④防复活抑制面计算时机从 getSpecBundle 之前移到 pre_swap 之后——窗口内重建的文件盘面复存即自动退出抑制面，与既有「窗口写入=pre_swap 服务器留底+下跳心跳拉齐」语义一致；⑤zcode consume finally 补齐 codex 同位的槽位清理与兜底 close（h.closing 幂等）；⑥applyResurrectSuppress 补 relative/isAbsolute 包含性校验，越界键跳过并告警。

## D-daemon-032@v1 2026-10-17-dsh-rc2-protocol-fix——本机 dsh 00:17 自动更新至 0.2.0-rc.2 后两处协议断裂致全部 dsh 会话 ready 后 ~3 秒静默终止（今日 9 次 killed 实
状态：implemented
变更：2026-10-17-dsh-rc2-protocol-fix
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-17-dsh-rc2-protocol-fix/design.md
文件：sillyhub-daemon/src/interactive/dsh-acp-driver.ts, sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts
最近确认：未记录
理由：本机 dsh 00:17 自动更新至 0.2.0-rc.2 后两处协议断裂致全部 dsh 会话 ready 后 ~3 秒静默终止（今日 9 次 killed 实证）。修复：① session/new 恒带 `mcpServers:[]`（rc.2 必填，ACP 手动探针双轮验证：缺失=Invalid params、空数组=握手通过）；② set_config_option 改官方 ACP SDK v2 扁平形状 `{sessionId, configId, value}`（读 rc.2 内 @agentclientprotocol/sdk zod.gen 钉板）；③ 模型/档位设置失败降级 warn 非致命——参数随 rc.x 演进时只降级不杀会话；④ 驱动失败路径补里程碑/错误/子进程退出留痕（此前零日志，静默死无法定位）。

## D-daemon-033@v1 2026-10-17-dsh-rc2-routing-restore——dsh-rc2-protocol-fix 后轮次可达但暴露三层：① compat 块被 rc.2 compatProfile 新 schema 静默拒收（整条
状态：implemented
变更：2026-10-17-dsh-rc2-routing-restore
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-17-dsh-rc2-routing-restore/design.md
文件：sillyhub-daemon/src/dsh-settings.ts, sillyhub-daemon/src/interactive/dsh-acp-driver.ts, sillyhub-daemon/tests/dsh-settings.test.ts, sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts
最近确认：未记录
理由：dsh-rc2-protocol-fix 后轮次可达但暴露三层：① compat 块被 rc.2 compatProfile 新 schema 静默拒收（整条 provider 不激活——探针双轮实证带/不带 compat 的模型目录差异）；② 模型 valueId 变 JSON 数组串；③ 通知信封未拆包致回复零落库。修法：writeDshHome 改三件套布局（package.json 模板清单 + workspace + 无 compat patch——catalog 默认值由引擎按 api 协议补齐，compat 留给引擎自带）；驱动模型值组装 `["sillyhub","<model>"]`（DSH_PROVIDER_ID 单源）；通知处理兼容信封拆包。UI 真机终验：模型自答 GLM-5.3-FlashX/智谱，路由完整恢复。

## D-daemon-034@v1 2026-10-17-zcode-provider-config-shape——本变更解决「zcode 会话创建成功但每轮 turn.failed：Select a model before continuing」。
状态：implemented
变更：2026-10-17-zcode-provider-config-shape
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-17-zcode-provider-config-shape/design.md
文件：sillyhub-daemon/src/interactive/zcode-app-server-driver.ts, sillyhub-daemon/src/interactive/zcode-events.ts, sillyhub-daemon/src/zcode-settings.ts, sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts, sillyhub-daemon/tests/interactive/zcode-events.test.ts, sillyhub-daemon/tests/zcode-settings.test.ts
最近确认：未记录
理由：本变更解决「zcode 会话创建成功但每轮 turn.failed：Select a model before continuing」。三重证据（宿主有效 provider_config.json / zcode.cjs bundle 内 `.strict()` schema 与写盘器输出 / daemon.log 三次同错误）钉死两层根因：① `zcode-settings.ts` 把 `providerConfigRules` 写成裸数组，而引擎文件级 schema 要求 `{providerRules:[...]}` 对象包裹（附 `modelConfigRules` 两键），裸数组被引擎静默丢弃 → 注册表无 sillyhub 提供程序；② `_applyModel` 在目录等待超时/精确命中两条路径上 `resolvedModelId` 保持 `undefined`，把 `modelId:undefined` 发给 setModel 必败。修复即改这两处：注入形状对齐引擎写盘器输出；`_applyModel` 以归一化字符串为初值、目录命中时附带引擎自报的 `options.reasoningLevel`（JSON-RPC 对象路径走严格校验，缺 reasoningLevel 即拒——探针 + 真机双实证）。 inject → inputQueue → 驱动消费链路经 dl-out.log 实证无问题（会话 368a0ed6 的 inject 有缓冲有消费、restore 会话 idle 挂 `pulling input` 属正常等待），按用户要求核实后 inject/push 两侧**未加**验证日志。本修复的行为面仅 env 覆盖一处（ZCODE_PERSONAL_PROVIDER_CONFIG_FILE 改指 per-session 文件，已入文件变更清单）+ 驱动侧诊断日志若干（spawn env keys / step 标记 / 目录快照 warn——真机排障面，随本变更提交入档）。

## D-daemon-035@v1 2026-10-19-host-settings-reload-latency——单点参数收窄 + 一行文档修正：`host-settings-watcher.ts` 的默认轮询节拍由 3000ms 改为 1000ms，并把该默认值升为**单
状态：implemented
变更：2026-10-19-host-settings-reload-latency
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-19-host-settings-reload-latency/design.md
文件：.zcode/skills/sillyhub-docker-deploy/SKILL.md, docs/releases/2026-10-19-012-0a0e9c76.md, sillyhub-daemon/src/interactive/host-settings-watcher.ts, sillyhub-daemon/src/interactive/session-manager/types.ts, sillyhub-daemon/tests/interactive/host-settings-watcher.test.ts
最近确认：未记录
理由：单点参数收窄 + 一行文档修正：`host-settings-watcher.ts` 的默认轮询节拍由 3000ms 改为 1000ms，并把该默认值升为**单一源导出常量** `HOST_SETTINGS_POLL_INTERVAL_MS`（供守护测试 断言，避免魔数漂移）；两拍一致去抖、env 块指纹、容错语义**逐字不变**——延迟收益全部来自 节拍收窄（去抖窗口 6s→2s，端到端 4-6s→2-4s）。`pollIntervalMs` 注入覆盖口径不变（测试仍 用 15ms）。另将 deploy 技能文档里 `curl -fsSI /daemon/latest/sillyhub-daemon.js`（实测 HEAD 405，端点仅允许 GET）改为 GET 口径 `-o /dev/null -w '%{http_code} %{content_type}'`， 与端点真实行为一致。 不选「去抖降为单拍」：半写/原子替换容忍是上一变更的显式取舍，单拍会把瞬时态当变化触发 批量重载——语义回退，否决。不选「fs.watch 事件式」：同上一变更死路 2（Windows 替换写掉 watch），否决理由不变。

## D-daemon-036@v1 2026-10-20-codex-requires-openai-auth——改 `sillyhub-daemon/src/codex-settings.ts` 单点：`CodexFormValues` 增 `requireOpenAiA
状态：implemented
变更：2026-10-20-codex-requires-openai-auth
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-20-codex-requires-openai-auth/design.md
文件：docs/releases/2026-10-20-003-50dfdf2.md, frontend/src/components/agent-log/__tests__/run-error-item.test.tsx, frontend/src/components/agent-log/run-error-item.tsx, frontend/src/components/daemon/session-panel/page-helpers.tsx, frontend/src/components/daemon/session-panel/session-panel-page.tsx, sillyhub-daemon/src/codex-settings.ts, sillyhub-daemon/tests/codex-settings.test.ts, sillyhub-daemon/tests/provider-injection-smoke.integ.test.ts
最近确认：未记录
理由：改 `sillyhub-daemon/src/codex-settings.ts` 单点：`CodexFormValues` 增 `requireOpenAiAuth` 布尔（anthropic 分支 = api_key 非空；openai_chat 分支恒 false），`mergeConfigToml` 在 `wire_api` 行后按该布尔追加 `requires_openai_auth = true`。机理：codex CLI 对自定义 `[model_providers.*]` provider 默认不发 Authorization——auth.json 的 OPENAI_API_KEY 只有在 provider 表声明 `requires_openai_auth = true` 时才作为 Bearer 头发出（cc-switch 生产配置带此键 + 本机 A/B 实验 2026-10-20 双重证实：同 key 同端点 `/api/v1`，带键成功、缺键稳定断流）。平台 daemon 写盘器漏写该键，导致所有直连 codex 供应商的 key 从未随请求发出、上游掐流。 选 daemon 写盘器单点修复而非替代方案（openai_chat/litellm 代理通道或要求用户逐会话手改 CODEX_HOME）：前者模型选择退化为路由键且多两跳、后者无配置面且每会话被重写覆盖；单点一行 + 显式形态布尔是最小且语义准确的治本面。

## D-daemon-037@v1 2026-10-20-session-status-live-sync——问题机制（已实证）：右侧会话面板是逐会话 SSE 推送，run 状态秒级到达；左侧列表依赖 react-query 条件轮询（有活跃会话 10s / 全静默 3
状态：implemented
变更：2026-10-20-session-status-live-sync
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-20-session-status-live-sync/design.md
文件：backend/app/modules/agent/coordinator.py, backend/app/modules/agent/tests/test_coordinator_approval_signal.py, backend/app/modules/daemon/run_sync/service/close_run_steps.py, backend/app/modules/daemon/run_sync/service/publish.py, backend/app/modules/daemon/run_sync/service/submit_commit.py, backend/app/modules/daemon/run_sync/service/submit_steps.py, backend/app/modules/daemon/session/service/inject.py, backend/app/modules/daemon/tests/test_close_interactive_run_session_status.py, backend/app/modules/daemon/tests/test_session_events_cross.py, backend/app/modules/daemon/tests/test_session_list_live_signal.py, backend/app/modules/daemon/tests/test_submit_messages_no_overwrite_terminal.py, frontend/src/components/daemon/__tests__/session-panel-approval-list-refresh.test.tsx, frontend/src/components/daemon/session-panel/session-panel-page.tsx
最近确认：未记录
理由：问题机制（已实证）：右侧会话面板是逐会话 SSE 推送，run 状态秒级到达；左侧列表依赖 react-query 条件轮询（有活跃会话 10s / 全静默 30s）+ `agent_sessions:changed` 哑信号（SSE 触发 400ms 去抖失效列表查询）。但后端 `publish_sessions_changed` 只覆盖会话生命周期事件（创建/终态翻转/sweep/lease kill/子会话），run 级状态迁移全部不发布——左侧徽标的第一优先信号源 `current_run_status`（列表端点按最新活跃 run 窗口注入，session_crud.py:264-303）恰来自这些 run 状态，导致右侧已执行/已等审批而左侧最长 10~30s 不动。 方案：不新增任何前端基建，在 5 个 run 状态迁移点补发既有哑信号 `publish_sessions_changed("status_changed", session_id, session_user_id)`（前端 `subscribeAgentSessionsEvents` 的 onmessage 不解析 payload，任何信号都触发列表失效，零改动受益）；另在右侧 `onPermissionRequest` 处理器加一行本地兜底 `onSessionListRefresh?.()`（审批等待是用户可操作状态，即时性最敏感）。信号是哑信号（只触发 refetch，不携带状态数据），多发/迟到/乱序均无害——最终一致以 DB 查询结果为准。

## D-daemon-038@v1 2026-10-21-daemon-sync-hardening——背景：2026-10-21 腾讯云会话实测 daemon 宿主冻结约 5 分钟——`_wsLoop` 每秒轮询、假活阈值 120s，理论上 11:02:56 即
状态：implemented
变更：2026-10-21-daemon-sync-hardening
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-21-daemon-sync-hardening/design.md
文件：sillyhub-daemon/src/daemon.ts, sillyhub-daemon/src/event-loop-watch.ts, sillyhub-daemon/src/hub-client.ts, sillyhub-daemon/src/sillyspec-manager.ts, sillyhub-daemon/src/spec-sync.ts, sillyhub-daemon/tests/event-loop-watch.test.ts, sillyhub-daemon/tests/hub-client-fetch-timeout-surface.test.ts, sillyhub-daemon/tests/sillyspec-status-collect-guards.test.ts, sillyhub-daemon/tests/spec-sync-off-switch.test.ts
最近确认：未记录
理由：背景：2026-10-21 腾讯云会话实测 daemon 宿主冻结约 5 分钟——`_wsLoop` 每秒轮询、假活阈值 120s，理论上 11:02:56 即应回收，实际 11:07:23 才发生，且 daemon 日志 6 分钟零输出，事件循环整体停摆却无任何本端观测面；同日另有两类长期噪音：某登记根每分钟 `sillyspec progress show` exit 2 刷屏（CLI uninit 门对跨仓子目录必拒）、`/mnt/e` drvfs 慢盘 30s 超时；再叠加 runbook（docs/sillyspec/finished/spec-push-conflict-recovery-runbook.md）钉死的历史根因——daemon 自动同步与 CLI `sillyspec platform sync` 双写者致 SpecPushConflict 反复。用户拍板：平台侧加固、单写者优先 CLI。 方案按四个独立小步落地，全部收敛在 sillyhub-daemon 包内： 1. **FR-01 关闭开关**：守在 `postSpecSync` 包装器（daemon 侧 interactive `syncSpecTreeIfNeeded` 与 task-runner 批量两条推送路径的唯一汇聚点）入口。机器级 env `SILLYHUB_DAEMON_SPEC_SYNC_OFF` + 工作区级 flag 文件 `~/.sillyhub/daemon/spec-sync-off/{wsId}.flag`（置于 daemonStateDir 下 specs/ 旁，pull 整树交换不触及，永不丢）。命中即返回 null——调用方既有 null 分支（mock 容错）天然 no-op，零调用方改动；pending_push 不动（关闭非传输失败）；knowledge hits 上行独立于 manifest，照常执行。 2. **FR-02 超时 env 化**：constructor 回退链 `deps.statusTimeoutMs ?? parseStatusTimeoutMsEnv(env) ?? 30_000`，deps 优先保住既有测试注入面。 3. **FR-03 退避 + FR-04 crossrepo 跳过**：都在 `collectStatusOnce`/`_collectOneTarget` 内。退避用「per-target 连败计数 + 全局轮次取模」纯函数判定（避免多定时器生命周期复杂度）；crossrepo 用 `existsSync(<cwd>/.git/sillyspec-crossrepo.json)` 前置守卫 + 一次性 info 指路（标记格式读自 sillyspec CLI local-register.js 实锤：`{workspace, key, registeredAt}`）。 4. **FR-05 超时补口 + FR-06 lag 监控**：hub-client 全量 fetch 已带 AbortSignal.timeout（DEFAULT 30s / SPEC_SYNC 300s / BUNDLE 120s），唯一缺口 fetchMcpWhitelist 补 DEFAULT；新增 `event-loop-watch.ts` 以 `perf_hooks.monitorEventLoopDelay` 采样，作为第六循环挂 `_fire` 统一 abort 生命周期——宿主冻结类事故自此有 warn 证据点。

## D-daemon-039@v1 2026-10-21-daemon-zombie-turn——根因（生产会话 49d893ab 实证）：用户打断 → SDK 进入 abort 收尾窗口 → backend 在 0.6s 后自动注入（后台任务通知唤醒链）→
状态：implemented
变更：2026-10-21-daemon-zombie-turn
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-21-daemon-zombie-turn/design.md
文件：backend/app/core/config.py, backend/app/modules/daemon/session/service/control.py, backend/app/modules/daemon/sweep.py, backend/app/modules/daemon/tests/test_interrupt_payload_run_id.py, backend/app/modules/daemon/tests/test_pending_run_start_sweep.py, frontend/src/components/daemon/session-panel/__tests__/interrupt-timeout.test.ts, frontend/src/components/daemon/session-panel/interrupt-timeout.ts, frontend/src/components/daemon/session-panel/session-panel-page.tsx, sillyhub-daemon/src/cli.ts, sillyhub-daemon/src/daemon.ts, sillyhub-daemon/src/interactive/session-manager.ts, sillyhub-daemon/src/interactive/session-manager/events.ts, sillyhub-daemon/src/interactive/session-manager/lifecycle.ts, sillyhub-daemon/src/interactive/session-manager/turn-control.ts, sillyhub-daemon/src/interactive/session-manager/types.ts, sillyhub-daemon/src/interactive/types.ts, sillyhub-daemon/tests/daemon-interrupt-noop-report.test.ts, sillyhub-daemon/tests/interactive/session-manager-lifecycle-turn-anchor-eviction.test.ts, sillyhub-daemon/tests/interactive/turn-start-watchdog.test.ts
最近确认：未记录
理由：根因（生产会话 49d893ab 实证）：用户打断 → SDK 进入 abort 收尾窗口 → backend 在 0.6s 后自动注入（后台任务通知唤醒链）→ daemon `inject()` 正常 push 进 SDK 输入流、置 status='running' + currentRunId 并 ack 控制指令 → 但 SDK 在 abort 收尾中把该输入吞掉（无新轮、无事件、无 result）→ daemon 永停 running、backend run 永停 pending（无 started_at）。用户后续打断在 daemon 侧走 `q.interrupt()`（live query 无轮可断）返回 true 空转，10 次 acked 全部无效；最终靠 daemon 掉线被 offline sweep 收敛。四层修复各挡一段： 1. **FR-01 daemon 轮启动看门狗**（近端，90s 级收敛）：session-manager 在 inject 首轮启动路径（`!wasRunningBeforeInject`）布防 per-session 看门狗；任意轮事件（onMessage/onResult）撤防；到点仍零事件且 status=running & currentRunId 未变 → 重置会话态为 active（**保留 currentRunId 作迟到结果归属锚**——假阳性时迟到 result 落到已被收敛为 failed 的旧轮上走 close_interactive_run 终态幂等，不被误记到用户重发后的新轮；下次 inject 无条件覆盖）+ 经新增可选回调 `deps.onTurnStartTimeout` 由 daemon 桥接 `notifyRunResult(status='turn_start_timeout', is_error=true, result_summary=中文原因)` → backend `close_interactive_run` 既有路径收敛 run failed（`interactive_failed`）+ SSE 终态事件 → 前端显示失败与原因。选「拒绝+回报」而非自动重推：重推在「轮其实已启动但事件慢」的假阳性下会双执行同一条消息，失败重发由用户触发更安全。 2. **FR-02 interrupt no-op 回传**（秒级，打断即收敛）：backend `_send_interrupt_control` payload 补 run_id；daemon SESSION_INTERRUPT handler 消费 `interrupt()` 布尔结果，false 且会话在 store（能判定「无轮」而非「等会话」）且 payload 带 run_id → `notifyRunResult(status='error_during_execution')` → backend failed+`interactive_interrupted` → 前端按既有映射显示「已中止」。复用 `_reportInjectDropped` 同款 notifyRunResult 手法，零新端点。 3. **FR-03 backend pending run 启动超时清扫**（兜底，300s 级）：sweep.py 新增 `pending_run_start_sweep_once` 挂进既有 `session_reconnect_sweeper` 轮（60s 周期），收敛「pending + 无 started_at + 超龄 N（Settings `daemon_pending_run_start_timeout_sec`，默认 300）+ runtime 在线」的 run 为 failed+`interactive_turn_not_started`+可读原因，commit 后复刻 close_run_steps 终态 SSE 发布。runtime 离线的归既有 offline sweep，pending_approval（审批等待）不扫。 4. **FR-04 前端 15s 超时回退**（UX 兜底）：handleInterrupt 布防 15s 定时器（ref 管理），到点该轮仍 interrupting → 回退 running + 提示；终态到达/卸载清定时器。

## D-daemon-040@v1 2026-10-21-gitlog-conflict-quotepath——答：收编上变更（2026-10-21-gitlog-quotepath-fix）评审 P3-2 的同根因遗留：gitMerge 冲突链路 `_listConfl
状态：implemented
变更：2026-10-21-gitlog-conflict-quotepath
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-21-gitlog-conflict-quotepath/design.md
文件：sillyhub-daemon/src/host-fs-handler.ts, sillyhub-daemon/tests/host-fs-handler-git-log-quotepath.test.ts, sillyhub-daemon/tests/host-fs-handler-worktree.test.ts
最近确认：未记录
理由：答：收编上变更（2026-10-21-gitlog-quotepath-fix）评审 P3-2 的同根因遗留：gitMerge 冲突链路 `_listConflictFiles`（host-fs-handler.ts）跑 `git diff --name-only --diff-filter=U` 未关 `core.quotepath`，中文等非 ASCII 冲突文件名以 C 引号转义形态进入 `conflicts[].file`，且后续 `pathResolve(workdir, file)` + readFile 以转义串找文件必失配 → `_countConflictMarkers` 落 catch 归 0，backend 收到「零标记冲突」误导主代理解题。修法与上变更同款、复用其已落地的 `GIT_QUOTEPATH_OFF_ARGS` 常量与 `decodeGitCQuote` 纯函数：冲突列举调用插入参数 + 逐行解码；`gitMerge` 自身 `merge --no-ff` 的 stdout 不做路径解析（错误文案透传），保持最小面不加参。

## D-daemon-041@v1 2026-10-21-gitlog-quotepath-fix——答：根因是 daemon 五个平名 git 方法执行 `git` 时未关 `core.quotepath`，git 默认把含非 ASCII 字节的路径以 C 引
状态：implemented
变更：2026-10-21-gitlog-quotepath-fix
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-21-gitlog-quotepath-fix/design.md
文件：frontend/src/components/git-log/__tests__/file-tree.test.tsx, sillyhub-daemon/src/host-fs-handler.ts, sillyhub-daemon/tests/host-fs-handler-git-log-quotepath.test.ts, sillyhub-daemon/tests/host-fs-handler-git-log.test.ts
最近确认：未记录
理由：答：根因是 daemon 五个平名 git 方法执行 `git` 时未关 `core.quotepath`，git 默认把含非 ASCII 字节的路径以 C 引号形态（`"…\345\257\274…"`）输出；该形态经 numstat 解析（`host-fs-handler.ts` gitShow 的 `m[3]` 原样透传，:247 注释明示「保持 git C 引号形态」）→ backend 转发 → 前端 buildFileTree 按 `/` 拆分——引号挂在首尾段、目录名显示八进制转义；前端点击叶子又把带引号转义串当 pathspec 回传 gitDiffFile，git 匹配不到真实路径 → exit 0 空输出 → 前端「（无差异内容）」。修复两层、均在 daemon（backend/frontend 为透传层零改动）：① 命令层——gitShow/gitDiffFile 的 `git show`、gitStatus 的 `status --porcelain=v2` 与 `diff --numstat` 四条会显示路径的调用统一插入 `-c core.quotepath=false`（per-invocation，不污染宿主全局/仓配置；`git remote`/`git fetch` 不显示路径不动）；② 解析层——新增导出纯函数 `decodeGitCQuote`，按 git C 引号规则解码 numstat 路径（八进制 `\NNN` 还原字节后按 UTF-8 组装、`\"`/`\\`/`\a\b\f\n\r\t\v` 标准转义、非引号与畸形形态原样返回），兜住 `quotepath=false` 下 git 对字面 `"`/`\`/控制字符仍强制引号的残余面。选此方案而非 `--numstat -z`：见「风险与死路」死路①。

## D-daemon-042@v1 2026-10-21-session-git-branch——现状缺口：工作区会话页顶部 `GitStatusBar` 查的是 **workspace 根目录** 的 git 状态（`GET /api/workspaces
状态：implemented
变更：2026-10-21-session-git-branch
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-21-session-git-branch/design.md
文件：backend/app/modules/daemon/router/__init__.py, backend/app/modules/daemon/router/session_crud.py, backend/app/modules/daemon/schema.py, backend/app/modules/daemon/session/service/git_status.py, backend/openapi.json, backend/tests/modules/daemon/test_session_git_status.py, frontend/src/components/sessions/__tests__/session-config-bar.test.tsx, frontend/src/components/sessions/session-config-bar.tsx, frontend/src/lib/api-types.ts, frontend/src/lib/daemon/sessions.ts, sillyhub-daemon/src/api-types.ts
最近确认：未记录
理由：现状缺口：工作区会话页顶部 `GitStatusBar` 查的是 **workspace 根目录** 的 git 状态（`GET /api/workspaces/{wid}/git-log/status`，staleTime 60s、无轮询），既不是会话所在 worktree 的分支，也不保证动态。而 `AgentSession.cwd`（SessionManager working dir）在 DB 里有值却不透出，也没有任何端点能按 session 维度查 git。 方案：新增**会话级只读端点** `GET /api/daemon/sessions/{session_id}/git-status`——backend 取该会话（复用 `get_agent_session` 属主校验），解析查询根（`session.cwd` 优先，过 `resolve_root_path_for_daemon` 做 container→host 改写；cwd 空则回退 `session.workspace_id` 的成员绑定根），经既有平名 RPC `git_status`（`ws_hub.send_rpc`，照 `git_log/service.py:_send_git_rpc` 直连模式，30s 超时）在 daemon 宿主上现场执行——每次请求都是实时查询，天然满足「动态、非快照」。daemon `git_status` 内建 fetch 降级（no_remote/fetch_failed/fetch_timeout 不阻断分支采集），分支/脏文件一次拿全，无需新增 daemon 方法、零 daemon 契约变更。 前端：`SessionConfigBar`「智能体档案」控件后新增只读分支指示项（lucide `GitBranch` 图标 + 分支名，Tooltip 展示 root/dirty 概要），组件内 `useQuery(["sessionGitStatus", sessionId])` 自取数（照思考级别控件先例，页面只传 sessionId 已有 prop），`refetchInterval=60_000`（React Query 默认后台标签页不轮询）+ 窗口聚焦 refetch。空态（no_root/no_git）不渲染；查询失败渲染占位「⎇ —」不阻塞其余控件；mobile 与档案控件同收纳。

## D-daemon-043@v1 2026-10-21-spec-conflict-autoheal——用户拍板「以本地为准」且要求**部署即生效、零手工动作**——现行 `SpecPushConflict` 是人工拍板语义（删 manifest / `resol
状态：implemented
变更：2026-10-21-spec-conflict-autoheal
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-21-spec-conflict-autoheal/design.md
文件：sillyhub-daemon/src/event-loop-watch.ts, sillyhub-daemon/src/spec-sync.ts, sillyhub-daemon/tests/event-loop-watch.test.ts, sillyhub-daemon/tests/spec-sync-conflict-autoheal.test.ts, sillyhub-daemon/tests/spec-sync-off-switch.test.ts
最近确认：未记录
理由：用户拍板「以本地为准」且要求**部署即生效、零手工动作**——现行 `SpecPushConflict` 是人工拍板语义（删 manifest / `resolve --keep-local`），把运维动作留给了用户，违背此诉求。本变更把拍板结论代码化：在 `postSpecSync` 包装器（daemon 侧推送唯一汇聚点，2026-10-21-daemon-sync-hardening 已在此设开关）捕获 `SpecPushConflict`，同一工作区**连续 2 次**冲突（impl 内 rebase 恰好一次重试已失败，第二次即真分叉）→ 自动备份并删除本地 manifest 缓存 → 递归重入推送（无缓存自动走全量 tar，无乐观锁，本地为准覆盖服务端）→ 冲突消解，全程零人工。env `SILLYHUB_DAEMON_CONFLICT_AUTOHEAL=0` 可关（默认开）。这是对 spec-sync.ts 内 NFR-02「conflict 后不自动覆盖」设计语义的显式修订——依据用户 2026-10-21 会话原话（B 本地为准 + 部署后就能好），复潮条件成立，记入本变更 decisions D-001。随包修掉上变更收口评审的两条 P3：① `runEventLoopWatch` 的 defaultSleep abort 退出改为循环内优雅 break（不再被 `_fire` 误记 `loop_crashed`）；② off 开关命中日志标明来源（env/flag），`isDaemonSpecSyncOff` 返回值从 boolean 细化为 `'env'|'flag'|null`。

## D-daemon-044@v1 2026-10-21-task-wakeup-restore——答：从 f889832d1^ 原样恢复 2026-10-13-task-wakeup-remove 删除的 daemon 侧唤醒链（scheduleTaskWa
状态：implemented
变更：2026-10-21-task-wakeup-restore
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-21-task-wakeup-restore/design.md
文件：frontend/src/components/__tests__/change-file-tree-autorefresh.test.tsx, frontend/src/components/change-file-tree.tsx, frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx, frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx, frontend/src/components/daemon/runtime-session-helpers.tsx, frontend/src/components/daemon/session-log-assembler.ts, frontend/src/components/daemon/session-panel/session-panel-page.tsx, frontend/src/components/daemon/turn-segment-views.tsx, frontend/src/components/daemon/turn-status-bar.tsx, frontend/src/components/daemon/turn-timeline.tsx, sillyhub-daemon/src/cli.ts, sillyhub-daemon/src/daemon.ts, sillyhub-daemon/src/interactive/session-manager.ts, sillyhub-daemon/src/interactive/session-manager/background-tasks.ts, sillyhub-daemon/src/interactive/session-manager/lifecycle.ts, sillyhub-daemon/src/interactive/session-manager/types.ts, sillyhub-daemon/src/interactive/types.ts, sillyhub-daemon/tests/interactive/session-manager-lifecycle-turn-anchor-eviction.test.ts, sillyhub-daemon/tests/interactive/task-lifecycle.test.ts
最近确认：未记录
理由：答：从 f889832d1^ 原样恢复 2026-10-13-task-wakeup-remove 删除的 daemon 侧唤醒链（scheduleTaskWakeup 2s debounce 合并 + handleTaskNotificationEvent 尾部触发块 + onTaskWakeupInject dep + cli.ts 接线 + lifecycle.ts 终态清理 + _taskWakeupPending 状态面），backend 侧零改动（inject 端点/task_wakeup 门控/queue_when_busy 排队/hubClient.injectSessionPrompt 四件均已核实存活）。唯一新造点：60s 静默阈值从硬编码常量改为 env getter `taskWakeupQuietThresholdMs()`（SILLYHUB_TASK_WAKEUP_QUIET_MS，缺省 60000，0=关闭阀，负数/非法回落缺省，逐次读取便于测试覆写）——沿 daemon 既有 SILLYHUB_INJECT_WAIT_SESSION_MS 同款模式（daemon.ts:1386 先例），替代原案中的 local.yaml 载体：阈值守卫的是 daemon 进程行为噪音，属部署级而非工作区级偏好，env 载体与本仓既有 feature-flag 面一致且零文件格式决策。 选生产者侧恢复而非让引擎自续跑：claude SDK 流式驱动下轮只能由 daemon 推消息开轮（sdk.d.ts streamInput 契约），引擎无头模式不自带唤醒（49d893ab 导出实证通知到达后引擎零动作）；平台侧唤醒必须过 backend inject 建正式 run（2026-09-15 权限锁死事故实证跨轮后台工作越过治理面的代价）。pi 影子任务走 kind=agent_task_status 另一条分发（events.ts:408→handleAgentTaskStatusEvent），唤醒仅在 task_notification 处理器（events.ts:426→handleTaskNotificationEvent），路由结构上排除「pi 轮结束→注入」反馈环。

## D-daemon-045@v1 2026-10-22-merge-regression-fixes——两类残留逐笔最小修：① daemon/grants 测试的 selected-metadata 建表闭包按姊妹范式（workspace/member_runti
状态：implemented
变更：2026-10-22-merge-regression-fixes
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-22-merge-regression-fixes/design.md
文件：backend/app/modules/daemon/grants/tests/conftest.py, backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py
最近确认：未记录
理由：两类残留逐笔最小修：① daemon/grants 测试的 selected-metadata 建表闭包按姊妹范式（workspace/member_runtimes/tests/conftest.py）补全——users 新增默认档案外键后，闭包必须纳入 agent_profiles 及其 FK 目标 workspaces/llm_providers/tool_policies，并补相应模型 import 保证注册；② test_init_claim_tokens 两降级用例的 structlog 警告断言由只看 stdout 改为 captured.out+err 双流合并——断言意图（事件名+原因枚举在渲染输出中）不变，只解除对具体流的脆弱假设。选最小改动的理由：生产逻辑已被证明正确（Captured stderr 中事件完整、grants 建表失败发生在测试 fixture 组装期），债的载体是测试夹具与断言面。

## D-daemon-046@v1 2026-10-22-review-risk-fixes——修复 2026-10-22 只读审查确认的四处缺口，方案均为最小修： 1. **原型路由防线（FR-01/FR-02）**：`/proto/session-re
状态：implemented
变更：2026-10-22-review-risk-fixes
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-22-review-risk-fixes/design.md
文件：frontend/.dockerignore, frontend/src/app/proto/session-redesign/page.tsx, sillyhub-daemon/src/event-loop-watch.ts, sillyhub-daemon/src/host-fs-handler.ts, sillyhub-daemon/tests/event-loop-watch.test.ts, sillyhub-daemon/tests/host-fs-handler-git-log.test.ts
最近确认：未记录
理由：修复 2026-10-22 只读审查确认的四处缺口，方案均为最小修： 1. **原型路由防线（FR-01/FR-02）**：`/proto/session-redesign/page.tsx` 补 `export const dynamic = "force-dynamic"`（同目录 `session-trajectory/page.tsx:24` 同款先例）——Next 14.2.5 App Router 下无动态 API 的 Server Component 页默认构建期静态预渲染，会在 `next build` 时执行 `loadStagedSessionExport()`（readFileSync `.proto-staging/session-export.json`，3.3MB 真实会话导出）并把内容烘进预渲染产物；改声明后读盘只在请求时发生（该文件头注自述口径本就是 force-dynamic，代码补齐声明）。纵深第二层：`frontend/.dockerignore` 追加 `/.proto-staging/` 与 `/public/__proto*/`（与 frontend/.gitignore 防线对齐）——现状 dockerignore 未排除该目录而 Dockerfile builder `COPY . .`，从工作树构建镜像即把真实数据带进构建上下文；**gitignore ≠ dockerignore**，两层独立生效（声明层挡预渲染、上下文层挡拷入，任一在位即无数据外泄）。 2. **监听器慢性泄漏（FR-03）**：`event-loop-watch.ts` 的 `defaultSleep` 在 setTimeout 正常到期回调里 `signal.removeEventListener('abort', onAbort)`——现状 `{once:true}` 只在 abort 触发后自摘，正常路径每 60s 窗口在 daemon 生命周期 signal 上滞留一个监听器+闭包（Node AbortSignal 为 EventTarget，无 MaxListeners 告警，静默累积；本机 Node 24 实证无告警）。 3. **解码截断（FR-04）**：`decodeGitCQuote` 字面字符分支由 `bytes.push(inner.charCodeAt(i))` 改为按 codePoint 取 UTF-8 原字节入列（`String.fromCodePoint(cp)` → `Buffer` 展开，代理对一次消费两个 code unit）——现状 charCode>0xFF 经 `Buffer.from(bytes)` 截断为低字节，`quotepath=false` 下 git 只对含字面 `"`/`\`/控制符的路径强制 C 引号、其余非 ASCII 原样输出，「引号+中文」混合路径解码成乱码。纯八进制转义/非引号/畸形形态路径不动。

## D-daemon-047@v1 2026-10-23-live-turn-meta-time——根因两层：① 数据层——`session-panel/page-helpers.tsx` `enrichDisplayTurns` 的 `replyAt: t.
状态：implemented
变更：2026-10-23-live-turn-meta-time
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-23-live-turn-meta-time/design.md
文件：backend/app/modules/daemon/model.py, backend/app/modules/daemon/router/heartbeat.py, backend/app/modules/daemon/router/version.py, backend/app/modules/daemon/runtime/service.py, backend/app/modules/daemon/service.py, backend/app/modules/daemon/session/network_context.py, backend/migrations/versions/20261023090000_add_daemon_instances_network_info.py, backend/tests/modules/daemon/test_network_context.py, backend/tests/test_align_platform_change_events_migration.py, frontend/src/components/chat/round-divider.tsx, frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx, frontend/src/components/daemon/__tests__/turn-time-display.test.tsx, frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx, frontend/src/components/daemon/file-changes/__tests__/file-changes-card.test.tsx, frontend/src/components/daemon/file-changes/__tests__/turn-file-diff-dialog.test.tsx, frontend/src/components/daemon/file-changes/file-changes-card.tsx, frontend/src/components/daemon/file-changes/turn-file-diff-dialog.tsx, frontend/src/components/daemon/turn-timeline.tsx
最近确认：未记录
理由：根因两层：① 数据层——`session-panel/page-helpers.tsx` `enrichDisplayTurns` 的 `replyAt: t.replyAt ?? meta.finished_at ?? meta.started_at` 对运行中 run（finished_at=null）把 started_at 伪造成「答复完成时间」；② 渲染层——`turn-timeline.tsx` TurnRow 的 `metaDetail` 只认 replyAt，拿到伪造值就渲染「开始 X · 结束 X(=同一时刻) · 历时 00:00」。修复对应两层：数据层对活跃 run 保持 replyAt=null（对齐字段注释「运行中 null 不显示」与排序函数「运行中无 replyAt → Infinity 排末尾」的既有设计意图）；渲染层 metaDetail 增加 isLiveTurn 优先分支——「开始 HH:MM:SS · 历时 mm:ss(实时)」，历时由新小组件 TurnLiveElapsedText 每秒局部 tick（复刻 TurnStatusBar 渲染经济模式，tick 不外溢父级），终态后组件卸载清 interval、恢复既有三段。

## D-daemon-048@v1 2026-10-23-review-risk-fixes-2——四处独立小修，均为 2026-10-23 只读审查的遗留发现，互不依赖： 1. **sillyhub-daemon 探针淘汰竞态**（`sillyspec-ma
状态：implemented
变更：2026-10-23-review-risk-fixes-2
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-23-review-risk-fixes-2/design.md
文件：frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx, frontend/src/components/daemon/file-changes/__tests__/turn-file-diff.test.ts, frontend/src/components/daemon/file-changes/turn-file-diff.ts, frontend/src/components/daemon/turn-live-marquee.tsx, frontend/src/lib/__tests__/thinking-translate.test.ts, frontend/src/lib/thinking-translate.ts, sillyhub-daemon/src/interactive/session-manager.ts, sillyhub-daemon/src/interactive/turn-file-changes-types.ts, sillyhub-daemon/src/interactive/turn-file-changes.ts, sillyhub-daemon/src/sillyspec-manager.ts, sillyhub-daemon/tests/interactive/turn-file-changes.test.ts, sillyhub-daemon/tests/sillyspec-manager.test.ts
最近确认：未记录
理由：四处独立小修，均为 2026-10-23 只读审查的遗留发现，互不依赖： 1. **sillyhub-daemon 探针淘汰竞态**（`sillyspec-manager.ts`）：`_evictedCwds` 由 `Set<rootPath>` 改 `Map<rootPath, 被淘汰 workspaceId>`——skip 判定从「裸根封禁」收紧为「根+工作区双键命中」，陈旧探针在重 claim 之后落地的淘汰条目只封发起淘汰的旧工作区，同根新 wsId 照常采集（不再永久静默停摆）；skip 命中加一次性 warn（镜像既有 `_crossrepoSkipLogged` 先例），`clearStatusProbeEviction` 同步清 warn 标记。daemon.ts 侧守卫（2356 行异根判断）无需改动。 2. **跑马灯 rAF 空转**（`turn-live-marquee.tsx`）：滚动循环改 `ensureScroll`/`stopScroll` 双入口——`step` 只在仍在追（distance>0.5）时续排下一帧，追平即停排置空 rafRef；`applyTarget`（entries 变化 / ResizeObserver 的唯一目标更新入口）尾部与「恢复可见」处调 `ensureScroll` 重启。不可见暂停、reduced-motion 静态、卸载清理语义全保留。 3. **文件快照 diff 阶段吞错**（`turn-file-changes.ts` + `turn-file-changes-types.ts` + `session-manager.ts`）：`CollectTurnFileChangesInput` 新增可选 `onGitDiagnostic` 回调，diff 两阶段 catch 的非 timeout 分支回调 `{stage, reason, message}`；session-manager 接线 `console.warn('[session-manager] turn_file_changes_git_degraded', …)`（该文件既有日志约定）。快照契约零变化——`TurnFileChangesReason` 是 types 注释明令**冻结的固定枚举（禁新增值，错误按事件命名）**，故错误走日志而非快照 reason。 4. **翻译前端脏响应体悬挂**（`thinking-translate.ts`）：`requestBatch` 把 fetch 后的响应处理（engine_ready 判定/items 解构/回填）并入 try 域——2xx 脏响应体（safeJsonParse 得 null / items 缺失）的 TypeError 按「网络失败同款降级」处理（本批回退原文 + 60s 退避），Promise 必 settle，`inflight` Map 不再泄漏。

## D-daemon-049@v1 2026-10-23-session-input-clear-fix——三类症状一个共同根因 + 一个产品语义修正： 1. **发送后不立即消失**：`onSendSettled`（session-panel-page.tsx）/
状态：implemented
变更：2026-10-23-session-input-clear-fix
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-23-session-input-clear-fix/design.md
文件：backend/app/modules/agent/model.py, backend/app/modules/daemon/router/session_crud.py, backend/app/modules/daemon/service.py, backend/app/modules/daemon/session/network_context.py, backend/app/modules/daemon/session/service/__init__.py, backend/app/modules/daemon/session/service/control.py, backend/app/modules/daemon/session/service/create.py, backend/app/modules/daemon/session/service/inject.py, backend/app/modules/daemon/session/service/queue.py, backend/migrations/versions/20261023090100_add_queued_messages_network_context.py, backend/tests/modules/daemon/test_network_context.py, backend/tests/test_align_platform_change_events_migration.py, frontend/src/components/daemon/__tests__/session-panel-draft-scope.test.tsx, frontend/src/components/daemon/session-panel/session-panel-page.tsx, frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx, frontend/src/components/group-chat/group-chat-panel.tsx, frontend/src/components/sessions/__tests__/sessions-portal.test.tsx, frontend/src/components/sessions/sessions-portal.tsx
最近确认：未记录
理由：三类症状一个共同根因 + 一个产品语义修正： 1. **发送后不立即消失**：`onSendSettled`（session-panel-page.tsx）/ `performSend`（group-chat-panel.tsx）/ `handlePreSessionSend` 均为「HTTP 响应成功后才清输入」。改为**受理即清**：handleSend 守卫全部通过后同步 `setInput("")`，附件 chips 与 mentions 维持原时序（响应成功后清）——失败路径附件天然保留可重试，文本恢复走 catch 分支。 2. **发送在途/成功瞬间切换会话后草稿残留**：清空链路原为 `setInput("") → 写草稿 effect → writeSessionDraft`，组件因 key 切换卸载时 effect 不执行，localStorage 草稿键保留已发送文本（预会话 `__pre__:scope` 键残留 → 下次新建回读显示；真会话键残留 → 切回显示）。修复：发送受理点**直接同步调 `writeSessionDraft(sessionId, "", preDraftScope)`** 清键，不依赖组件存活；失败恢复时写回原文。 3. **「新建会话显示旧内容」**：①预会话草稿残留由上述 2 解决；②未发送草稿跨「重新新建」回读是刻意的草稿特性，但与「新建=全新开始」的用户预期冲突——改为**预会话挂载不回读草稿**（恒空白 + 顺带清残留键）；③重新进入同 scope 预会话（同 workspace+runtime）时 portal 的 key 值相同导致组件不重挂载、输入态残留——门户对预会话 key 追加**自增 nonce**（每次 enterPreSession/直带链置位 preContext 时 +1），强制重挂载。真会话草稿持久化（按 sessionId）不动，零回归。 选择「受理即清 + 失败恢复」而非「响应后清（现状）」：用户感知第一优先级是发送即时出框（ChatGPT/Claude 等同款交互惯例）；失败是小概率路径，恢复成本一行 `setInput((prev) => (prev === "" ? prompt : prev))`（不覆盖失败窗口期的新输入，与既有 inflight 打断回退 `handleInterrupt` 分支同款先例）。

## D-daemon-050@v1 2026-10-23-skill-prune-git-safe——答：daemon 技能裁剪 `pruneSkillsToSubset`（skill-manager.ts）现行为是「删 `<workDir>/.claude/s
状态：implemented
变更：2026-10-23-skill-prune-git-safe
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-23-skill-prune-git-safe/design.md
文件：sillyhub-daemon/src/skill-manager.ts, sillyhub-daemon/tests/skill-manager.test.ts, sillyhub-daemon/tests/task-runner.test.ts
最近确认：未记录
理由：答：daemon 技能裁剪 `pruneSkillsToSubset`（skill-manager.ts）现行为是「删 `<workDir>/.claude/skills/` 下不在本会话 skillRefs 清单里的所有目录」——workDir 是 git 仓库工作区时，删的是 git 跟踪的项目正式文件（2026-10-23 实证：会话 0c9c4e67 创建时被删 250 个跟踪文件）。修法把删除条件从单一「不在清单」收敛为**三重与**：`不在 skillRefs ∧ 目录名 ∈ daemon 技能库清单（skillsDir() 的一级目录名集合）∧ 非 git 跟踪`——daemon 只裁剪「自己 link 进来的副本」，项目自带的正式技能（git 跟踪）与用户自建目录（不在 daemon 库）一律不碰；裁剪功能对非 git 工作目录（生产任务场景）保持有效。改动收敛在 skill-manager.ts 单函数 + 一条 `git ls-files` 查询，两个调用方（task-runner.ts:499 batch / daemon.ts:9789 interactive）零改动自动受益。 选「git ls-files 判定」而非「link 时打标记」的原因：标记要兼容历史已 link 的存量目录（老会话/老任务残留无标记），而 git 跟踪状态是即时事实、无状态同步问题；代价是 prune 路径多一条 git 子进程（启动路径一次性，非每轮，可接受）。

## D-daemon-051@v1 2026-10-24-close-run-quota-fallback——答：根因（2026-10-23 会话 OpenCode Go 限额轮 run 0278895b 实证）——出错会话所在机器（DESKTOP-VBOLHBH）的
状态：implemented
变更：2026-10-24-close-run-quota-fallback
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-24-close-run-quota-fallback/design.md
文件：backend/app/modules/daemon/run_sync/service/close_run_steps.py, backend/app/modules/daemon/tests/test_close_interactive_run_quota_log_fallback.py
最近确认：未记录
理由：答：根因（2026-10-23 会话 OpenCode Go 限额轮 run 0278895b 实证）——出错会话所在机器（DESKTOP-VBOLHBH）的 daemon 版本旧，终态上报（notifyRunResult → close_interactive_run）只带 is_error=true 不带 error（ModelError），后端只能落兜底文案「本轮执行失败（执行端未回传详细原因）」，前端显示「运行失败 · unknown」。而真实错误文本（`API Error: Request rejected (429) · [1308][已达到 5 小时的使用上限。您的限额将在 2026-10-23 13:27:04 重置。]`）其实已随消息事件落库在 agent_run_logs。 修复选**后端兜底**而非升级所有 daemon：在 `close_interactive_run` 编排层（close_run_steps.py）增加推断步——`is_error=True 且 error=None` 时查该 run 已落库日志行（channel='stdout' 且 content 含 "API Error"，timestamp 倒序 LIMIT 3）拼同 result_summary，命中「429 + 限额关键词」即构造 ModelErrorDTO(type=quota_exceeded) 补进 error 参数，再走既有 `_close_apply_terminal`（error_detail 落库）与 `_close_post_commit`（auto_resume quota 链到 reset_at+120s 自动续跑排期）。分类关键词/文案/code 提取/reset_at 解析逐条对齐 daemon `model-error/classifier.ts`（classifyBlob 规则 1 + extractCode 方括号码 + extractResetAt），后端实现处注释注明对齐源，防双源漂移。 范围有意收窄为 quota_exceeded 专项：它是实证痛点（限额文本稳定携带 429+上限关键词，误报面小），且 error_detail.type==quota_exceeded 直接接通 auto_resume 的到点自动续跑——价值不止展示；auth/network/timeout 等类型后端不猜（文本特征弱、误报会误导用户），仍以 daemon 回传为唯一来源，等旧 daemon 升级自然恢复。

## D-daemon-052@v1 2026-10-24-pi-edit-patch-synth——答：pi 运行时（pi-events.ts 设计期把 edit_patch 列为"非目标"）的工具结果只有"Successfully wrote/replace
状态：implemented
变更：2026-10-24-pi-edit-patch-synth
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-24-pi-edit-patch-synth/design.md
文件：backend/app/modules/daemon/run_sync/service/close_run_steps.py, backend/app/modules/daemon/tests/test_close_interactive_run_quota_log_fallback.py, frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx, frontend/src/components/daemon/file-changes/__tests__/turn-file-diff-dialog.test.tsx, frontend/src/components/daemon/file-changes/turn-file-diff-dialog.tsx, frontend/src/components/daemon/turn-timeline.tsx, sillyhub-daemon/src/interactive/pi-edit-patch-synth.ts, sillyhub-daemon/src/interactive/pi-events.ts, sillyhub-daemon/tests/interactive/pi-edit-patch-synth.test.ts
最近确认：未记录
理由：答：pi 运行时（pi-events.ts 设计期把 edit_patch 列为"非目标"）的工具结果只有"Successfully wrote/replaced …"确认文本，无任何 diff 数据——但 **edit 的入参 `edits[{oldText,newText}]` 与 write 的入参 `content` 本身就是完整变更内容**（实测会话 f019f0d2 第 8 轮：490 条日志 0 条 edit_patch 行，11 个 write/edit 调用入参齐全）。修法在 daemon 侧合成：`tool_execution_end` 到达且工具为 edit/write 且成功时，从该 call_id 登记的入参合成 structuredPatch（前端既有格式 `[{oldStart,newStart,lines:["-old","+new"]}]`）挂到 tool_result 事件的 `edit_patch`——backend 对 edit_patch 是字符串透传、前端 parseStructuredPatch 既有消费，**双侧零改动**。行号来源：end 时读改后文件，按顺序定位每块 `newText` 得 `newStart`（前缀换行计数），`oldStart = newStart + 前块净行偏移`（多块累积）；write 全 add 行（覆盖写旧行不可知，如实展示写入后全文）。 配套前端兜底（FR-04）：daemon 升级前的存量 pi 轮次仍无补丁，弹窗无补丁文案按"文件行编辑归因"区分——有归因（改N次>0）改说"确实来自 agent 编辑但运行时未上报补丁"，消除"明明是 agent 写的却说不是"的错误断言（用户实证主诉）。

## D-daemon-053@v1 2026-10-25-session-git-worktree-root——用户实证缺陷：会话内 agent 切到 sillyspec 工作树干活，指示项仍显示主仓 main。
状态：implemented
变更：2026-10-25-session-git-worktree-root
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-25-session-git-worktree-root/design.md
文件：backend/app/modules/daemon/schema.py, backend/app/modules/daemon/session/service/git_status.py, backend/openapi.json, backend/tests/modules/daemon/test_session_git_status.py, frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx, frontend/src/components/daemon/turn-live-marquee.tsx, frontend/src/components/daemon/turn-timeline.tsx, frontend/src/components/sessions/__tests__/session-config-bar.test.tsx, frontend/src/components/sessions/session-config-bar.tsx, frontend/src/lib/api-types.ts, frontend/src/lib/daemon/sessions.ts, sillyhub-daemon/src/api-types.ts
最近确认：未记录
理由：用户实证缺陷：会话内 agent 切到 sillyspec 工作树干活，指示项仍显示主仓 main。根因（线上 DB + 本机证据链）：平台所有 cwd 信号都是快照——`AgentSession.cwd` 是创建时值（恒主仓）、`platform_agent_logs.agent_cwd` 是 daemon 日志扫描的会话启动目录（1712 条日志仅 1 条且为主仓）、`worktree_leases` 表不经 sillyspec CLI 登记（该会话 change/run 查询 0 行）；agent 在 Bash 里 cd 进 worktree 是 agent 侧行为，平台无感知。唯一结构化可推导信号：sillyspec worktree 固定布局 `<工作区根>/.sillyspec/.runtime/worktrees/<change_key>/`（sillyspec 源码 src/worktree.js:7 WORKTREES_REL 常量）+ `AgentSession.current_change_id`（inject 打锚、随命令游走）→ `changes.change_key`（sillyspec change 名）。 方案：root 决策链前置「尽力而为」探测层——current_change_id → change_key → 候选路径（以**成员绑定根**为锚，daemon-client 模式每成员本机副本）→ daemon 平名 RPC `host_fs.stat` 探测候选下 `.git`（worktree 的 .git 是文件，lstat 可见——host_fs delegate probe_workspace_git_mode 同判据）→ 命中则 root=工作树、后续 git_status 照旧；miss/异常静默落回现有链（cwd → 绑定根），零现状回归。响应新增 `root_source` 四态字段；前端 root_source="worktree" 时 badge 加「工作树」可见标识（Tooltip 同步标注）。

## D-daemon-054@v1 2026-10-26-ci-red-to-green——CI 四条 workflow 三红一疑卡，根因四类、修法各对位： 1. **e2e-ci（红，三层因逐层揭示——e2e 被 pgvector 阻塞 10 天，修
状态：implemented
变更：2026-10-26-ci-red-to-green
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-26-ci-red-to-green/design.md
文件：.github/workflows/e2e-ci.yml, backend/app/modules/daemon/tests/test_machine_sillyspec.py, docs/releases/2026-10-26-004-f1e476a90.md, frontend/e2e/proto-file-card.spec.ts, frontend/src/components/daemon/session-panel/session-panel-dialog.tsx, frontend/src/components/daemon/session-panel/session-panel-page.tsx, frontend/src/components/explorer/__tests__/file-explorer-git-status.test.tsx, frontend/vitest.config.ts, sillyhub-daemon/src/daemon.ts, sillyhub-daemon/tests/daemon-kind-dispatch.test.ts, sillyhub-daemon/tests/daemon-status-root-persistence.test.ts, sillyhub-daemon/tests/interactive/session-thinking-level.test.ts, sillyhub-daemon/tests/interactive/task-lifecycle.test.ts, sillyhub-daemon/tests/spec-transport-tar-sync/daemon-interactive-spec-sync.test.ts
最近确认：未记录
理由：CI 四条 workflow 三红一疑卡，根因四类、修法各对位： 1. **e2e-ci（红，三层因逐层揭示——e2e 被 pgvector 阻塞 10 天，修复即「考古」）**：第一层 `.github/workflows/e2e-ci.yml` PG service 用 `postgres:16-alpine`，缺 vector 扩展，迁移 20261015200000 fail-closed 中止。修法：镜像换 `pgvector/pgvector:pg16`（对齐 deploy/docker-compose.yml 既有口径，迁移报错信息与 2026-10-15-knowledge-search-pgvector design Phase 4 均指名此修法）。第二层：runner 镜像滚动 ubuntu-latest→26.04，Playwright 1.60 `--with-deps` 无 26.04 依赖包（装浏览器即失败）。修法：e2e job 钉 `runs-on: ubuntu-24.04`。第三层（迁移通过、e2e 十天来首次真跑后连环暴露 spec 停留在旧组件形态）：①数字断言子串/双段同值双命中 strict violation（+226：agent 段与总共段种子下同值；12 个文件变更：全 tool 卡两段同数）→ 改 header innerText containment（与 spec 既有第三卡 innerText 用法对齐）；②`toHaveCount(8)` received 7 / `toHaveCount(100)` ——2026-10-23-file-card-agent-grouping 起 shell 归因文件收进「命令行/其他」折叠区段，spec 未跟进 → 补 `file-changes-other-toggle` 点击步骤对齐现设计。三修均为 spec 对齐已上线组件形态，组件零改动。 2. **daemon-ci（红，第一轮修 11 用例三文件；第二轮 CI 实测再收 7 用例两文件）**：~~CI 失败面=11 用例~~（初判来自日志尾部截断，低估）；第二轮推送后 CI 全量清单实为再剩 2 文件 7 用例，与本机既有失败同源—— - `daemon-status-root-persistence` ×5：`sillyspecManager` mock 为空对象，`_noteSillySpecStatusRoot` 调 `clearStatusProbeEviction`（2026-10-22-sillyspec-probe-db-missing-evict 引入）TypeError。修：mock 补 no-op 方法。 - `daemon-kind-dispatch` skillsStep ×2：`pruneSkillsToSubset` 三重与守卫只裁「daemon 技能库清单内」目录（防误删用户自建目录），测试 fixture 的 skill-a/b 未登记进清单被 unmanaged 守卫故意保留。修：`vi.stubEnv('SILLYHUB_DAEMON_DIR', <fixture>)` 把 fixture 登记为技能库（daemonStateDir 懒读 env 即生效），finally unstub。 - 修正记录：本机全量 8 失败中 status-root/kind-dispatch 并非「Windows 固有」，是跨平台存量失败（daemon-ci 10-23 起一直红掩盖了它们）；`daemon-provider-session-dir-lifecycle` ×1 为 Windows 偶发（单跑绿，不阻塞 CI）。 - `reportTurnPhase`（daemon.ts:9496，2026-10-26-session-stage-progress 引入）直接 `this._client.notifyTurnPhase(...)` 后挂 `.catch`，但**方法缺失时属性访问同步抛 TypeError**，`.catch` 尚未挂上即外溢，中断 `_startInteractiveSession` 创建链（spec_sync 阶段在 create 之前）→ thinking-level 4 用例 waitForSpy 超时 + spec-sync B 组 5 用例 spy 0 调用。修法：源码加固——上报体包 try/catch 吞同步异常（兑现该函数自己注释声明的 D-009「上报失败仅 debug 不阻塞」不变量）；onTurnMessage 桥拦截分支（daemon.ts:4883 附近）同样核验防护。 - `turn_phase_report` 旁路消息（session-manager/events.ts:283，每个 envelope 无状态直发、去重键在 daemon 层拦截分支 D-013④）在单测里直击 `deps.onTurnMessage` mock，穿过了 task-lifecycle 只滤 `session_header` 的过滤断言（期望 3 得 7；期望 0 得 1）。修法：测试断言收窄排除 `type==='turn_phase_report'`——同文件 2026-10-25-trajectory-source-model 对 session_header 旁路的收窄先例逐字同构，TASK 流断言主体不动。 - mock 工厂漂移：spec-sync 测试 vi.mock 工厂只列 4 个导出，daemon.ts 现导入 7 个（heartbeat 用 `readLocalSpecVersion` 缺失→heartbeat_failed 噪音）。修法：工厂改 importOriginal 展开真实模块再覆盖 4 个 spy（对未来新增导出零漂移）；client mock 补 `notifyTurnPhase` vi.fn（镜像真实 HubClient 面，hub-client.ts:1531）。 - 以上三类为第一轮（本机 3 文件 66 用例复现驱动）；第二轮 CI 实测（见上）再收 status-root/kind-dispatch 两个文件 7 用例——同一「源码演进 vs 测试夹具滞后」病根的另外两个变体。 3. **frontend-ci（红，5 文件）**：两源—— - **sessions-portal 草稿丢失（生产缺陷，源码修复）**：`draftHydratedRef` 写抑制门闩用 `requestAnimationFrame` 放行——jsdom rAF 是 16ms 定时器，高负载下（本地 5 文件同跑/CI 2 核满载）迟到，放行前到达的首次输入持久化被静默跳过（探针实证：失败轮 `write "AAA"` 从未发生，键恒空，二次挂载回读必然 ''）。修法：门闩改 effect 顺序放行——写抑制窗口精确等于恢复 commit 本身（同 commit 声明序更后的第三 effect 置 false），dialog 模式同款同步修。诊断法：对拍（sessions-portal+scroll 双文件必挂）→ 加大 waitFor 预算复跑（同配置全绿证明非永久态）→ 源码读写插桩抓失败轮序列（write AAA 缺席=写入被门闩吞）。该缺陷生产同构：慢设备上挂载后即刻输入的用户草稿会丢。 - **其余 4 文件（scroll/history-race/load-earlier-full-turn/git-status）CI 独有**：第一修推送后 CI 实测仍红（4 失败，其余 422 文件全绿——sessions-portal 转绿证实门闩修复生效）。四者均为 CI runner（2 核+coverage 满载）独有：本地全量/coverage/单线程复刻多轮全绿；失败形态=waitFor 5s 预算内异步链未达成（load-earlier 请求未发出/antd Tree 节点未渲染），静态分析未锁定（守卫链均应满足、无 rAF 类门闩），无 CI 侧插桩手段前根因不可判定。处置：CI 条件 `retry: 2`（frontend vitest config，`process.env.CI ? 2 : 0`）——与 backend pytest `--reruns 2` 同款兜底先例；本地零重试不掩盖真红；根因定位（CI 侧插桩/逐用例预算/隔离复现）留后续独立变更，属已知技术债如实记录。 4. **backend-ci（红，已实锤非挂死）**：run 40341250526 终态 failure（非 timeout）——Pytest 实跑 40:55（< 45 分钟线），1 failed / 9217 passed：`test_machine_sillyspec.py::test_http_heartbeat_accepts_and_clears_sillyspec_status` 断言 sillyspec_status 落库键集时多出 `thin_flows`。根因：c326a4b2b（session-change-progress-hover）给心跳 sillyspec_status DTO 增 `thin_flows: list|None=None`（heartbeat.py:190），model_dump 整包直写把 None 键带进落库行；daemon 侧钉测试同步了（12→13 参），backend 侧这份 11 键精确断言漏更。修法：该测试单独对账 `_STATUS_KEYS | {"thin_flows"}` 并断言 None 默认——同文件另两处 `_STATUS_KEYS` 断言（服务层直写 dict/读侧视图，11 键）不受 DTO 注入影响，保持不动；新路径专项已有 test_heartbeat_thin_flows.py。

## D-daemon-055@v1 2026-10-26-turn-phase-prod-fix——三件事：(1) 可观测性先行——daemon 侧 turn_phase 上报链路（session-manager 两处发出点 + daemon.ts 拦截分支与
状态：implemented
变更：2026-10-26-turn-phase-prod-fix
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-26-turn-phase-prod-fix/design.md
文件：backend/app/modules/daemon/session/network_context.py, backend/tests/modules/daemon/test_network_context.py, sillyhub-daemon/src/daemon.ts, sillyhub-daemon/src/interactive/session-manager/events.ts, sillyhub-daemon/src/interactive/session-manager/turn-control.ts, sillyhub-daemon/src/turn-phase-observability.ts, sillyhub-daemon/tests/turn-phase-observability.test.ts
最近确认：未记录
理由：三件事：(1) 可观测性先行——daemon 侧 turn_phase 上报链路（session-manager 两处发出点 + daemon.ts 拦截分支与五步 helper）加分级观测：失败首警 warn（session+phase 去重）、成功默认静默、SILLYHUB_TURN_PHASE_TRACE=1 时成功记 info。部署后生产一轮消息即产出定位证据（观测点之间哪一环没打点即断点），修复据证据落码。(2) 据证据修复断链（候选集中于 session-manager 侧 inject 路径的上报执行；静态五项已排除，见 requirements FR-02）。(3) backend network_context.py 文案分支：「拼地址信息不可用」仅挂在 interfaces 为空分支，NAT 形态低置信标注与地址候选并存。不采用「盲改可疑点」——静态证据全部排除后盲改命中率低且不可证伪；观测先行多一次部署轮但把定位从猜测变为读日志。

## D-daemon-056@v1 2026-10-26-ws-evict-close——答：只改 backend `ws_hub.py` 的 `_evict_stale`——身份校验通过并从路由表 pop 之后，在锁外对被逐出的旧 ws 主动 `a
状态：implemented
变更：2026-10-26-ws-evict-close
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-26-ws-evict-close/design.md
文件：backend/app/modules/daemon/tests/test_ws_hub.py, backend/app/modules/daemon/ws_hub.py
最近确认：未记录
理由：答：只改 backend `ws_hub.py` 的 `_evict_stale`——身份校验通过并从路由表 pop 之后，在锁外对被逐出的旧 ws 主动 `await ws.close(code=4000, reason="evicted")`（best-effort，吞一切异常）。`send_to_runtime` 的超时与异常两条失败路径都汇经 `_evict_stale`，一处修复全覆盖两条路径。故障的机制核心是「backend 单侧失联、daemon 无感知」——daemon 侧 ws-client 对服务端 close 帧有既有处理（close 事件 → 指数退避重连 1-30s），补上 close 这一环路由表即秒级自愈，daemon 零改动；`connect()` 替换旧连接时的 `existing.close(code=4000, reason="replaced")` 是同文件既有先例，语义同源。

## D-daemon-057@v1 2026-10-27-ghost-spec-binding-fix——根因（2026-10-27 会话 9d190177 实证）：`sillyspec flow start --change task-wakeup-precisi
状态：implemented
变更：2026-10-27-ghost-spec-binding-fix
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-27-ghost-spec-binding-fix/design.md
文件：backend/app/modules/change/binding.py, backend/app/modules/change/service.py, backend/app/modules/change/tests/test_session_changes_endpoint.py, backend/app/modules/change/tests/test_spec_binding.py, backend/app/modules/daemon/session/service/helpers.py, backend/app/modules/daemon/tests/test_session_queue.py, docs/releases/2026-10-27-003-4597eab86.md, frontend/src/app/globals.css, frontend/src/app/m/workspaces/[id]/sessions/page.tsx, frontend/src/components/chat/round-divider.tsx, frontend/src/components/daemon/__tests__/message-queue-bar.test.tsx, frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx, frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx, frontend/src/components/daemon/__tests__/session-log-assembler.test.ts, frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx, frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx, frontend/src/components/daemon/session-change-files-hover.tsx, frontend/src/components/floating/floating-session-host.tsx, frontend/src/components/mobile/mobile-tab-bar.test.tsx, frontend/src/components/mobile/mobile-tab-bar.tsx
最近确认：未记录
理由：根因（2026-10-27 会话 9d190177 实证）：`sillyspec flow start --change task-wakeup-precision-fix`（缺日期前缀）被 CLI exit 2 拒绝，但平台命令解析绑定通道（`binding.py`）只解析命令文本不看执行结果，为该名字建出 placeholder 变更行（draft/active/无文档）+ 会话链接；该名字永远无文件系统目录，reparse 删除环又因"从未同步过文档的占位行保护"不收敛，幽灵条目永挂会话弹窗「进行中」。本变更双层修复： 1. **写侧防新增**（`binding.py bind_session_to_change`）：查库未命中且名字不带日期前缀（CLI 强制规则，必被 exit 2 拒）→ 跳过建行，log.warning + 返回 None。选「查库未命中」作校验前提是为了兼容历史旧格式名变更——CLI 明确"已存在的旧名变更不受影响"，已有行照常绑定（校验下沉到 bind 函数而非纯解析函数 `extract_spec_bindings` 的原因：后者不查库，无法区分"旧名已有行"与"无前缀必被拒"）。 2. **读侧兜底存量**（`service.py list_changes_for_session`）：过滤「draft + active + 无 change_documents + created_at 超 30 分钟」四条件同时满足的行。覆盖写侧拦不住的残留（带前缀但 `--input` 不合规被拒、本次事故已落库的存量幽灵、本地库 2026-07-07 `default` 历史残留）。存量数据无需清理脚本，读侧过滤即时生效。 放弃的方案：①绑定通道感知命令成败——tool_call/tool_result 帧均无结构化 exit code / is_error 字段（会话导出 full.json 实证，仅 tool_result.content 文本以 "Exit code N" 开头），文本解析脆弱且 tool_result 可能跨批上报（绑定在收口时刻发生，时序不可靠）；②reparse 删除环收编幽灵——占位保护（7 天窗）与墓碑豁免逻辑交错，动删除环影响面大且全量 reparse 低频，时效差；③一次性 SQL 清理存量——读侧过滤已让幽灵不可见，无需触达生产库。 用户执行期扩面（D-001@v1，2026-10-27 会话插入）：弹窗实时性一并修复——「真实创建成功的变更没能立刻展示、失效变更没能立刻消失、要刷新页面才回显」。定性：`useSessionChanges` 轮询策略 `refetchInterval: active ? 15_000 : false`——弹窗未打开时零刷新（徽标数/列表滞留旧值直至组件重挂载），打开瞬间 staleTime 10s 内直用缓存且 interval 要等 15s 首跳。第三层修复（前端）：关闭态改 30s 低频轮询保底（挂载面单实例 session-panel-page 一处，轻 JOIN 接口，请求量可忽略）+ 打开下拉/弹窗时立即 refetch（所见即最新），打开态 15s 轮询不变。 用户第二份会话导出实证**第二条幽灵通道**（D-002@v1）：会话 5f088f10（调查会话自身）弹窗在 08:51 又出现一条 `task-wakeup-precision-fix` 全量/未开始——根因是 `iter_command_segments` 按 `&&`/`;`/`|`/换行分段**不感知引号**，该会话 `flow start` 的 `--input` 引号长文本里引用了示例命令「sillyspec flow start --change task-wakeup-precision-fix」，引号内文本被切成独立"命令段"，`extract_spec_bindings` 对段中 token 序列的**中缀容忍匹配**（原注释允许"包装剥除后残留 exec 等中缀"被泛化成任意位置命中）误解析出幽灵绑定。第四层修复（仍在 binding.py）：run/flow 两族 `sillyspec` 定位收紧为**段首 token 或紧随 `exec`**——引号内文本所在段首是中文描述 token，不再命中；`pnpm exec sillyspec` 剥包装后 exec 中缀容忍保留，零回退。不改共享分段函数 `iter_command_segments`（tool_kind 打标同源消费，引号感知属行为重写）。

## D-daemon-058@v1 2026-10-27-knowledge-hits-flush-button——断流根因：sillyspec CLI 2026-10-18「runtime 布局分层」把 `knowledge-hits.jsonl` 一次性迁移到 `.run
状态：implemented
变更：2026-10-27-knowledge-hits-flush-button
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-27-knowledge-hits-flush-button/design.md
文件：backend/app/modules/change/router.py, backend/app/modules/change/schema.py, backend/app/modules/change/tests/test_hits_sync.py, backend/app/modules/daemon/router/__init__.py, backend/app/modules/daemon/router/notify.py, backend/app/modules/daemon/run_sync/service/__init__.py, backend/app/modules/daemon/run_sync/service/publish.py, backend/app/modules/daemon/schema.py, backend/app/modules/daemon/tests/test_session_bg_task_final.py, backend/app/modules/platform_sync/schema.py, backend/openapi.json, frontend/src/components/agent-log/__tests__/bg-task-final.test.ts, frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx, frontend/src/components/changes/detail/change-assets-card.tsx, frontend/src/components/daemon/__tests__/turn-time-display.test.tsx, frontend/src/components/daemon/agent-log-card.tsx, frontend/src/components/daemon/session-panel/session-panel-page.tsx, frontend/src/lib/api-types.ts, frontend/src/lib/changes.ts, frontend/src/lib/daemon/session-sse.ts
最近确认：未记录
理由：断流根因：sillyspec CLI 2026-10-18「runtime 布局分层」把 `knowledge-hits.jsonl` 一次性迁移到 `.runtime/state/`，daemon 上行器仍读旧路径 `.runtime/` 根——文件 ENOENT 被上行器视为「该工作区无命中数据」常态静默跳过，10-17 后全平台零上行。用户拍板终态：CLI 直报为主（sillyspec 仓另立轻量变更）+ 平台按钮经 daemon 按需补数；本变更落平台仓三件： 1. **daemon 读路径双兼容**：上行器与周期器的 hits 文件解析改为 state/ 新路径优先、旧路径回退——新文件即旧文件迁移延续，既有 offset/行指纹状态对新文件前段天然有效（b97f8231 已上行 10070 行直接续走），积压约 1300 行随周期器恢复自动补进库； 2. **daemon 注册 `sillyspec_hits_flush` RPC**：直接调上行器强制跑一轮（上行器本身无短路，短路在周期器 stamp 层——天然绕过），in-flight 去重照 `_runSyncChangeWithDebounce` 先例； 3. **backend `POST /changes/{id}/hits-sync` 端点 + 前端「同步变更」按钮**：端点照 `_sync_change_via_daemon` 降级铁律（绑定解析→在线判断→send_rpc，各失败路不抛、回执带原因），按钮挂沉淀资产卡、成功后 invalidate 刷新。 选型依据：接收端复用既有 `POST /knowledge/hits/batch`（行级 sha256 幂等去重，多通道重报零副作用）——零新表、零新鉴权分支；触达链路复用既有 WS RPC 通道与降级先例——零新协议。否决决策对账：`D-sillyhub-daemon-001@v1`（2026-10-16-conflict-full-tree-compare）曾否决「新增 daemon RPC」，否决前提是「等 daemon 自更新铺开才生效、收益是假想的未来变化」——该前提已被其后落地的 `sillyspec_sync_change` RPC 先例推翻（本项目 daemon 随平台仓自分发），且本变更有真实断流需求与用户拍板，不复潮。

## D-daemon-059@v1 2026-10-27-task-wakeup-inject-retry——改动集中在 daemon 侧两处： 1. **主修**（`sillyhub-daemon/src/interactive/session-manager/bac
状态：implemented
变更：2026-10-27-task-wakeup-inject-retry
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-27-task-wakeup-inject-retry/design.md
文件：backend/app/modules/change/binding.py, backend/app/modules/change/service.py, backend/app/modules/change/tests/test_session_changes_endpoint.py, backend/app/modules/change/tests/test_spec_binding.py, backend/app/modules/daemon/session/service/helpers.py, backend/app/modules/daemon/tests/test_session_queue.py, docs/releases/2026-10-27-003-4597eab86.md, docs/sillyspec/finished/target-files-worktree-docs-mismatch.md, frontend/src/app/globals.css, frontend/src/app/m/workspaces/[id]/sessions/page.tsx, frontend/src/components/chat/round-divider.tsx, frontend/src/components/daemon/__tests__/message-queue-bar.test.tsx, frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx, frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx, frontend/src/components/daemon/__tests__/session-log-assembler.test.ts, frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx, frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx, frontend/src/components/daemon/session-change-files-hover.tsx, frontend/src/components/floating/floating-session-host.tsx, frontend/src/components/mobile/mobile-tab-bar.test.tsx
最近确认：未记录
理由：改动集中在 daemon 侧两处： 1. **主修**（`sillyhub-daemon/src/interactive/session-manager/background-tasks.ts` `scheduleTaskWakeup`）：2s debounce 定时器回调内的注入 `await cb(...)` 从「单发即弃」（catch 仅 console.error）改为**退避重试循环**——默认计划 `[5s,15s,30s,60s,120s,300s]`（首发 1 次+重试 6 次，总窗约 9.3 分钟，盖住生产部署重建窗 35s~数分钟 + WS 重连 reconcile 间隔）；每次退避等待结束后先查 `mgr._store.has(sessionId)`，会话已终态清理即中止。计划常量与 env 解析放 `daemon.ts`（`taskWakeupRetryDelaysMs()`，与 `taskWakeupQuietThresholdMs` 同款惯例：逐次读取、非法容错、`0`/空=禁用回单发——止血开关对齐既有 FR-03 总关闭阀先例）。 2. **附带修**（`sillyhub-daemon/src/turn-phase-observability.ts` `notePhaseEmit`）：增加 per `(point, sessionId, runId)` 防重（有界 512 逐出最旧，与 `warnOncePhaseFailure` 同惯例；测试清理入口复用 `resetTurnPhaseObservabilityForTest` 一并清零）。背景：TRACE 门控本身无 bug，但记点无防重——session-manager 侧每 envelope 无状态直发（D-013④ 设计，防重在 daemon 层），TRACE 开启时记点随 envelope 数刷屏（实证 daemon.log 323219-323256 同一 run 同秒 30+ 行）；防重后 TRACE 每 (point, run) 恰一行，断链定位配对语义不变（两点间缺一即锁定断链环节，只需首记即可判在）。

## D-daemon-060@v1 2026-10-27-task-wakeup-precision-fix——答：把唤醒主判据从「时长 ≥ 静默阈值」反转为「任务是否后台（tool_use 的 run_in_background 参数）」，时长阈值降级为信息不足时的兜底
状态：implemented
变更：2026-10-27-task-wakeup-precision-fix
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-27-task-wakeup-precision-fix/design.md
文件：backend/app/modules/change/binding.py, backend/app/modules/change/service.py, backend/app/modules/change/tests/test_session_changes_endpoint.py, backend/app/modules/change/tests/test_spec_binding.py, backend/app/modules/daemon/session/service/helpers.py, backend/app/modules/daemon/tests/test_session_queue.py, frontend/src/app/globals.css, frontend/src/app/m/workspaces/[id]/sessions/page.tsx, frontend/src/components/chat/round-divider.tsx, frontend/src/components/daemon/__tests__/message-queue-bar.test.tsx, frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx, frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx, frontend/src/components/daemon/__tests__/session-log-assembler.test.ts, frontend/src/components/daemon/__tests__/session-panel-dialog-scheduled-attachments.test.tsx, frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx, frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx, frontend/src/components/daemon/session-change-files-hover.tsx, frontend/src/components/daemon/session-panel/scheduled-send.tsx, frontend/src/components/daemon/session-panel/session-panel-dialog.tsx, frontend/src/components/daemon/session-panel/session-panel-page.tsx
最近确认：未记录
理由：答：把唤醒主判据从「时长 ≥ 静默阈值」反转为「任务是否后台（tool_use 的 run_in_background 参数）」，时长阈值降级为信息不足时的兜底防噪阀。改动四处： 1. **标记登记**（sillyhub-daemon/src/interactive/session-manager/events.ts `registerAgentToolUseMeta`）：解析 tool_use input JSON 时读取 `run_in_background === true` 存入 `_agentToolUseMeta` 新字段 `isBackground`；同时把登记范围从「仅 Task/Agent」扩展到 **Bash**（前台/后台长命令均登记，taskName 取 description）。注册表条目（background-tasks.ts 懒注册路径）从 meta 带入 `isBackground`；`registerAsyncReceiptTask`（异步启动回执兜底）恒 `isBackground: true`（回执本身即后台证据）。`BackgroundTaskInfo` 类型加 `isBackground?: boolean`。 2. **判定反转**（background-tasks.ts `handleTaskNotificationEvent` 唤醒分支）：三态判定——`isBackground === true`（注册条目/别名/元数据任一确认）→ 完成即唤醒，不受时长阈值限制（短后台任务漏唤醒即停摆；防灌屏职责改由前台免唤醒承担——实证灌屏源是前台孙命令，如 2026-10-26 的前台 pnpm install，其终态帧同款到达）；`=== false`（元数据明确前台）→ 免唤醒（终态 emit/落行不变）；`undefined`（信息不足）→ 维持既有逻辑（时长阈值 + fail-open）并打 WARN。env=0 总关闭阀全局生效不变。选这个口径是为了保守兼容：只有信息充足的场景才改变行为，历史会话/重启窗口/tool_use 丢失场景零回退，既有测试的构造（无 meta）全部保持原判定路径。 3. **显示同源**：唤醒门槛判定处已计算的 `durationMs`（帧值或注册表兜底）回传 `scheduleTaskWakeup` 用于「用时」显示（`elapsedMs: durationMs ?? elapsedMs`），显示与判定不再各算各的。 4. **文案**：daemon prompt 头部改「以下 N 个后台任务已全部结束（本批次均已终止）：」；backend helpers.py 合并正则改兼容形 `后台(?:子代理)?任务` + 重写模板同步新文案（新旧混排窗口不退化）；前端识别锚 `[后台任务通知]` 前缀不动，前端零代码改动。 为什么选 run_in_background 而不是时长或 tool_result 配对：它是工具契约层面的前后台声明（无该参数的命令结果必然同轮返回），判据因果直连「主代理是否已拿到结果」；时长只是相关性代理（两头误伤：61s 前台误唤醒、59s 后台漏唤醒——后者恰是 task-wakeup-restore 要救的停摆场景）；tool_result 同轮配对最本质但需追踪 result 流与轮次关系，改动面大，放弃。

## D-daemon-061@v1 2026-10-28-model-retry-visible——问题实证（2026-10-27 两会话各卡约 3 分钟）：模型 API 限流（智谱 429/错误码 1311）时 claude CLI 指数退避重试约 3 分钟
状态：implemented
变更：2026-10-28-model-retry-visible
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-28-model-retry-visible/design.md
文件：backend/app/modules/spec_workspace/drift_probe.py, backend/app/modules/spec_workspace/tests/test_incremental_reparse_trigger.py, backend/app/modules/spec_workspace/tests/test_memory_watermark.py, frontend/src/components/daemon/__tests__/session-log-assembler.test.ts, frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx, frontend/src/components/daemon/__tests__/turn-status-bar-phase.test.tsx, frontend/src/components/daemon/__tests__/turn-timeline-model-retry-gating.test.tsx, frontend/src/components/daemon/session-log-assembler.ts, frontend/src/components/daemon/turn-segment-views.tsx, frontend/src/components/daemon/turn-status-bar.tsx, frontend/src/components/daemon/turn-timeline.tsx, sillyhub-daemon/src/agent-event-schema.ts, sillyhub-daemon/src/bg-task-scan.ts, sillyhub-daemon/src/daemon.ts, sillyhub-daemon/src/interactive/claude-events.ts, sillyhub-daemon/src/interactive/session-manager/events.ts, sillyhub-daemon/src/types.ts, sillyhub-daemon/tests/bg-task-scan.test.ts, sillyhub-daemon/tests/interactive/claude-events.test.ts, sillyhub-daemon/tests/interactive/session-manager-status-dispatch.test.ts
最近确认：未记录
理由：问题实证（2026-10-27 两会话各卡约 3 分钟）：模型 API 限流（智谱 429/错误码 1311）时 claude CLI 指数退避重试约 3 分钟，期间 SDK 逐次发出 `system/api_retry` 帧（sdk.d.ts SDKAPIRetryMessage：attempt/max_retries/retry_delay_ms/error_status/error），但 daemon 归一化器 `_normalizeSystemMessage` 白名单（init/task_*/thinking_tokens/status）不含 api_retry，帧落到 `return []` 被丢弃；平台零事件，前端 turn-status-bar 段树空、走终级回退恒显「思考中」，用户无法区分「正常慢」与「卡死」。轮终态链路本身正确（CLI result `subtype="success"` 但 `is_error=true` + `terminal_reason="api_error"`，本机假 429 上游复现实证；daemon 按 is_error 归类 ModelError，backend `close_run_steps.py:429` 的 `or is_error` 分支正确落 failed 并存 error_detail，会话面板页 2026-10-20-session-error-visibility 已能渲染失败卡）——缺口只在「重试过程不可见」与「紧凑卡不透出失败原因」。 方案：复用仓内同构先例 ql-20260917-006（上下文压缩状态）。daemon 侧两跳——①`claude-events.ts _normalizeSystemMessage` 新增 api_retry 分支产出 status 事件（metadata 带 attempt/max_retries/retry_delay_ms/error_status/error 摘要）；②`session-manager/events.ts _dispatchStatusEvent` 新增 case，把事件经 `onTurnMessage` 落 `[MODEL_RETRY] ` + 单行 JSON 的 stdout 文本协议行（与 `[COMPACT_STATUS]` 同形态同通道，backend 照既有文本行落库 + SSE 透传，零 backend 改动）。前端三跳——`session-log-assembler.ts` 新增 kind=model_retry 分类（先于 reply 兜底）；`turn-segment-views.tsx` 运行中轮渲染「模型限流重试中 第N/M次」提示、终态轮对话正文不渲染（失败卡承担）；`turn-status-bar.tsx` currentActivity 回退链纳入最新 model_retry 段，替代恒挂「思考中」。 选此方案的理由：`[COMPACT_STATUS]` 已验证「daemon 协议行 → backend 透传 → 前端分类 → 实时提示」全链路可行且 backend 零 schema 改动；不选 notifyTurnPhase 新阶段方案（TurnPhaseValue 七阶段均为轮启动阶段，retry 属轮内过程，且 backend phase schema 与前端 phase 状态条渲染面都要动，改动面更大）；不选 daemon 侧自动重注入/退避干预（行为变更超出本变更可观测性定位，见 FR-03 禁改面）。

## D-daemon-062@v1 2026-10-30-task-resume-revive-notify-retry——两处根因分开治。
状态：implemented
变更：2026-10-30-task-resume-revive-notify-retry
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-30-task-resume-revive-notify-retry/design.md
文件：backend/app/modules/daemon/agent_task_store.py, backend/app/modules/daemon/schema.py, backend/app/modules/daemon/tests/test_agent_session_tasks.py, backend/app/modules/daemon/tests/test_agent_task_status_payload.py, backend/openapi.json, frontend/src/components/daemon/__tests__/agent-task-card-lifecycle.test.tsx, frontend/src/components/daemon/agent-task-store.ts, frontend/src/lib/api-types.ts, frontend/src/lib/daemon/session-sse.ts, sillyhub-daemon/src/agent-task-notify-retry.ts, sillyhub-daemon/src/api-types.ts, sillyhub-daemon/src/cli.ts, sillyhub-daemon/src/hub-client.ts, sillyhub-daemon/src/interactive/session-manager.ts, sillyhub-daemon/src/interactive/session-manager/background-tasks.ts, sillyhub-daemon/src/interactive/session-manager/types.ts, sillyhub-daemon/src/interactive/types.ts, sillyhub-daemon/tests/agent-task-notify-retry.test.ts, sillyhub-daemon/tests/interactive/task-lifecycle.test.ts
最近确认：未记录
理由：两处根因分开治。**根因一（续唤卡「已完成」）**：task-notification 语义是「本轮停止」，主代理续唤（SendMessage 重唤原任务）后子代理重跑，但平台 agent_session_task 行已被终态定格——backend `upsert_agent_task` 语义②吸收一切迟到 running，复活分支只对清扫 stopped 行开放。方案：daemon 侧用任务注册表视角产**显式复活信号**——终态注销时把 task_id 登记进「已终态集合」（与 `_backgroundTasks` 同生命周期），之后同 task_id 再收 running 帧即「注销后重开」铁证，emit 事件带 `resumed: true`（一次性，首帧后移除）；backend 收到 `resumed is True` 的 running 放行复活，前端归约同口径放行。**根因二（上报 502 丢事件）**：cli.ts onSessionEvent 桥对 agent_task_status 上报失败仅 console.error——加有限退避重试（5xx/网络错误、3 次、1s/4s/16s），upsert 幂等保证重放安全。 不选时间启发式复活（终态后 N 秒外的 running 视为续唤）：与 2026-10-11-task-sweep-liveness-guard 被用户指正误判的历史同型（「5 分钟心跳宽限启发式误判」→ 已改确认制），复活信号必须来自 daemon 注册表事实而非时间猜测——与 task-sweep-daemon-truth「daemon 注册表是死活唯一真相源」决策族一致。

## D-daemon-063@v1 2026-10-31-share-openai-chat-proxy-token——根因：llm-proxy 归属断言的认证主体是守护进程属主（子进程 Bearer=daemon apiKey），而共享 openai_chat 供应商的模型名
状态：implemented
变更：2026-10-31-share-openai-chat-proxy-token
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-31-share-openai-chat-proxy-token/design.md
文件：backend/app/modules/daemon/lease/context.py, backend/app/modules/daemon/router/gateway_misc.py, backend/app/modules/daemon/tests/test_lease_context_provider_share.py, backend/app/modules/daemon/tests/test_llm_proxy.py, backend/app/modules/llm_provider/proxy_token.py, backend/app/modules/llm_provider/router.py, backend/app/modules/llm_provider/service.py, backend/app/modules/llm_provider/tests/test_proxy_token.py, backend/app/modules/llm_provider/tests/test_router.py, backend/migrations/versions/20261030160000_grant_business_member_change_read.py, backend/tests/test_align_platform_change_events_migration.py, frontend/src/components/llm-providers/__tests__/share-provider-dialog.test.tsx, frontend/src/components/llm-providers/share-provider-dialog.tsx, sillyhub-daemon/src/codex-settings.ts, sillyhub-daemon/src/credential-injector.ts, sillyhub-daemon/src/types.ts, sillyhub-daemon/src/zcode-settings.ts, sillyhub-daemon/tests/codex-settings.test.ts, sillyhub-daemon/tests/credential-injector.test.ts, sillyhub-daemon/tests/zcode-settings.test.ts
最近确认：未记录
理由：根因：llm-proxy 归属断言的认证主体是守护进程属主（子进程 Bearer=daemon apiKey），而共享 openai_chat 供应商的模型名 uid 是供应商属主，两值在受赠者/借出场景必然不等 → 403。代理层拿不到「真正选择供应商的会话属主」身份——是身份载体缺失，不是断言写错。 方案（限域代理令牌）：backend 在会话级解析链（resolve_session_provider_config）授权通过后，对 openai_chat 且（授权主体≠属主 或 守护进程属主≠属主）的场景，用 settings.secret_key 签发短期 HMAC 令牌（shlp_ 前缀，载荷 u=会话属主/o=供应商属主/p=供应商 id/exp），随 provider_config.litellm_proxy_token 下发；daemon 三引擎凭据构造优先该令牌作 Bearer；llm-proxy 新增验签分支——签名+exp 过 → 若有 usr 形态模型名则必须等于 usr-<o>-<p>，否则 403；验签不过 → 401。既有 apiKey/JWT 路径与自机自供应商链路一字不动（只在今天必然 403 的链路上发令牌，可用路径零风险）。 放弃的方案：①按受赠者注册 LiteLLM 别名（usr-<受赠者>-<pid> 同上游同 key）——只修自机场景，借出场景仍 403，且别名生命周期（共享/撤销/改密钥/删供应商）都要同步 LiteLLM 注册表，漂移面大；②共享排除 openai_chat——砍掉昨晚上线特性的主场景之一（GLM/LiteLLM 网关形态），且不修「自有供应商跑借出守护进程从静默回落变硬 403」的连带回归。

## D-daemon-064@v1 2026-11-02-daemon-resume-gate-fix——答：事故根因是 `sillyhub-daemon/src/daemon.ts` `_routeSessionResume` 构造恢复记录时 `lastActiv
状态：implemented
变更：2026-11-02-daemon-resume-gate-fix
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-11-02-daemon-resume-gate-fix/design.md
文件：backend/app/modules/daemon/session/service/control.py, backend/app/modules/daemon/tests/test_session_switch_config.py, frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx, frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx, frontend/src/components/daemon-required-notice.test.tsx, frontend/src/components/daemon-required-notice.tsx, sillyhub-daemon/src/daemon.ts, sillyhub-daemon/src/interactive/session-manager/lifecycle.ts, sillyhub-daemon/src/interactive/session-manager/persistence.ts, sillyhub-daemon/src/interactive/types.ts, sillyhub-daemon/tests/daemon-session-resume-route.test.ts, sillyhub-daemon/tests/daemon-session-switch-config.test.ts, sillyhub-daemon/tests/interactive/session-idle-scanner.test.ts
最近确认：未记录
理由：答：事故根因是 `sillyhub-daemon/src/daemon.ts` `_routeSessionResume` 构造恢复记录时 `lastActiveAt: Date.now()`（:9363）——backend 断网恢复风暴一拍全量下发 SESSION_RESUME 时，把全部恢复会话的「最后活跃」集体刷新为恢复时刻；会话闸（`session-manager.ts:1101-1120`，2026-08-26-team-subsession-recursion design §5.D）的「30 分钟内活跃」口径被顶满（46≥20），新建会话全部 `SESSION_LIMIT_REACHED` 拒绝。boot 恢复路径（`session-manager/persistence.ts:164` restoreAndReconnect）本来就保留 `record.lastActiveAt`，唯一污染点就是 reopen 路径这一行。修法（最小面）：reopen 记录的 `lastActiveAt` 改三级取值——payload 显式值（协议前向兼容位，本期不下发）→ 本地 sessions.json 记录原值（`this._persistence.load()` 按 sessionId 查找）→ `Date.now()` 兜底（无记录的跨机移交形态，维持现状；单点 reopen 不足以顶满闸，且 backend 24h suspended GC 限制了 record-less 全量恢复的规模）。配套 `SessionState.restoredAt`（仅内存态，仿 `staleRunResetAt` 先例）：restoreAndReconnect 写恢复时刻，idle 扫描空闲时长从 `max(lastActiveAt, restoredAt)` 起算——保保留旧时间戳后默认关闭的 idle 回收（`SESSION_IDLE_TIMEOUT_SEC>0` 形态）不把恢复会话立即误杀。 第二处：切换轮丢弃静默（本机 11-02 09:08:28 实证：`session_switch_config_session_not_found` 仅 warn，run 卡 pending 300 秒才被僵尸轮清扫收敛）。`_routeSessionSwitchConfig` 的 not_found 分支与 `markPendingConfigSwitch` 异常分支对齐 `_reportInjectDropped` 先例回报 run 失败；回报寻址需要 lease_id，而切换轮 payload（backend `session/service/control.py` 切换分支，camelCase）现无 lease_id——补一个键（会话 lease_id 当下可得），daemon snake/camel 双读，旧 payload 缺键降级为仅 warn（不报错）。

## D-daemon-065@v1 2026-11-02-embed-batch-chunk——答：在 `vector_search.py` 加模块级常量 `_EMBED_BATCH_SIZE = 32` 与聚合助手 `_embed_corpus(embe
状态：implemented
变更：2026-11-02-embed-batch-chunk
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-11-02-embed-batch-chunk/design.md
文件：backend/app/modules/daemon/tests/test_inject_orchestrator_tagging.py, backend/app/modules/daemon/tests/test_session_service.py, backend/app/modules/knowledge/tests/test_vector_search.py, backend/app/modules/knowledge/vector_search.py, backend/app/modules/platform_sync/tests/test_agent_log_messages.py, backend/app/modules/platform_sync/tests/test_agent_log_push.py, docs/releases/2026-11-02-001-7e4e6903f3b0.md
最近确认：未记录
理由：答：在 `vector_search.py` 加模块级常量 `_EMBED_BATCH_SIZE = 32` 与聚合助手 `_embed_corpus(embedder, texts)`——把 `search_sync` 索引重建处的一次性全量 `embedder.embed([e.text for e in entries])` 改为按 32 条/批顺序分批调用并按序 `extend` 聚合；查询嵌入（`embed([q])`）与缓存/指纹逻辑零改动。选调用点分批而非代理层（`EmbeddingSubprocessProxy.embed` 内分批）：① 改动面最小且天然让每批各享一次代理超时/透明重启重试语义（代理层分批需把整段批序列塞进一个 300s deadline，超时与重试语义要重造）；② 现存 embed 调用点仅两处（语料全量 + 单条查询），爆炸面就是索引重建这一处，调用点收口即根治；③ 既有 FakeEmbedder 注入测试可直接断言批形状，无需 mock 子进程协议。批大小经生产 A/B 实测定档（998 条真实语料，bge-small-zh-v1.5）：64 → cgroup 峰值 2.09GiB（对 2500m 配额余量不足），32 → 峰值 1.47GiB/稳态 1.26GiB（留 ~1GB 余量给并发翻译 worker）——推理瞬态随 batch×seq² 缩放，批形状（而非语料总量）成为内存上界的决定项。 依据：2026-11-02 生产排查（dmesg 6 次 `Memory cgroup out of memory: Killed process (python)`，RSS 稳定 2.3~2.45GB；Netdata `mem.oom_kill` 告警 10-29×3/10-30/11-02；触发端点 `/api/knowledge/vector-search` 缓存未命中 → `vector_search.py:419` 全量批）；宿主内存充裕（available 5.9G），纯 cgroup 配额内单批过大。

## D-daemon-066@v1 2026-11-02-stale-test-sync-contract——10 个存量失败经 worktree 二分坐实为三簇「生产契约有意演进、测试未同步」，修复全部在测试侧对齐新契约，生产代码零改动： ①占位键形态（7 用例）：1
状态：implemented
变更：2026-11-02-stale-test-sync-contract
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-11-02-stale-test-sync-contract/design.md
文件：backend/app/modules/daemon/tests/test_inject_orchestrator_tagging.py, backend/app/modules/daemon/tests/test_session_service.py, backend/app/modules/knowledge/tests/test_vector_search.py, backend/app/modules/knowledge/vector_search.py, backend/app/modules/platform_sync/tests/test_agent_log_messages.py, backend/app/modules/platform_sync/tests/test_agent_log_push.py
最近确认：未记录
理由：10 个存量失败经 worktree 二分坐实为三簇「生产契约有意演进、测试未同步」，修复全部在测试侧对齐新契约，生产代码零改动： ①占位键形态（7 用例）：1015aa22f 有意规定「绑定通道拒为无日期前缀新名建占位」（CLI flow start 强制 YYYY-MM-DD- 前缀，无前缀名命令必败、占位即幽灵）。把 test_agent_log_push.py / test_session_service.py 中 `change-hub-*`、`change-degrade-*`、`shared-key` 等旧形态键改为日期前缀合法名（如 `2026-10-27-change-hub-claude`）——测试再次验证占位创建/link 语义/跨区 D-004/降级行为本身，而非快照被拒后的空集。 ②schema 字段（2 用例）：cdcb97fdb 给 AgentLogMessageItem 增 bg_task_final 可选字段（user_input 系统注入段配对面，缺省 None）。test_agent_log_messages.py 两处精确断言补入该字段：messages[0] dict 增 `"bg_task_final": None`；openapi properties 全集增 `bg_task_final`。 ③monkeypatch 缝（1 用例）：2ca991c0 把 attachments 切换轮解析入口换为 resolve_session_provider_config（attachments.py 函数体内延迟 import，patch 源模块属性即生效）。test_inject_orchestrator_tagging.py 回滚用例的 patch 目标同步换缝，DaemonSessionConfigInvalid 的 DID-raise 语义与全部回滚断言原样保留。

## D-daemon-067@v1 2026-11-04-daemon-spec-sync-chunking——只改 daemon 客户端推送腿（`sillyhub-daemon/src/spec-sync.ts`）：`postSpecSyncImpl` 增量路径的 `c
状态：implemented
变更：2026-11-04-daemon-spec-sync-chunking
原编号：D-000@v1
锚点：.sillyspec/changes/2026-11-04-daemon-spec-sync-chunking/design.md
文件：sillyhub-daemon/src/spec-sync.ts, sillyhub-daemon/tests/spec-sync-push-chunking.test.ts
最近确认：56fee9d9d5e484a402f4c9b956050a93995feb6b
理由：只改 daemon 客户端推送腿（`sillyhub-daemon/src/spec-sync.ts`）：`postSpecSyncImpl` 增量路径的 `client.postSpecSyncIncremental(wsId, ops, …)` 单批整推改为经新增 `postSpecSyncIncrementalChunked` 分批执行——纯函数 `chunkOpsForPush` 按「块内 op 数（缺省 128）+ base64 字节粗估和（缺省 2MiB）」双约束切块顺序提交，块响应合并成单批等价形状（conflict 任一块真、server_versions/new_versions 逐块累积）后走既有 conflict re-base 重试与缓存回写路径（该两段零改动）。中途块失败（已有块落地）抛 `ChunkedPushPartialError`，外层 catch **禁 tar 回退**（部分落地后整包覆盖有覆盖他端写入风险且大积压必超时），上抛原始错误由下轮同步以服务器清单为锚断点续传；首块失败（零落地）维持既有 tar 回退不变（旧后端兼容）。change_dirs 改为按块提取随块透传（scoped reparse 更精确）。env 键名与 CLI 侧一致（`SILLYSPEC_SPEC_SYNC_CHUNK_OPS` / `SILLYSPEC_SPEC_SYNC_CHUNK_BYTES`，缺省零回归）。 为什么是这个方案：生产实证（multi-agent-platform 工作区，2026-11-04）spec 文件树 15 天积压 2436 ops/45.7MB 单批推送在单请求预算内上传+服务端 apply 双超（服务器 8h 37 连败），CLI 侧已修（sillyspec 仓 2026-11-04-sync-push-chunking，1997 ops 23 块全部落地、spec_version 6469→6492 实证收敛）；daemon 侧同构缺陷更糟——增量超时后 catch 回退整包 tar（更大必超时）恶性循环，且 daemon 推送预算 300s 也不保底。分批后每块独立提交在预算内，断点续传靠清单锚刷新免费获得，服务器端零改动零部署（仅 daemon bundle 分发面）。

## D-daemon-068@v1 2026-11-06-fork-empty-prompt-boot——两端各改一处，均为既有契约的对齐而非新机制： 1. **daemon 侧（sillyhub-daemon/src/daemon.ts `_startIntera
状态：implemented
变更：2026-11-06-fork-empty-prompt-boot
原编号：D-000@v1
锚点：.sillyspec/changes/2026-11-06-fork-empty-prompt-boot/design.md
文件：backend/app/modules/daemon/session/service/create.py, backend/app/modules/daemon/session/service/fork.py, backend/app/modules/daemon/tests/test_session_fork.py, sillyhub-daemon/src/daemon.ts, sillyhub-daemon/tests/session-fork.test.ts
最近确认：3b5ad1ecbb99fd90730adda0348d448a3dc31af2
理由：两端各改一处，均为既有契约的对齐而非新机制： 1. **daemon 侧（sillyhub-daemon/src/daemon.ts `_startInteractiveSession`）**：空 prompt 守卫 （interactive_missing_fields）增加 fork lease 豁免——判定特征用 claim payload 的 `forkSession === true`（backend placement.py 对 fork lease 恒写 `fork_session=true` 谓词键，非 fork lease 全链无键，比 resumeSessionId 更精确：resume 链还有人格热切换/ worker 重派等非 fork 消费方）。豁免后空 prompt 的 fork lease 正常走 SessionManager.create（其空 firstPrompt 契约已就绪：不挂 10s 兜底、首轮由用户 首问 inject 驱动，session-fork.test.ts 24h 审查 H-2 用例既有覆盖）。守卫仍拦的 早退分支顺带补 notifyRunResult 回报（P2b 同款）——修复生产事故中「认领后裸 return 不回报，run 挂 5 分钟等 300s 僵尸轮清扫」的放大器。 2. **backend 侧（create.py `create_session` 加 `inherited_cwd` 参数 + fork.py 传 `source.cwd`）**：workspace 派生链（inject_gates 仅 workspace_id 在场时落 cwd=ws.root_path）覆盖不到「源会话 cwd 有值但无 workspace」形态（如 platform 会话），此类形态 fork 出的 B 丢 cwd → 断线恢复后 reopen 409 死路（生产事故 0aa54089 父子双双命中）。兜底仅在派生值为 None 时生效（派生优先，不打架）； 源 cwd 本就 None 则透传 None 不伪造——非工作区默认目录分配归 2026-11-06-session-reopen-no-cwd 根治方向，本变更不越界造值。

## D-daemon-069@v1 2026-11-07-orphan-pending-dialog-cure——一个病（孤儿 pending 提问）三个入口，三修同源： - **写侧补挂（FR-01）**：run 终态化 ⇒ 其挂起提问必然无人消费 ⇒ 作废。
状态：implemented
变更：2026-11-07-orphan-pending-dialog-cure
原编号：D-000@v1
锚点：.sillyspec/changes/2026-11-07-orphan-pending-dialog-cure/design.md
文件：backend/app/modules/daemon/lease_service.py, backend/app/modules/daemon/router/session_crud.py, backend/app/modules/daemon/run_sync/service/close_run_steps.py, backend/app/modules/daemon/session/service/control.py, backend/app/modules/daemon/session/service/session_lifecycle.py, backend/app/modules/daemon/tests/test_run_close_cancels_pending_dialog.py, backend/app/modules/daemon/tests/test_sessions_list_pending_dialog.py, sillyhub-daemon/src/interactive/permission-resolver.ts, sillyhub-daemon/src/interactive/session-manager/turn-control.ts, sillyhub-daemon/tests/interactive/turn-activity-watchdog.test.ts
最近确认：ad23bae698ea8b8a43517d17936dc9e759ca7c09
理由：一个病（孤儿 pending 提问）三个入口，三修同源： - **写侧补挂（FR-01）**：run 终态化 ⇒ 其挂起提问必然无人消费 ⇒ 作废。四个终态化挂点各加一行 `cancel_pending_dialogs_for_run(db, run_id)`（既有 helper，幂等、不自带 commit）：① close_interactive_run 主路径（daemon 上报 result 的唯一收口，覆盖 completed/failed/killed——挂点放 `_close_flip_session` 之后、`svc._session.commit()` 之前，随收口事务提交）；②③④ backend 主动 kill 三写点（lease_service._mark_agent_run_killed_if_pending / session_lifecycle._end_session_for_delete / control.py end_session 收口），各自在 kill 写入后、同事务 commit 前补挂。生产 11 条孤儿中 failed 8 条、completed 1 条走①、killed 4 条中存量走②③④，全覆盖。 - **读侧对齐（FR-02）**：session_crud.py 列表 pending_dialog_kind 注入的 subquery 加 `join(AgentRun).where(AgentRun.status.in_(ACTIVE_RUN_STATUSES))`，过滤在窗口函数取「每会话最新一条」之前生效——与详情读侧 list_pending_dialogs 的 ql-20260815-003 兜底完全同口径，列表问号与详情待答卡从此共享同一个「还算数」判定。 - **daemon 看门狗豁免（FR-03）**：PendingEntry 增 `dialogKind` 字段（register 时存入），PermissionResolver 增公开方法 `hasPendingDialogs()`（存在 dialogKind 非空且未 settle 的注册项）；fireTurnActivityWatchdog 在既有双守卫（status=running 且 currentRunId 未变）之后加豁免分支：命中则 console.warn 一条 + `refreshTurnActivityWatchdog` 续防（同窗口重新布防）+ return。选续防式而非 disarm：每个窗口到期自查「还有没有 dialog 在等」，dialog settle 后引擎若挂死（无后续活动续防），下一窗口照常判死——豁免不会变成永久盲区，且不动 dialog settle 路径的状态机（单点改动）。
