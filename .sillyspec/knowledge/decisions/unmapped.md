# 决策知识 — unmapped

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

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

## D-unmapped-033@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-15-pseudo-domain-migration
原编号：D-001@v1
锚点：未记录
最近确认：4b034a03ce257a51d95c741e3ead072ed6427410
理由：最大风险：主域机械裁决的错分（如 ci-recurrence-guard 横断变更落 frontend_components 而非 CI 语义域）——接受：规则与触达路由同源（判定集含 frontend_components 时注入必达），横断变更多域命中下无唯一正确解；人工改判两处已在案。次风险：6 条无变更条目主题判域 daemon 属人工判断——留痕可复议。第三风险：坏段/重复段修复属数据手术——归档真相源核验+段字节级操作+validate ok+git 留痕四重保护。放弃方案：①按条目语义逐条人工判域（436 条不可行）；②保持 unmapped 只设基线消音（用户明示迁真域）；③重蒸馏迁移（归档源改不动）。

## D-unmapped-034@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-15-workspace-session-agent-only
原编号：D-001@v1
锚点：未记录
最近确认：add1712b21ebc572ce84ff4e2436ed07500aba54
理由：**风险（已接受并留了出口）**： 1. 绑定机器离线/不可见时用户「无路可走」——本设计砍掉机器列表（需求要求），但空态文案给出两条恢复路径（启动 daemon / 去工作区页重绑定）。若实测反馈需要临时换机器，后续可在空态加「换机器」降级入口（本期不做，避免破坏「不选机器」语义）。 2. 门户/悬浮宿主沿用非工作区路径的旧直带逻辑未动，两套直带条件并存（工作区=agent 即可，非工作区=machineId+agent）——已在代码注释与 FR-04 显式声明，防后人误「统一」。 **试过但放弃的方案**： - 只改工作区 scope 页、不动全局门户的工作区分组 → 同一动作在不同入口表现不一致，用户会认为「有的地方还要选机器」。 - 后端支持「只传 workspace_id + provider，由后端按 binding 派发机器」→ 改动面扩到后端 placement/inject_gates/契约/gen:types，且前端仍需知道「哪台机器在线」才能给空态指引；本期前端解析 binding 已足够，后端零改动。 - 绑定模式保留「机器」只读展示 + 展开可换机器 → 与「不应该选择机器信息」直接冲突，且增加状态机复杂度。

## D-unmapped-035@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-15-assets-graph-depth
原编号：D-001@v1
锚点：未记录
最近确认：2d3c285319fdf676ddfe02309fe7b19e69e1e48b
理由：- 风险一：深度 2-3 切片节点数可能超 FORCE_NODE_LIMIT=200——GraphCanvas 既有 >200 静态分环降级自动兜住（2026-10-15-graph-type-cluster 语义），组件无需新增护栏；可达性上 depth 3 大仓可能秒级耗时，keepPreviousData 已保证切换期间有内容可看。 - 风险二：keepPreviousData 期间 counts 文案显示旧切片计数——数据到达即原位刷新，短暂陈旧可接受（与 changes 列表页同语义）。 - 试过放弃：①Select 下拉选深度——卡头横向空间紧张，三档 chips 一眼可达（图谱页用 Select 是因为表单还有 sub/edges 多控件，此处只有 depth 一维）；②把 depth 做成资产卡 props 传下来——深度是图谱分区内部交互态，与资产卡取数无关，上提徒增传参链。

## D-unmapped-036@v1 日志源=应用侧落文件+轮转（用户亲选）
状态：implemented
变更：2026-10-15-server-logs-panel
原编号：D-001@v1
锚点：未记录
最近确认：7af8e0e32
理由：用户亲选「落文件+轮转」——logging 配置同时保留 stderr（现状不动，容器日志聚合不受影响）+ 新增轮转文件（5MB×3 备份，RotatingFileHandler 自动清理）；本地开发/Windows/macOS/Docker 行为一致，有历史可查可下载。
故障面：文件 handler 写失败（磁盘满/权限）不得拖垮进程——emit 异常由 logging 模块内部兜底，启动期建目录失败降级回 stderr-only。
退役判据：若未来引入集中日志聚合（Loki/ELK），页面日志卡改为查询聚合后端时本机制可退役。

## D-unmapped-037@v1 展示形式=结构化+自动刷新（用户亲选）
状态：implemented
变更：2026-10-15-server-logs-panel
原编号：D-002@v1
锚点：未记录
最近确认：7af8e0e32
理由：用户亲选「结构化+自动刷新」——默认最近 200 行，随页面 5s 轮询自动刷新；JSON 日志行解析为「时间/级别/事件/详情」结构化展示，点行展开原始 JSON；行数可切 100/500/1000。

## D-unmapped-038@v1 下载范围=单文件可选历史（用户亲选）
状态：implemented
变更：2026-10-15-server-logs-panel
原编号：D-003@v1
锚点：backend.log.1/.2/.3
最近确认：7af8e0e32
理由：用户亲选「单文件可选历史」——下载区提供当前日志文件与轮转归档（backend.log.1/.2/.3）的选择，逐文件下载（不打包 zip）。

## D-unmapped-039@v1 权限=复用 system_status:read（用户亲选）
状态：implemented
变更：2026-10-15-server-logs-panel
原编号：D-004@v1
锚点：未记录
最近确认：7af8e0e32
理由：用户亲选「复用 system_status:read」——日志比性能数字更敏感，但页面本就在系统管理区、受众相同；不新增权限枚举，持 system_status:read 或 platform:admin 即可（端点同挂 require_permission_any）。

## D-unmapped-040@v1 日志落盘实现=单点插入文件写入（用户亲选，方案 A）
状态：implemented
变更：2026-10-15-server-logs-panel
原编号：D-006@v1
锚点：backend/app/core/logging.py
最近确认：7af8e0e32
理由：用户亲选方案 A——在 structlog processor 链 JSONRenderer 之前插入自定义 FileWriter processor（event_dict 先 json.dumps 写轮转文件、再透传 JSONRenderer 输出 stderr）；改动局限 backend/app/core/logging.py 单文件，stderr 输出链路零扰动。
故障面：轮转瞬间的并发写（单进程单线程 event loop 下 logging 同步调用，无并发面）；文件被外部 truncate 时 write 继续追加。
退役判据：同 D-001@v1（引入集中日志聚合后退役）。

## D-unmapped-041@v1 页面布局=日志卡满宽居底（用户亲选）
状态：implemented
变更：2026-10-15-server-logs-panel
原编号：D-007@v1
锚点：未记录
最近确认：7af8e0e32
理由：用户亲选「满宽居底」——删除业务统计卡后页面剩三卡：服务器性能（左半）、依赖与版本（右半或满宽调整）、服务器日志（满宽，页面最下方）。

## D-unmapped-042@v1 日志条数参数与轮转参数的可配口径（AI 定案，可否决）
状态：implemented
变更：2026-10-15-server-logs-panel
原编号：D-008@v1
锚点：未记录
最近确认：7af8e0e32
理由：lines 白名单 {100,200,500,1000}（非白名单值回退默认 200，不报错）；轮转 maxBytes=5MB/backupCount=3 常量于 logging.py 模块级（非 settings 项——避免配置面膨胀，需要时再升 settings）。

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

## D-unmapped-051@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-16-proto-pipeline-discoverability
原编号：D-001@v1
锚点：未记录
最近确认：0e5d3f3b0b49be367746945232dc5ac7a0cb70c3
理由：- 风险1：CONVENTIONS.md 全量重扫覆盖指针节。对策：接受（重扫由人触发且低频；local.yaml 登记位与注释永不丢失，是持久底座）。 - 风险2：YAML 手写缩进错导致解析失败回落未登记态。对策：FR-03 以 readUiPrototypeForm 实测登记成功为验收；失败即修。 - 死路：考虑过把两份规约复制落档到本图 scan 面——放弃：双源必漂移（PROTOTYPE.md 是活文档）；指针优于副本。

## D-unmapped-052@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-16-driver-audit-fixes
原编号：D-001@v1
锚点：tests/agent-detector.test.ts
最近确认：6d2fd757fe62c88c9ddc024cfaa6c90b42e0f077
理由：最大风险：FR-04 让 codex 族 manualApproval=true 会话从恒自动放行变为真人审——行为面变化，若有依赖旧行为（自动放行）的存量 scan 流程会开始弹审批卡。裁决依据：driver-factory 既有注释（"manualApproval=true 时注入"）、基类契约（"driver 读取并据此决定审批行为"）、claude 路为同义行为（canUseTool 人审），三处均指明人审才是设计意图，恒 allow 是接线缺陷而非决策。已用独立测试文件钉住新契约。 试过但放弃：把 manualApproval 映射放在 approvalReady 块外（chat 也显式 false）——放弃，chat 会话 driverOpts 多两键对行为无增益（驱动 `!undefined` 与 `!false` 同真），且扩大 opts 面变更半径；维持「映射只在审批就绪面生效」最小切口。zcode 主循环曾考虑保留 for-await 仅加槽位——放弃，实测（本变更 TDD）证明 for-await 在 close 后仍挂 `next()`，必须改 while 形态才能收敛。 存量损坏顺带修复（收口实测门拦下，非本变更引入）：① `tests/agent-detector.test.ts` 自 329c0e8aa 起语法损坏（13→14 的标题更新被做成「插入新 it( 行」而非替换，3 处悬挂 it 头致缺 3 个 `}`）——tsconfig exclude tests 使 `tsc --noEmit` 全绿假阴性，该文件自损坏起从未被运行；修复=删除 3 个悬挂旧头 + 期望数组补回被误替换的 'dsh'（PROVIDER_SPECS 实序 dsh 在 zcode 前）。② zcode 注册为 fileSettings writer 后触发 provider-adapter-registry 守护③（smokeSuite 须含 API_FORMAT_VOCAB 全部字面量）——补 buildZcodeProviderConfig 真实 api_format→api.type 映射用例（'openai_chat'→'openai-chat-completions' / 'anthropic'·缺省→'anthropic-messages'）满足判据，非塞注释骗静态扫描。

## D-unmapped-053@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-16-archived-files-tab
原编号：D-001@v1
锚点：未记录
最近确认：b5c80978eeff39258d70399f559fa678e3c77c6e
理由：- 风险：归档态恢复「文件与对账」后，范围对账卡在归档态显示降级信息（指路「产出 · 归档留档」）——与用户诉求（归档留档不展示 spec 文档全貌）不冲突：卡内有降级说明，文件树与预览照常可用。 - 试过放弃：仅对归档隐藏「范围对账」保留文件树——放弃：对账与文件树同属一卡拆开会造成半空卡，且用户诉求未要求拆。 - 死路：无（改动面小：visibleTabs 单函数 + page.tsx 挂载条件 + 信息栏入口文案）。

## D-unmapped-054@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-15-session-turn-completion-semantics
原编号：D-001@v1
锚点：未记录
最近确认：fcd4a40489512f45d8e646965833e5e7c13e400b
理由：最大风险：轮次完成依赖活性数据链（daemon 自发现日志 → tailer 推导 → 推送落库 → 前端 30s 轮询），链路断则「跑完无绿点无通知」依旧——用户阿里云实测正是此现象，属部署/数据面问题，本变更不解决链路本身（已在交付说明给服务器排查清单：工作台总览卡有无活性行 → 判别上报链断 vs 关联断）。放弃的方案：a) 给 idle 设时间窗（如 N 小时内算「刚完成」）——引入魔法数且窗口内重复渲染绿点语义含混，改用点击清除的确定性语义；b) 保留红角标只加绿角标——同一行两枚角标且语义重叠（「回来看看」vs「执行完成」是同一事件），用户明确要绿色完成语义；c) 把完成检测全收进面板（连活性转移也面板算）——面板需自维护活性 prevState 副本，与 hook 的 prevState 键双源漂移，不如 hook 单处检测。

## D-unmapped-055@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-16-session-run-status-realtime
原编号：D-001@v1
锚点：未记录
最近确认：3472327464a8e8f9d8829a5e9b35fda123a9b719
理由：最大风险：run 状态回写时机依赖 daemon 回传（run 终态经 daemon RPC/清扫收敛落库）——daemon 半死时 run 可能滞留 running（转圈不停）。缓解：既有 lease 超时/清扫机制兜底收敛；且终态权威（ended/failed）与活性兜底信号不受影响。放弃的方案：a) 按用户最初设想做「交互触发按需查询 daemon 推导」——需要新 RPC + daemon 在线，平台派发会话本就有后端权威 run 状态，绕远路；保留为本地会话未来的可选增强。b) 前端单独拉每会话 run 列表端点——N+1 请求放大，列表批量注入一条 SQL 更优。c) run 状态直接写进 AgentSession.status 列——混淆会话生命周期与轮次执行两层语义（一轮跑完会话仍 active），动 ORM 需迁移。

## D-unmapped-056@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-15-server-logs-dockerfile-fix
原编号：D-001@v1
锚点：未记录
最近确认：145bd757934b3ecdf4dc33f855f937b1000cb9f8
理由：最大风险：已部署的服务器若以 bind-mount 覆盖 /data（宿主目录属 root），镜像内 chown 不生效——预建目录会被挂载遮蔽，仍可能权限被拒；此时降级警告（修复②）会在容器日志里明示原因，按日志处置（宿主侧 chown 或配 log_dir 指向可写路径）。放弃的方案：改 docker-compose 加 volume 挂载日志目录——引入部署编排变更且服务器侧需手工迁移，超出「镜像自包含」修复边界（如需持久化日志到宿主，后续独立变更处理）。

## D-unmapped-057@v1 落选——方案 C（进程内卸载 + 拉长轮询 + 缓存）
状态：rejected
变更：2026-10-16-backend-mem-polling
原编号：D-003@v1
锚点：未记录
最近确认：439cdc46c
理由：落选。进程内 del+gc 卸载方案。
否决理由：onnxruntime/Python allocator 进程内卸载不保证归还 OS（arena 棘轮），非确定性根治；轮询拉长恶化派发延迟。
复潮条件：无（机制性不可靠，非场景性劣势）。

## D-unmapped-058@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-16-deploy-convergence-guard
原编号：D-001@v1
锚点：未记录
最近确认：d581d40b43ea8078957e915ff68709fb9f082b94
理由：最大风险：闸门挡不住「两个会话都从 main 打包、先后部署」的时序互覆（后部署者覆盖先部署者——若两者都是 main 且后者更旧则仍回退）。兜底：§0 的部署后 commit_sha 核对能立即发现；彻底解（部署互斥/登记表）留待需要更多实证后做。放弃的方案：a) 只改 skill 文档不加脚本闸——事故证明纯约定无效（并行会话各行其是），机械闸必须；b) 部署登记文件 .last-deploy 比对——需要 load-and-up.sh 也改+跨会话写同一文件，复杂度高于本次 thin 边界，列为后续。

## D-unmapped-059@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-16-change-files-sync-result
原编号：D-001@v1
锚点：未记录
最近确认：7ca3e7ba66d5d065715a08ea885d064b2617e3e9
理由：- 最大风险：15s 预算让「刷新」在同步窗口内最长等 15s（原 3s 秒回旧数据）——用「等待换正确」；极端大仓首同步 >15s 仍会超时，但 daemon 侧继续完成、防抖 TTL 内重点秒回新数据（有明确降级路径，不卡死）。若未来实测普遍 >15s，应改异步推送而非继续加预算（本变更未做，留作后续观察项）。 - 死路（已否决，勿复潮）：fire-and-forget + 前端二次刷新启发式（2026-10-13 D-006@v1）；新增显式 POST 同步端点（D-007@v1）；「继续 3s 只补日志」——治不了「刷不到」主诉，只增排障信息，不采。 - 运维同根因（服务器属主漂移致 spec-sync 500）属部署面，已由 ops 修复 + deploy skill 探针守护，代码面不做属主自动修补（越权面）。

## D-unmapped-060@v1 sessions 表增 family_id 列建模会话族
状态：implemented
变更：2026-10-16-fix-auth-random-logout
原编号：D-001@v1
锚点：未记录
最近确认：d43971698
理由：我的判断：sessions 表新增 nullable UUID 列 `family_id`。login 签发时生成新 uuid 作为族根；refresh 轮换/grace 续期签发的新 session 继承被消费 session 的族（`family_id ?? id` 兜底存量 NULL 行——旧行自成一族）。族查询条件 `user_id=? AND revoked_at IS NULL AND (family_id=? OR (family_id IS NULL AND id=?))`，复用既有索引 ix_sessions_user_revoked，不加新索引（每用户 session 行数少）。迁移走 alembic 增量加列（PPM 已上线有生产数据，禁重置；加列 nullable 零停机零强制登出）
故障面：family_id 写错族会把无关设备牵连进吊销面（与旧全吊销等价），靠 FR-02 测试族隔离性兜底
退役判据：若未来引入服务端全设备会话管理 UI 且要求误杀面趋零，可评估改为「复用检测仅拒绝不吊销」

## D-unmapped-061@v1 refresh 复用检测从全用户吊销改为族级吊销
状态：implemented
变更：2026-10-16-fix-auth-random-logout
原编号：D-002@v1
锚点：未记录
最近确认：d43971698
理由：用户已定向（「复用检测只吊销会话族」）：复用检测分支改调新增的 `_revoke_session_family(user_id, family)`，只吊销该 token 所属族系（含其后代——攻击者用窃取 token 轮换出的新 session 同族，同样被灭，安全属性保留）；其他设备/其他登录族不受影响。`revoke_all_user_sessions` 方法保留（改密码场景 service.py:243 注释已说明另有内联实现；admin/settings 端点走 UserService.revoke_all_sessions 不受影响）。AuthRefreshReused 报错文案同步改「该设备登录已注销」（原「所有会话已注销」不再准确）
故障面：攻击者在 grace 窗内重放仍可得新对（既有 grace 权衡，不变）；grace 窗外重放只灭单族，若攻击者已独立另行登录（异族）不受牵连——可接受（异族本就是合法登录）
退役判据：出现实际窃取事故且需要全设备熔断时，可配置回退全吊销

## D-unmapped-062@v1 grace 宽限窗默认 60s → 300s
状态：implemented
变更：2026-10-16-fix-auth-random-logout
原编号：D-003@v1
锚点：未记录
最近确认：d43971698
理由：我的判断：`auth_refresh_grace_seconds` 默认 60 → 300（config 上限 le=600 内）。依据：休眠唤醒/后台标签页节流恢复后旧 token 复用常超 60s；300s 覆盖典型恢复窗口，且族级吊销上线后超窗误杀的爆炸半径已缩到单设备，双保险。攻击者在窗内重放可换新对是既有权衡，内部平台威胁模型可接受

## D-unmapped-063@v1 前端 doRefresh 按状态码分流——5xx 抛错不清会话
状态：implemented
变更：2026-10-16-fix-auth-random-logout
原编号：D-004@v1
锚点：frontend/src/lib/token-refresh.ts:86
最近确认：d43971698
理由：用户已定向（「对 5xx 不清会话」）：doRefresh 分流——2xx → 返回 token 对；401/403/其余 4xx → 返回 null（上层 clear+redirect，明确失效）；5xx/408/429 → 抛 ApiError（对齐 ql-20260917-005 timeout 先例：抛错路径不清会话、不跳登录，调用方 catch 展示可重试错误）。app-shell.tsx:216 主动续票已有 .catch(() => {}) 兜底；api.ts 401 收口处 await 抛错时原 401 ApiError 被 refresh 错误替代传播（与 timeout 行为一致）
故障面：5xx 时原 401 错误被替换为 refresh 5xx 错误展示（与 timeout 先例一致，可接受）；瞬时 5xx 期间页面报错但登录态保留，恢复后自愈
退役判据：后端或代理层能保证 refresh 请求不经受 5xx/网络抖动窗口（如本机直连）时，可收敛为单一 null 语义

## D-unmapped-064@v1 根因一实现方案选 A（会话族吊销 + 宽限窗加大）
状态：implemented
变更：2026-10-16-fix-auth-random-logout
原编号：D-005@v1
锚点：未记录
最近确认：d43971698
理由：用户选 A：sessions 加 family_id 建模会话族，复用检测只吊销该族（窃取凭证换出的后代同族同灭，安全属性保留），宽限窗 60→300s 双保险。理由要点：B 治标（全吊销语义未变，超 600s 上限仍团灭）；C 丢失窃取响应（纯拒绝弱于 BCP 族级吊销标准）
故障面：family 谓词或族继承写错时，误杀面在「全用户」与「单设备」之间漂移（靠 FR-01/FR-02 测试网兜底）
退役判据：OAuth BCP 实现升级为服务端 per-token introspection 后可重估

## D-unmapped-065@v1 方案 B（只加大宽限窗，不加族系列）
状态：rejected
变更：2026-10-16-fix-auth-random-logout
原编号：D-006@v1
锚点：未记录
最近确认：d43971698
理由：落选：一行配置改动最小，但「全用户吊销」语义未变——休眠/离线超过宽限上限（config le=600 即 10 分钟）仍全设备团灭；且单纯加宽窗口给真实窃取者更长重放窗口，治标不治本
否决理由：全吊销语义未根除，仅推迟触发；安全与可用性双输
复潮条件：若后端禁止 schema 变更（如生产库冻结期）且急需止血，可作为临时缓解先上线

## D-unmapped-066@v1 方案 C（复用检测只拒绝不吊销）
状态：rejected
变更：2026-10-16-fix-auth-random-logout
原编号：D-007@v1
锚点：未记录
最近确认：d43971698
理由：落选：误杀面归零且零迁移，但丢失对凭证窃取的安全响应——OAuth BCP 对 refresh 轮换复用的标准响应是吊销 token family，纯拒绝使攻击者已换出的新凭证不受影响，安全姿态弱化
否决理由：安全响应弱于 BCP 族级吊销标准
复潮条件：平台威胁模型明确接受弱响应（如纯内网无外部暴露）且要求零 schema 变更时

## D-unmapped-067@v1 族吊销必须内部 commit（执行期裁决，纠正 design 笔误）
状态：implemented
变更：2026-10-16-fix-auth-random-logout
原编号：D-008@v1
锚点：未记录
最近确认：d43971698
理由：内部 commit（对齐 revoke_all_user_sessions 既有语义）。依据：复用分支 UPDATE 后立即 raise AuthRefreshReused，而 get_session 依赖对异常路径 session.rollback()（backend/app/core/db.py:163-167）——不先行提交则族吊销被回滚成空操作（安全响应静默丢失）。design.md 对应措辞已同步修正

## D-unmapped-068@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-16-agent-session-field-pin-sync
原编号：D-001@v1
锚点：未记录
最近确认：cd5c6760fd82584b7b25b8e8d89947f6360a55b6
理由：最大风险：钉子与真实模型再次漂移（后续给 agent_sessions 加列的人再次漏更）——护栏恰是本钉子自身（届时实测门会再拦，按本次同款流程补钉即可，local.yaml 豁免仅作过渡不长期留存）。曾考虑的替代方案：把字段集断言放宽为"包含关键列子集"以降低维护成本——放弃：钉子的价值恰在精确集，放宽即失去"未登记列变更"的探测能力。

## D-unmapped-069@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-16-daemon-pull-antiresurrect
原编号：D-001@v1
锚点：未记录
最近确认：056cff30397de0c5001874901cbbe03d6319df65
理由：- 最大风险：**误抑制**（用户删除后又在秒级窗口手工恢复同名文件，pull_start 现算的抑制集会把 bundle 版本挡掉）——与 CLI 同构接受（窗口极窄，且有 restoreDeleted/env 显式恢复通道兜底）。 - 次风险：manifest 长期失真（如历史版本缓存含已不在同步面的路径）导致抑制面偏大——已用 `isUploadExcludedPath` 同口径过滤 + 「删除上行成功自然衰减」收敛；且只影响 pull 恢复面，不损伤任何现存文件。 - 首版缺口（独立评审 P2 实证，已修复）：首版只读 manifest、落地重建不并回被抑制行——delete op 生成条件「缓存有/盘面无」随重建断裂，抑制只活一个 pull 周期，第二次自动 pull 复活照旧。修复：落地重建时并回被抑制行（FR-04 持久性语义），新增第二次 pull 持久性测试断言。 - 试过但放弃：①改 `extractTar` 加 skip 参数（侵入面大、in-place 兜底仍需补刀）→ 放弃，改为解包后对命中路径 rm（两路径统一、签名不动）；②在 `hasUnsyncedLocalChanges` 加删除检测（pending/mtime 信号反推）→ 放弃，删除检测本质需要基线快照，重复造 manifest 已有的能力且动既有判定函数风险更高；③照搬 CLI 在 rm 前读基线文件的形态 → 放弃，daemon 的 manifest 缓存已是等价基线且生命周期管理（pull/push 双点回写）更完备。

## D-unmapped-070@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-16-change-center-back-keeps-list-state
原编号：D-001@v1
锚点：未记录
最近确认：3963621a86777b6dc2696f5118a8f1fa1125edc2
理由：- **风险①（已知取舍）**：`history.length > 1` 判定在「从站外页点链接进详情」场景会 back 回站外页——内部工具场景罕见，且符合浏览器标准「返回」语义；Next 14.2.5 的 history.state 无可靠栈深标记（idx 为 Next 15+ 字段），无法精确判定「上一条是否本站」， 接受该取舍。 - **风险②**：原生 replaceState 后浏览器「后退」退出列表（不回溯列表内翻页历史）——与 改造前行为一致（useState 翻页本就不产生历史条目），非行为退化；URL 与 UI 的瞬时不一致 仅出现在列表页内按浏览器后退的瞬间（随即整页离开列表），用户实证范围内不可见。 - **死路 A（放弃）**：router.replace 写回——每次翻页触发 RSC 导航请求（页面是 server component 树根），快速翻页产生请求风暴且可能互相竞态。 - **死路 B（放弃）**：sessionStorage 记「最后列表 URL」——多标签页隐式共享面、SSR hydration 需要挂载后二次渲染切 href，复杂度高于收益。 - **死路 C（放弃）**：详情页 URL 反向携带列表 query——污染详情 URL（分享/收藏语义脏）， 且从工作区首页等非列表入口进详情时无 query 可带。

## D-unmapped-071@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-16-change-title-condense-backfill
原编号：D-001@v1
锚点：未记录
最近确认：26271e914c9bd670faf2da32ab0851025c5e6598
理由：最大风险：提炼结果语义跑偏（标点切断点选错把句子切成病句）。缓解：强边界（句读完整处）优先、必须带 [10,30] 内取首个边界、本仓实证坏样本全部进单测人工核过产出；且 title 只是展示面，错了可由人工改名端点（FR-05/06）随时纠正——这也是补改名能力的动机：提炼是兜底自动化，最终命名权在人。 试过放弃的方案：(a) 在前端展示层动态截 title——治标不治数据，详情页/搜索/通知等其余消费面仍旧烂，弃；(b) 回填脚本去工作区盘上重读 proposal.md 取动机——读盘逻辑与 reparse 职责重叠且工作区可能已迁移/不可达，description 列已是同源提取结果，弃；(c) 放宽收养守卫让 CLI 短标题覆盖平台已有语义标题——动 2026-09-30-title-adopt-clobber-guard 的防回翻语义，影响面大，存量修复不需要它，弃；(d) 复活 change:update 权限做改名——该权限 2026-10-08 刚因零消费被清理，改名复用删除端点已验证的 owner OR CHANGE_ARCHIVE 三元组（与用户点名组完全一致），弃。

## D-unmapped-072@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-16-change-center-delete-back-keeps-state
原编号：D-001@v1
锚点：未记录
最近确认：7da2c5633e9545629ed1e8967bbeba405e4a1055
理由：- **风险①（已知取舍）**：history.length>1 判定在「从站外页进详情后删除」场景 back 回 站外页——与上一变更 BackToListLink 同款取舍（Next 14.2.5 无栈深标记，内部工具罕见， 标准返回语义），接受。 - **风险②（已知取舍）**：bfcache 恢复路径下列表数据短暂陈旧（已删行可能闪现一帧，随后 focus refetch 收敛）——跨 document 无法主动失效，与现状删除行为一致，非本变更引入。 - **风险③**：钳回与 URL 写回的时序——真实路径下进详情前列表 URL 已是超界态 （如 ？page=5，上一变更写回 effect 落的），back/整页载入挂载后写回首跑同址跳过； 数据到达后钳回 setPage(4) 再写回 ？page=4，URL 一次翻转、终态正确，窗口小于首查 往返时长，接受。（评审 P3 修正：原稿误写为挂载写回先落 ？page=5——挂载首跑同址 跳过，不存在该额外动作。） - **死路 A（放弃）**：详情页删除后 push 带 query 的列表 URL——详情页不知道来路列表的 tab/page（无 channel），伪造默认状态等于维持现状 bug。 - **死路 B（放弃）**：删除后一律回第 1 页——用户在归档区第 5 页连续清理时每次被甩回 首页，体验差且与「返回保状态」诉求相悖。

## D-unmapped-073@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-16-pg-index-local-followup
原编号：D-001@v1
锚点：未记录
最近确认：08aa9fa699db804e74b848e3aa801de390550c08
理由：最大风险：补记落 uncategorized 暂存域，未被分类吸收前检索命中率依赖关键词；缓解——小节标题复用事故条目核心词（索引静默损坏/amcheck/归档后仍进行中），与原条目同主题可串联检索。死路：改写既有生产条目把本地数字并入——已放弃，违反 FR-02 且抹掉两次发病的实例差异（需去重 vs 免去重），而该差异恰是「容器被杀风暴后遗症」家族谱系里最有复用价值的分叉知识。

## D-unmapped-074@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-16-knowledge-module-card
原编号：D-001@v1
锚点：未记录
最近确认：cc1c9a3f91f025c3685e89bf4416c635aef318d6
理由：最大风险：`_module-map.yaml` 头部标注 generator: sillyspec-scan——后续重跑 scan 若全量重生成可能冲掉手改条目；缓解：文件头同时注明「可手动修改」，scan 为 advisory 流程（人工确认后才落盘），且本条目 paths 是 scan 无法推导的规范资产域（scan 只扫代码路径），冲突概率低。死路：手工把 3 条 FR 剪切粘贴到新文件并自行重编号——已放弃，违反迁域不换号铁律（ID 是绑定/supersede 链寻址键），且伪域文件清理状态（清空 vs 移除）手搬无法与 CLI 的 fr-index 幂等提炼状态机对齐。

## D-unmapped-075@v1 rejected 方案 B——后端聚合端点 GET /sessions/{id}/decisions
状态：rejected
变更：2026-10-16-session-decision-pill
原编号：D-006@v1
锚点：未记录
最近确认：7083eb2b2bd5c6cffe84962df65bbda379485f26
理由：（落选）
否决理由：跨模块后端改动（daemon 模块 + OpenAPI + 前端/daemon 双端 gen:types 义务）与功能价值不成比例；普通审批在后端内存态重启照丢，聚合收益有限
复潮条件：决策数据需要刷新强一致（含内存 pending）或移动端/第三方也要消费会话决策聚合时

## D-unmapped-076@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-16-decision-pill-no-workspace
原编号：D-001@v1
锚点：未记录
最近确认：256aa6feb2c4349f3d4a1b513e94fb9fa5fddd0e
理由：最大风险：无（渲染条件放宽面极小——待决策 pill 自带三类全空渲染 null 的显隐门）。放弃的方案：给老会话回填 workspace_id（数据修复面大且改变会话归属语义，否决——显隐不应依赖归属字段完整性）。

## D-unmapped-077@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-17-audit-risk-followup
原编号：D-001@v1
锚点：未记录
最近确认：7faec5bfa12ed2e7159077f469589243fb36ee5b
理由：最大风险：FR-04 时机后移后，pre_swap 至抑制应用之间若「已删」文件被重建，落地的是 bundle 旧内容（覆盖重建内容）——但重建内容已经 pre_swap 在服务器留底、下跳心跳拉齐自愈，无净丢失，与既有「窗口写入」语义一致，非新引入风险。试过但放弃：在抑制应用处对「窗口内重建」做内容级区分（bundle 旧内容 vs 重建内容择优保留）——需缓存窗口内写入快照并做内容合并，复杂度与收益不成比例。CLI 仓（sillyspec da8d2449 同构移植）的同类残余窗口留待后续变更同构收口。

## D-unmapped-078@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-17-zcode-provider-config-shape
原编号：D-001@v1
锚点：未记录
最近确认：40217abbd7f2a0d0cac4d6af1e0f784f68e21689
理由：最大风险：引擎版本演进改目录推送时序或 setModel schema（如将来允许字符串/免 reasoningLevel）——60s 窗口与 levels 提取按当前实证形状钉死，引擎升级需回归（MIN_VERSIONS zcode (0,16,9) 已有版本门兜底）。已试并放弃：裸 setModel 兜底重试（引擎对象路径缺 reasoningLevel 恒拒，重试无意义）；setModel 前置到会话空闲期后台执行（engine 默认模型不保证等于平台路由模型，turn 1 可能脱路由——保持阻塞确定性优先）。

## D-unmapped-079@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-17-dsh-rc2-protocol-fix
原编号：D-001@v1
锚点：未记录
最近确认：162dbfefd8fa71afb10e792dc493c59dfaae4c0b
理由：最大风险：dsh 后续 rc.x 再改 schema（alpha 通道本质）——非致命降级兜底使其退化为「默认模型 + warn」而非会话死亡；overlay（llm-pi-ai 路由）对 rc.2 的适配是独立后续任务（与本修复解耦）。已放弃：版本回 pin（npm latest 即 rc.2，next 线 0.2.1-rc.1 同代 schema，无更稳旧版可退）。

## D-unmapped-080@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-17-dsh-rc2-routing-restore
原编号：D-001@v1
锚点：未记录
最近确认：3fe545c63a4538a83f96a965c92579982bd388e9
理由：最大风险：dsh 下个版本再改 compatProfile/valueId 形状——探针脚本 + configOptions 运行时可观测（模型目录出现/消失一目了然），回归成本低。已放弃：保留 compat 块仅修正漂移字段（rc.2 schema 字段集未文档化，逐字段试探成本高于整块去除——catalog 默认值由引擎按 api 协议自动补齐，语义无损）。

## D-unmapped-081@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-17-session-replay-pingpong-fix
原编号：D-001@v1
锚点：未记录
最近确认：ec360c91bacb3ba997a8249f7c3e6d015d2f3e78
理由：最大风险：比较漏判让乒乓换个字段复活。user 若未来从扁平对象演化为嵌套可变对象，现行「键排序后序列化」只对顶层键排序、不递归——需升级为递归 canonical（或改存单调版本号比对），session.test.ts 的键序用例会先红提示。 放弃的方案：①自定义 storage 包装层做写前去重——改动所有落盘路径，风险大于收益；②比较完整信封原始字符串——两端内存 user 对象键序不同会令字符串恒不等，乒乓换字段复活；③给 (dashboard)/layout 的 fetchMe 加节流——只治标，每秒 10+ 次 setItem 的写盘风暴仍在。

## D-unmapped-082@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-17-session-envelope-rev-stale-guard
原编号：D-001@v1
锚点：未记录
最近确认：166ea374aaa46cc0045c43bb4cb71a25e87063fa
理由：最大风险：rev 分叉后同 rev 异内容互相覆盖出现「状态回摆」——分析后不成立：等 rev 内容比对必收敛到后写盘值，且真实 token 变更前总有一次网络往返（续票/登录），窗口内双写概率趋零；即便发生也是一次往返内自愈，非环。 放弃的方案：①用 Date.now() 时间戳做序——同机时钟看似可行，但测试确定性与「用户回拨系统时间」边缘不可控，计数器更简单；②在 persist 外再包自定义 storage 做写前去重——改动所有落盘路径，风险大于收益；③维持现状只记风险——幽灵复活虽罕见但后果（看似已登出实则持有撤销会话）难排查，趁 P3 记忆新鲜收口。

## D-unmapped-083@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-18-audit-log-redact-yaml-quote
原编号：D-001@v1
锚点：未记录
最近确认：60f8d9e41e2ccb9446325a0679f0fb6a5ec2c31e
理由：最大风险：userinfo 打码正则漏形态。正则取 `scheme://` 后不含 `/`、`@`、空白的第一段为 userinfo（覆盖 `user` 与 `user:pass`）；用户名含 URL 编码 `%40` 时不匹配、原样输出——残余暴露面收窄但未归零（与 KEY/TOKEN 整值红action 的严格度差异在函数注释声明）。已放弃方案：a) PROXY 键整值 `<redacted>`——丢 host 诊断价值，与该日志存留目的冲突；b) YAML 双引号 + JSON.stringify 转义——对控制字符更严但转义面大，无需求支撑。

## D-unmapped-084@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-18-change-type-git-conventional
原编号：D-001@v1
锚点：未记录
最近确认：261a333678e8722856b7120606385f52e31e8579
理由：最大风险：提交归属误判。两类实证坑已堵——① 跨变更引用（提交信息正文提及评审 出处变更 key）：按「信息中**最后一个** key 形态 token」归属，不按出现过即归属； ② CLI 基线检查点提交 `sillyspec: baseline checkpoint for <key> …` 的 `sillyspec:` 撞 conventional 前缀正则：类型白名单（feat/fix/perf/refactor/test/docs/style/ build/ci/chore/revert）外一律不认。残余面：变更唯一提及在 release-notes 类提交 里 → 归 docs（可接受，此类变更本就是文档面）；老变更提交不带 key（215 个 no_match）→ 不猜不写，保持现状显示。 试过放弃：A. 平台侧解析 timeline.md 提交锚——主提交只有裸哈希无标题，判不出 fix（实证：session-envelope 会错判 docs）；B. 标题/动机关键词推导——「防迟到旧值 覆盖」类中文概括无稳定关键词，猜错比不猜伤害大；C. 新增平台端点直写类型——要动 鉴权/审计面，而 spec-sync 镜像通道现成且 reparse 已消费该目录。

## D-unmapped-085@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-18-change-list-type-filter
原编号：D-001@v1
锚点：未记录
最近确认：857d8af461ea4aa3705016087c3d9124105a3180
理由：最大风险：筛选值集与展示映射漂移（feat↔feature 口径在后端 aliases、前端 COMMIT_TYPE_DISPLAY 两处维护）。缓解：两端各有测试钉（后端 feat 等价命中用例 / 前端 feature→feat 显示用例），且值集注释互指对方为权威。残余面：TYPE_OPTIONS 未 列 ci/revert/quick（防下拉过长），后端白名单仍可筛——深链手输 URL 可用，下拉不可 选，属有意取舍。 试过放弃：A. 类型筛选复用 lineage 的「全局集合→SQL IN」两阶段——类型是列值非 投影字段，直接 where 即可，无需两阶段；B. 前端本地过滤——total/分页会错 （pending_review_only gap② 前车之鉴），必须服务端筛。

## D-unmapped-105@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-16-session-pill-dock-drag
原编号：D-001@v1
锚点：未记录
最近确认：f0ba3f3fb30b7b0743ad3265a86578205a46ed43
理由：最大风险：拖拽与点击手势冲突（按住 pill 移动一点算点击还是拖拽）。口径=位移阈值 6px（小于阈值放行 click）+ 松手后 250ms 吞 click 时间窗（比布尔位稳：拖出元素外松手 click 不触发，布尔位会误吞下一次真点击）——两者均沿用悬浮球实测过的先例。 试过但放弃：a) pointer capture 实现拖拽——jsdom 无实现（测试不可达）且 capture 会劫持 click 目标破坏 pill 点击；b) 拖动过程每次 setPos 都持久化——localStorage 高频写（悬浮球现状），改为松手单点写；c) 保留 hover 双触发——用户明确要求纯点击防误触；d) 沿用挂载点 absolute 容器改竖排——拖不出面板且受祖先裁剪，改 portal body fixed。

## D-unmapped-106@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-16-provider-switch-transcript-sanitize
原编号：D-001@v1
锚点：未记录
最近确认：030eceeece1388442415e8cd66c3cd3cc443083d
理由：- **最大风险**：把「工具块」降级成 text 块会改变历史的结构语义（模型看到的是一次纯文本陈述而非工具调用）。 影响面评估：本次实证的私有块 `input` 为空、价值全在结果文本里，文本形态保留了全部信息，且优于 「换供应商后该会话永久 400」。 - **死路 1（放弃）**：请求期代理改写——需要 daemon 代理全部 anthropic 流量，性能/安全/越权面不可控。 - **死路 2（放弃）**：直接删除脏块所在记录——会打断 `uuid`/`parentUuid` 链，CLI resume 可能失配； 改为「替换成 text、记录条数不变」。 - **死路 3（放弃）**：直接删私有块、结果文本丢弃——丢上下文且无必要，文本化成本更低。 - **遗留（明确不在本变更范围）**：本机默认会话 + 用户手改宿主机 `~/.claude/settings.json` 换档的路径， 平台无任何变更信号可挂钩，自动化清洗不覆盖；本变更以「分类器可读提示 + 一次性修复实证（task-02）」 兜底，后续如需自动覆盖需单独立项（涉及平台是否代管宿主配置的取舍）。

## D-unmapped-107@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-19-host-settings-live-reload
原编号：D-001@v1
锚点：未记录
最近确认：e5a2c7ee31881d2d20c3f831c729ca01c07a81e5
理由：- **最大风险**：换档瞬间的批量重载会让所有本机默认会话引擎各重启一次（每个约 1-3s、各会话独立 并行）；正在等用户输入的会话无感（下一轮才用新引擎），运行中会话延迟到轮边界。可接受——比 「模型烙死 + 跨供应商 400」轻得多；且有关闭阀。 - **风险 2**：若用户以非 cc-switch 方式频繁改 settings.json 的 env 块（如脚本），会周期性触发重载。 去抖（两拍一致）+ 3s 节拍已把频率压到「真实变化」粒度；重载本身幂等无害。 - **死路 1（放弃）**：daemon 注入 env 覆盖模型/网关——平台不知道宿主档位语义，且实验实证 settings 的 base_url 本来就每轮热生效，注入反而制造新的钉。 - **死路 2（放弃）**：fs.watch（事件式）——Windows 下 cc-switch 若走替换写会掉 watch/漏事件， 还需目录级 watch 兜底；轮询+指纹在 2-6KB 文件上成本可忽略且行为确定（跨平台一致性优先， CLAUDE.md 规则 13）。 - **死路 3（放弃）**：只做 UI 提示不改行为——用户已明确要免手动处理。 - **遗留（明确不在本变更范围）**：宿主机档位变化对「运行中那一轮」仍不生效（轮边界语义，与平台内 切供应商一致）；`/model` 钉在重载后清零属预期副作用（正是解钉手段）。

## D-unmapped-108@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-19-host-settings-reload-latency
原编号：D-001@v1
锚点：未记录
最近确认：ee8bc717b7b00bcc4e78a5e1da5788638735b776
理由：- **最大风险**：空转读文件频率 ×3（每秒读 2-6KB + JSON 解析）。量级可忽略（单核微秒级）， 定时器仍 unref；接受。 - **风险 2**：重载风暴更密（用户连续快速换档时，每 2 秒可触发一波）。上一变更已论证 per-session 串行 + 覆盖写幂等承载得住；去抖两拍本身就是节流。 - **死路（放弃）**：去抖单拍化（见做法概述）；fs.watch（同上变更死路 2）。 - **遗留**：UI 可感知提示（切换时平台界面出 notice）需 daemon→backend→frontend 三端契约 （新端点 + SSE 帧 + 类型再生成），本变更明确不做，留待单独立项。

## D-unmapped-086@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-19-assets-audit-expand-toggle
原编号：D-001@v1
锚点：未记录
最近确认：c86998d373e27dba83a1ff8c4e7ed39924cad0c8
理由：最大风险：展开 180 条时卡片自然高度变得很长——但这是六组统一形态的设计决定（design.md「自然高度 + 展开全部」取代内滚），其它组同样如此，本修复不改该决定。试过但不做：给清单恢复组内滚动/固定高度——正是 2026-10-15 改版明确否掉的旧形态（多内滚小窗是「乱」的主要来源），回退会造成 audit 组与其它五组形态分裂。

## D-unmapped-087@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-19-shared-agent-onboarding-hint
原编号：D-001@v1
锚点：未记录
最近确认：fc51c25c69c3ea98a401554b486d58d256156be4
理由：最大风险：把「机器数据加载中」误判为「无机器」而错误默认选中——以 `data != null` 守卫消除（loading/error 均 undefined → 门控 false）。 试过放弃的方案：①复用 `machines` prop 判定——无 loading 语义有误判窗口，且依赖门户传参形态，放弃；②把引导提示塞进 SessionConfigBar 内部——该组件是会话内配置面（真会话/预会话共用），预会话引导属页面语义，改共享组件还会扩大既有测试面，放弃。

## D-unmapped-088@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-19-hide-shared-profile-in-session
原编号：D-001@v1
锚点：未记录
最近确认：4d992afc3f615222da8f0017cd75303fd4777cf8
理由：最大风险：真会话隐藏后，用户想在中途把普通会话「升级」为共享智能体会话无入口——这是刻意边界（共享智能体环境是创建时服务端强制的钉定+约束，中途切入既然后端也不会生效，隐藏正是对齐真实语义）；需要共享环境应新建会话。放弃的方案：①按名称过滤——用户明确指出名称不可靠，必须按 active 列表 id；②提升到机器/智能体选择层——改动面与 thin 不匹配（见做法概述）。

## D-unmapped-089@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-19-platform-auto-commit-type
原编号：D-001@v1
锚点：未记录
最近确认：44f12324e768fad638b278a57a46073d566cdbd6
理由：最大风险：timeline 口径与 git 口径分歧（27%）造成「同类变更不同来源类型不同」的 观感。缓解：生产链路上每变更只有一种来源生效（有回填 → flow-state 优先；无回填 → timeline），不存在同一行两口径交替覆盖；分歧样本语义核验 timeline 不劣（git 口径 会被后补提交带偏）。watcher 盲窗导致锚缺失 → None 回落不猜。 试过放弃：A. 排除工件性 scope（docs(spec)/chore(archive)）提升一致率——实验发现 分歧主因是口径哲学非工件噪音，且 git 对照口径本身含噪，不值得为对齐一个含噪基准 加规则；B. daemon 控制命令通道（平台下发 git 提取命令）——覆盖面更全但异步回传 + 离线重试复杂度高一个量级，留作中期备选；C. 等 sillyspec CLI flow done 写类型—— 用户明确不改 CLI，平台侧自闭环。

## D-unmapped-090@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-19-change-list-created-sort
原编号：D-001@v1
锚点：未记录
最近确认：e935e8c671e20cda72d65ea44ebbe9adb65b0d47
理由：风险：默认排序变化改变用户既有习惯（最近活动 → 创建时间）——正是用户主动要求， 非回归。created_at 与 updated_at 在 reparse 回填 mtime 时的差异：created_at 是 建行时刻（CLI 创建顺序），语义即用户诉求。放弃方案：改后端缺省值——会波及全部 不传 sort 的调用方（change-autolink 等），契约面无谓扩大。

## D-unmapped-091@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-19-knowledge-inbox-triage
原编号：D-001@v1
锚点：未记录
最近确认：db6542205b5982cd4adc16dc5af45b316446a8a8
理由：- 风险①：INDEX 锚点 slug 手写错 → 索引断链。对策：用 node 脚本按 GitHub slugger 规则（小写、去非常量词符、空格→连字符）对 16 个标题生成锚点再写入，`knowledge validate` 兜底。 - 风险②：并行会话的 INDEX.md hunk 被我扫入提交。对策：显式 pathspec + `git diff --cached --name-only` 全量核对 + 临时回插隔离（见并发问 2），提交后核对工作区恢复其未提交态。 - 风险③：分类归属争议（如 node_modules junction 事件可归 known-issues 也可归 sillyspec-gotchas）。对策：按「与既有同族条目聚簇便于检索」原则定（junction 族→sillyspec-gotchas），争议归属在设计期即定死，收口不再摇摆。 - 放弃方案：走 `sillyspec knowledge propose` 逐条提议再人工合并——propose 仅写 `proposed/` 待人工审核，会产生 16 条待审噪音且仍需人工逐条合并，不满足用户「清账」目标；用户本次指令已明确授权直接归类，且直接编辑分类文件有 2026-09-28-knowledge-inbox-clear 同款先例，故放弃 propose 通道。

## D-unmapped-092@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-19-knowledge-search-build-switch
原编号：D-001@v1
锚点：未记录
最近确认：54a1e8db39d4d8ac991d645e2942a370d146e4ff
理由：- 风险①：默认值写错（如 False）会让所有部署静默失去懒建库。对策：默认 True + FR-02 用例③显式回归「缺省=仍建库」。 - 风险②：`reason="index_not_built"` 语义与 `model_ready=False` 的既有口径（「语义模型不可用」）有细微偏移——此处模型可能可用但索引缺失。裁决：沿用该字段（schema 注释已写「model_ready=False + results 纯词面 + reason 带因」的 fail-soft 语义，reason 词表扩一个值），文档同步说明。 - 风险③：关闭时跳过差量 sync，state 行存在但指纹过期的 ws 会静默服务陈旧索引。这是显式交付边界：禁建库服务器的索引新鲜度职责移交外部预建机器（known-issues 运维解既有口径），服务器端不做部分嵌入（部分嵌入=重新打开容器内嵌入门）。 - 风险④：无索引词面降级每次搜索全语料 scan（文件读放大）。裁决：可接受——仅发生在「未预建的 ws + 禁建库服务器」组合，本就是运维例外态；量级 ~百文件（生产实证 108 md/7 ws），且 DB 异常降级路径已是同款实现先例。 - 放弃方案A：开关关闭时对无索引 ws 返回空结果（不词面降级）——搜索完全不可用，违背「搜索永不 5xx/可查」的既有设计底线，放弃。 - 放弃方案B：per-workspace 建库白名单（哪些 ws 允许容器内建）——配置面与运维模型复杂化（known-issues 口径是「建库一律外部机器」，全局开关即够），放弃。

## D-unmapped-093@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-19-thinking-zh-translate
原编号：D-001@v1
锚点：未记录
最近确认：bfa6357537da5377966ec9d747dc47fbd9e53709
理由：最大风险：**opus-mt en→zh 对技术思考文本的翻译质量一般**（2020 年代模型，专有名词/代码混杂句式偶有生硬）——预期是「能看懂大意」而非信达雅；缓解：代码块/URL/行内代码保护不送翻（减少破坏面），「显示原文」一键可退。若后续要更好质量，模型 repo 是配置项可换（如更大 ct2 模型），接口契约不变。 次要风险：①模型首用下载 ~100-150MB，离线/弱网环境不可达——TRANSLATE_MODEL_DIR 预置 + fail-soft 已覆盖，Docker 预烤文档化；②ctranslate2 依赖体积（wheel 数十 MB）——后端镜像可接受，Dockerfile 是 lock-less 安装直接生效；③摘要翻译对「前 500 字符截断处恰在句中」的边界——截断到最近句界再送翻，避免半句译文。 试过放弃的方案：浏览器端 transformers.js（性能不可接受，见做法概述）；argos-translate（Python 包管理器下载源不可配镜像、版本锁死，不如直接 ct2）；译文落库（违反「原文是审计真相源」原则且膨胀存储，缓存层已足够）；SSE 流式逐 delta 翻译（80 字符/120ms 的增量粒度翻译必产生请求风暴与重复推理，折叠默认态根本不需要实时译文——按需模式把负载降 2-3 个数量级）。

## D-unmapped-094@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-19-translate-live-verify
原编号：D-001@v1
锚点：未记录
最近确认：ffd511d4eb260046f3803cfa16492f4e0e55a0a7
理由：最大风险：第三方个人仓库（jiangzhuo9357）可能失联/删除——缓解：TRANSLATE_MODEL_REPO env 可换任意 ct2 仓库、TRANSLATE_MODEL_DIR 指本地目录彻底离线、README 预烤文档已覆盖。放弃的方案：`ooeoeo/opus-mt-en-zh-ct2-float16`（float16 权重 CPU 推理不友好，且无必要）；本地 ct2-transformers-converter 自行转换 Helsinki-NLP/opus-mt-en-zh（需装 torch ~200MB，重且慢于直接用现成 int8 转换）。

## D-unmapped-095@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-19-knowledge-build-switch-rollout
原编号：D-001@v1
锚点：未记录
最近确认：cb7394b3637b8bab1e1d746dbb2454c658bb6e85
理由：- 风险①：镜像重建卷入并行会话的在途提交（构建用工作树快照，非 HEAD）——已核：构建起始 ≈7e9c795ef，其后提交均为前端/测试/文档/存档面（发布记录显式注记）。对策：构建前确认工作树解并记录快照锚。 - 风险②：后端新镜像携带未在生产验证过的 pgvector 迁移 + translate 新功能——本地平台本就是验证环境（数据可清空口径），迁移 fail-closed 设计自带护栏；translate 有 37 测试 + 评审。接受。 - 风险③：部署记录 seq 与并行会话的记录取号竞争（同用 next-release-seq.sh）——取号 22 立即落盘；若并发同号，后写者可据文件核对修正（留待观察）。 - 风险④：未建索引词面降级每次搜索全语料扫描（热查 2.9-15.1s 抖动）——设计期已裁决可接受（运维例外态）；本次实测数据佐证并如实记录，未触发超时螺旋即满足底线。 - 放弃方案A：仅 restart backend 不重建镜像——新镜像才是开关生效前提（代码在镜像内），否决。 - 放弃方案B：同时重建 frontend——本次范围仅后端开关落地；前端翻译 UI 部署归后续前端部署，避免扩大爆炸半径。

## D-unmapped-096@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-19-change-assets-cross-repo-repos
原编号：D-001@v1
锚点：未记录
最近确认：9043c1a83f53bb4bcd5fd05fe3fd8529a5c0132d
理由：最大风险：读侧新增字段被误读成「主仓统计的一部分」——已在资产卡显式区分「主仓 patch / 跨仓各仓」并对 totals 不做相加。另一个风险是每次 assets 读取需解析可能数 MB 的 change-patch.json（repos 正文在场时），但既有实现本就整文件 JSON.parse 提取 files，增量可接受；如后续成为热点再做流式/缓存。放弃方案：①后端把 patch 正文一起回传给前端做切片——单仓正文 3.5MB 且会重复传输，违背「元数据进卡片、正文走全屏预览」的既有分工；②按仓切片端点（A2）——本次不需要，留待卡内直接看 diff 的需求出现再加。

## D-unmapped-097@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-19-cross-repo-patch-slicing
原编号：D-001@v1
锚点：未记录
最近确认：2b87056a6bd73e6dfa932232adec16c5bde2415b
理由：最大风险：`file_list` 从 patch 头解析（而非独立清单字段），若 CLI 未来改 patch 格式（如 no-prefix diff）清单会静默变空——投影是 best-effory 展示面，切片命中与否仍有 note 兜底，可接受。放弃方案：①CLI 在冻结件里新增独立 repos[].files 字段——要跨仓改冻结契约且需 CLI 发版协同，解析现有内联正文零协同即可达成同一效果；②未知 repo 键抛 422 白名单——与端点「读不到留档是展示面降级」的既有语义冲突，且无安全面收益；③前端自行拉全量 change-patch.json 解析清单——4MB 传输只为拿文件名，浪费且受 content 端点截断限制。

## D-unmapped-098@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-19-preview-card-empty-turn-fix
原编号：D-001@v1
锚点：未记录
最近确认：99f758c6f7d64b6bc36a05a1aead5a30a42389aa
理由：最大风险：判定把「有内容但零摘要」的轮误收敛成不可见（例如仅 tool 通道日志的轮）。防护：started_at 有值即排除（tool-only 轮必然派发过引擎），摘要双空 + error_code 空 + started_at 空三条件同时成立才收敛；失败族/活跃族显式排除并有单测锁定。次风险：历史数据存在 started_at 缺失的正常轮（字段后补）——实测当前库正常轮 started_at 均有值；若真出现，该轮退化为不可见（无预览卡），导航刻度仍可跳转，属可接受降级。放弃方案：①后端大纲剔除纯切换轮——会导致全局轮号重排（seq 权威序），导航与轮次徽章全部错位，否决；②仅把卡片改置灰不可点——丢失配置行的档案/引擎信息且刷新前后形态仍不一致，否决；③大纲挂载后失效重拉（消除 stale outline）——治标不治本（拉到新大纲后死卡依旧），且本次透传方案已让两态一致，留作后续独立评估。

## D-unmapped-099@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-20-backfill-dryrun-log-scrub
原编号：D-001@v1
锚点：未记录
最近确认：3490518aa9925709efdbf3880a441593fb04d89f
理由：最大风险：已习惯旧口径（裸跑即写）的使用者肌肉记忆被翻转——首次 `--apply` 忘带 `--yes` 得到退出码 2。缓解：docstring 用法段与 `--yes` 报错信息都给出明确指引；且 261a33367 提交信息记载本仓已回填完毕（复跑应全 unchanged），日常无人需要再跑 `--apply`。 试过但放弃的方案：① 交互式确认提示（裸跑问 y/N）——破坏可脚本化性，CI/批处理无法应答，flag 门（`--yes`）是 backfill_change_titles.py 已验证先例；② 连同 :187 env 键日志一并删除——该行已脱敏且承载 provider 路由排障信息，删除超出审查发现的事实面。

## D-unmapped-100@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-20-root-ruff-config
原编号：D-001@v1
锚点：未记录
最近确认：978336829578f84f9c18d7ded93c25ce05f432da
理由：最大风险：格式化 `check-assertion-surfaces.py`（pre-commit assertion-surfaces 闸门脚本）与 `scan-drift-check.py`（local.yaml scan:check 命令）——若重排意外破坏行为会卡全仓提交。缓解：ruff format 是纯空白/换行重排（无 token 变换），交付前闸门实跑 + test_scan_drift_check 用例回归 + diff 逐行核对仅空白类变化。 试过但放弃的方案：① 只改钩子建议文案按路径分流——治标：钩子仍按 88 裁根级文件，与任何手动 backend-cwd format 依旧不一致，且文案分支逻辑要进 pre-commit config 维护；② 根 ruff.toml 配齐 backend 全套 lint select——放弃：会瞬间扩大根级存量 lint 面（UP/SIM/N 等规则对存量 scripts 文件的未知违规），本变更范围膨胀，与「修行宽拉锯」的目标无关；③ 升级 ruff 至支持项目级多配置合并的版本——放弃：工具链版本变更影响面远大于本缺口，且 0.15.14 双入口数值同源后已无矛盾。

## D-unmapped-101@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-20-sillyspec-gotchas-session
原编号：D-001@v1
锚点：未记录
最近确认：06e0a0cc5908aa37fbbc2e79ab0b741fb1b6381a
理由：最大风险：条目描述的工具体验问题部分依赖 CLI 内部阈值/实现细节（如改写率 0.6 阈值、归档提交打印逻辑），后续版本演进可能修复——按文件头惯例每条标注踩坑时点与版本（2026-10-20 / v3.33.1），演进后由 knowledge digest 的 rot 信号自然处置。 试过但放弃的方案：①`knowledge propose` 收件箱通道——语义未文档化、proposed/ 为空，且 4 条是已实证成熟条目非待裁决提议；②只写会话汇报不落库——用户显式指令「记录下」，且不落库则后续会话不可检索、工具改进无留痕面。

## D-unmapped-102@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-20-conflict-platform-archive
原编号：D-001@v1
锚点：未记录
最近确认：ffab0aa2e9dafa7c1fa67528d15f08941d4ee87b
理由：最大风险：details_json 膨胀——三重帽兜底（32000 字符/文件、512KB 总量停存内容、300 条目），上限与一次冲突推送的请求体同量级（推送本身已携带这些 content），不放大既有存储压力。次风险：留档内容是**冲突时点**快照，机器侧后续演进不反映——横幅文案明示，且这恰是排障需要的时点证据。 试过但放弃的方案：①服务端 upsert 时经 daemon RPC 抓记录快照——时序必竞态（机器记录由 CLI 收到响应后落盘）+ Workspace 无 instance 绑定（无从寻址机器）；②平台行携带记录 label 驱动对比——只修名口径不修记录死亡，10-16 已用 full-tree 兜底覆盖记录活着场景；③机器离线/超时（504 家族）也回退留档——前端对比按钮对离线机器本就禁用，需求面（坑文）只覆盖记录缺失态，维持四臂文案现状，超范围不做。



## D-unmapped-103@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-20-pill-dock-left-align
原编号：D-001@v1
锚点：未记录
最近确认：a303e730226d05a93ba959773366a676cf54aa09
理由：最大风险:存档恢复首帧对齐闪动(恢复帧 items-end、下一帧切 items-start)。已消除——恢复路径改走 `snapPos`,首帧即携带正确 left。 试过但放弃的方案:① render 期读 `dockRef.getBoundingClientRect()` + bounds 现算对齐——render 读 DOM 不纯(ref 首帧为 null),且每次 render 强制布局;② 持久化存档带 left 字段——存档格式变化,既有 toEqual 断言与旧档兼容都要跟着动,left 可从坐标幂等重推导,入档属冗余状态。两案均弃,采用吸附判据单源派生。

## D-unmapped-104@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-20-pill-dock-drag-align-keep
原编号：D-001@v1
锚点：未记录
最近确认：4f77e50c12b353f42e8442aed1fcdfea34234511
理由：最大风险(声明边界):拖拽中把组拖到对面半边但未松手时,视觉位置在左/右而对齐仍是拖拽前方向——这是设计意图(对齐切换只在松手吸附时发生,避免拖拽中过中线来回翻转抖动),非缺陷。 放弃的方案:拖拽中实时按位置中线切换对齐——过中线时两个 pill 的对齐侧来回翻转,组框跟手移动叠加对齐抖动视觉混乱,且拖拽中位置本就是临时态,实时切换无信息增益。
