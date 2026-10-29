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
变更：2026-10-20-session-error-visibility
原编号：D-001@v1
锚点：未记录
最近确认：6f2fe0baf5d63d5a078e96a39670a5543a7c9bfe
理由：最大风险：把真打断误报为失败（ql-20260918-003 曾专门修过反方向——打断被渲染成「轮次失败」的误导）。对策：升级条件严格限定 buildErrorLogItem 返回非 null（模型错误键存在才非 null），error_detail 空的真打断零触碰；FR-03 零回归用例钉住。 试过放弃的方案：① 后端拆新 error_code（如 interactive_model_failed）——需 backend+daemon+前端三方发版且存量 run 无法重写，放弃；② RunErrorItem 默认展开完整 raw——raw 可达数千字符（实测 404 HTML 全文），撑爆消息流，改为首行截断摘要 + 折叠全文。

## D-unmapped-104@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-20-codex-requires-openai-auth
原编号：D-001@v1
锚点：未记录
最近确认：409315def4b848f950771392b7be388068c7304f
理由：最大风险：`requires_openai_auth` 是 codex CLI 的非 stability-guaranteed 配置键（cc-switch 生产配置与官方智谱接入文档均在用，当前 CLI 0.162.0 实测有效），未来 codex 大版本若更名/移除该键，症状回归为「不发认证 → 断流」——与 wire_api="chat" 被移除的先例同类。缓解：daemon 已有版本基线注记惯例（R-03），本变更在常量注释处注明 CLI 基线与实测依据；升级 codex 基线时冒烟面覆盖。 试过但放弃的方案： - 改走 openai_chat/litellm 代理通道（零代码）：模型选择退化为 usr-<uid>-<pid> 路由键、链路多 hub+LiteLLM 两跳，且该通道对 codex 从未被真实验证过（30 天零成功 run）；放弃。 - base_url 层面绕过（如要求用户把 key 拼进 URL）：bigmodel 不支持 URL 内嵌 key，且 key 进 URL 有日志泄漏面；放弃。 - 供应商配置面透传任意 provider 表键（settings_config 加 codex 专属段）：配置面扩大、需要 backend+daemon 双端改动，超出本次最小修复面；如未来需要 per-provider 差异键再立变更。

## D-unmapped-105@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-20-codex-models-fetch-candidates
原编号：D-001@v1
锚点：未记录
最近确认：aa64d06245f0473307dc8ea88dfc9dd46c871e9a
理由：最大风险：追加候选使「全候选 404」场景多一次上游请求（每条 models 拉取至多多 1 次 GET），对中转站限流面略增——量级可忽略（手动触发的低频操作）。次风险：`base+"/models"` 对某些会把 `/models` 当模型名路由的网关返回 200 非 models JSON——`_parse_models_response` 已有「body 不可解析/缺 data 字段 → AllFailed」兜底，不会误报成功。 试过但放弃的方案： - 按 provider 名/域名特判端点（如 bigmodel → /api/paas/v4/models）：vendor 分支进 service，维护面差、新供应商每次都要改代码；放弃。 - 前端对 codex 条目隐藏拉取按钮：不解决根因，且智谱/OpenCode 端点本就支持拉取；放弃。

## D-unmapped-106@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-20-preset-engine-endpoint
原编号：D-001@v1
锚点：未记录
最近确认：bc88187dcee54e94289c2fcc742a802ffef45c00
理由：最大风险：自动取消 Claude 勾选对「我就想同一条都勾上」的用户是强制收敛——但该组合保存后 Claude 与 Codex 必有一侧拿到错端点（今日三次实证），表单放行等于制造坏配置；notice 明示原因与出路（另建一条），属正确性优先。次风险：applyPreset 按当前勾选分派，用户先点预设后改勾选时形态可能与其预期不符——勾选联动会把形态拉回与勾选一致的状态，自愈。 试过但放弃的方案： - 预设拆成两条（OpenCode Go Codex 单列）：选择器条目翻倍且用户需自己判断选哪条，约束仍不可见；放弃。 - 保存时后端校验拦截坏组合（base_url 对勾选引擎不可达）：后端无法静态判定端点协议支持（需真实请求），动态探测成本高且时序不适配；放弃（表单联动前置收敛更便宜）。

## D-unmapped-107@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-20-session-status-live-sync
原编号：D-001@v1
锚点：未记录
最近确认：59007127f0d130be7ea5e131f4f61154806d37a0
理由：最大风险：信号频率放大列表查询负载——每个 run 生命周期新增约 3~5 个信号（创建/激活/审批对/终态），每个信号触发一次列表 refetch（limit=500 窗口函数查询）。评估：10s 轮询本来就执行同款查询，事件驱动只是把「定时查」变「变化时查」，稳态总频率不升反降；且 400ms 去抖把轮内密集信号合并。若极端高频会话（自动化连续注入）仍显负载，后续可加信号侧节流（不在本变更范围）。 试过但放弃的方案： - 前端 turn_started/全事件扇出 onSessionListRefresh——只覆盖当前打开的会话，其他会话（列表里未打开的）状态变化仍瞎；且每轮多次 invalidate 无谓压力。放弃，改为后端信号根治（覆盖全部会话）+ 仅审批边沿本地兜底。 - 列表轮询间隔调小（10s→2s）——治标：全静默 30s 退化和「变化时查」语义都没解决，纯增加空转查询。放弃。 - 把 current_run_status 塞进 per-session SSE 频道让前端本地合成列表状态——前端需要为未打开会话维持订阅/状态机，复杂度大增；哑信号+refetch 复用既有链路，改动面最小。放弃。

## D-unmapped-108@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-21-gitlog-quotepath-fix
原编号：D-001@v1
锚点：未记录
最近确认：5bbb1a830ca0bee507747635b639a3be0ac85947
理由：答：死路①（已试已弃）：改用 `git show --numstat -z` 按 NUL 切分原文路径——`-z` 在 `git show`（log 族）语境同时是「提交分隔符」语义，与 `--pretty=format:` 混用行为含混，且需重写 numstat 两段式分区解析，相对 `-c core.quotepath=false` + 解码兜底无额外收益，弃。风险①：路径含非法 UTF-8 字节序列时 `Buffer.from(bytes).toString('utf8')` 产生 U+FFFD 替换符——防御性行为可接受（git 真实输出不会出现：路径字节即提交时的合法编码）。风险②：既有命令构造断言用例按 args 位置逐 token 断言（GL25/GL29/GL37/GL42/GL43/GL45），插入 `-c` 对后需同步更新索引——漏更即测试红，已列入 task-01 验证面。风险③：porcelain/diff 加 `quotepath=false` 后含换行的文件名仍被 git 强制引号包裹（控制字符恒转义），单行解析假设不破——decodeGitCQuote 同款规则保证。

## D-unmapped-109@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-21-overview-card-mainflow-scan
原编号：D-001@v1
锚点：未记录
最近确认：23c936e92bf7871cd0ea0edba46cdf5387e49079
理由：答：最大风险：既有测试与潜在快照对「六段管线」的隐含依赖——已定位唯一断言面（本组件测试 213-217 行 scan aria 断言）同步更新，全仓 grep 无其他组件消费本卡 MAIN_STAGES（组件内常量未导出）。次要风险：旧 daemon 采集值（CLI 未升级机器）下 thin 变更暂显 brainstorm 主管线——数据源升级自愈，非本变更面（依据：根因修复在 sillyspec 2026-10-21-overview-thin-stage，跨仓不在本冻结面）。放弃方案：①连带改移动端 stepper（mobile-change-detail STEPPER_STAGES 含 scan）与变更中心 `?? "scan"` 兜底——同根因但异仓异面，用户本轮只点名总览卡，扩面应由用户裁决，留后续候选；②改 CLI 侧让 envelope 附带阶段清单驱动前端渲染——过度设计，前端静态常量与 sillyspec MAIN_FLOW_ORDER 对齐即可，增契约无收益。

## D-unmapped-110@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-21-gitlog-conflict-quotepath
原编号：D-001@v1
锚点：未记录
最近确认：21e877fc467eca703395f8b9d60dccfa4f67326d
理由：答：风险①：`git diff --name-only` 输出按行切，文件名含字面换行仍会断行——但含控制字符的路径 git 恒强制 C 引号包裹（`\n` 被转义为字面 `\n` 两字符），单行假设不破，decodeGitCQuote 同款规则兜底（上变更风险③同机理，GL47 已实证）。风险②：`conflicts[].file` 语义变化对 backend converge_mission 的下游消费是修复性变化（原文路径才能 readFile），若存在依赖「转义形态」的下游断言需同步——检索 backend 侧对 conflicts 的消费为透传给 LLM 提示词，无形态依赖。死路①：不改 `_listConflictFiles` 改为 `git status --porcelain` 解析 U 态——porcelain 输出对特殊字符的引号规则随 `-z` 才关、解析面更大，弃。死路②：沿用上变更已弃的 `--numstat -z` 思路改 `-z`——name-only 的 `-z` 需改 NUL 切分且与既有行式解析不兼容，无收益，弃。

## D-unmapped-111@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-21-mobile-scan-birth-cleanup
原编号：D-001@v1
锚点：未记录
最近确认：bbc224288e8daa873a122695fc50a3ad418d9ce7
理由：答：最大风险：legacy scan 阶段值（2026-09-27 前创建且未推进的行）在移动端详情失去步骤条——实为与桌面一致的既有降级形态（收敛），且此类行本就停滞在出生阶段无步骤可看，风险可忽略。次要风险：兜底改 brainstorm 后 `current_stage=null` 行显「需求分析」可能被误读为「正在头脑风暴」——null 属平台镜像异常态（正常行恒有阶段），兜底只是防裸显，可接受。放弃方案：①保留 STEPPER_STAGES 别名仅删 scan 元素——留无谓别名不如直用 WORKFLOW_STAGES 单一源，防第三份副本再漂移；②连 ChangeStepBadge 的 scan 标签/色映射一并删——那是 legacy 值域映射，删了会让存量 scan 行裸显英文 'scan'，越界，弃。

## D-unmapped-112@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-21-precommit-sandbox-entries
原编号：D-001@v1
锚点：未记录
最近确认：8fc3178d3d66af22d19c6eeee234a863746fd512
理由：答：风险①：uv 在 Low 子树若需下载依赖（根 .venv 缺失时）可能被沙箱网络策略拦——当前根环境已就绪（ql-20260923-006 实证根/backend uv env 同源可用），`.tmp/uv-cache` 重定向后无 profile 写，残余风险记为已知限制；真遇到时用户终端跑一次 hook 预热缓存即可。风险②：pre-push 两条保留 bash 包装，agent 会话内若手动触发 pre-push 仍会崩——推送属用户终端动作（流程纪律），不为其扩大改动面。死路①：icacls 改 `~/.cache` ACL——嵌套 token 根本不在 CodexSandboxUsers 组、写入拒绝在驱动白名单层而非 DACL，改了无效（探针实证），弃。死路②：削弱沙箱容器（改内核对象目录 ACL/降标签）恢复 msys 嵌套——动容器安全边界换取工具便利，方向性错误，弃。死路③：PRE_COMMIT_HOME 写入用户级环境变量——Low 子树只能写仓内路径，单值无法同时满足多仓，弃（按会话 `export PRE_COMMIT_HOME=$PWD/.tmp/pre-commit-home` 使用，已验证）。

## D-unmapped-113@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-21-precommit-cleanup
原编号：D-001@v1
锚点：未记录
最近确认：68ae72e85d8261a4c49924cc6edaec5dc61d4f4c
理由：答：风险①：knowledge search 的索引对新增条目可能非即时（懒建/同步节奏）——FR-03 以 search 实证命中为验收，未命中则重跑 search 触发同步，验收门兜底。风险②：INDEX 锚点 slug 与 GitHub 风格推导不一致导致点击 404——对照既有 🟡 条目锚点格式（emoji 剥除、空格转连字符）书写，search 路由不依赖锚点（按关键词行），影响仅限手工点击面。死路①：把沙箱限制写进 AGENTS.md 横幅——环境事实混入流程规则面，全局注入噪音大于收益，弃（知识库按需路由）。死路②：保留 `.tmp/hooks` 作双通道备份——非官方通道留存即诱导复用，与「统一官方链」目标相悖，弃。

## D-unmapped-114@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-21-files-refresh-spinner
原编号：D-001@v1
锚点：未记录
最近确认：e88ffddb76486f445e8bdac23d437a22c39a8ebd
理由：答：最大风险是双入口（按钮+错误重试）并发时转圈提前消失的反馈时机问题——影响仅视觉反馈、不涉数据，触发条件苛刻（错误态下双击两入口），接受不改计数器（复杂度不值）。放弃方案：① 给全局 `Button` 组件加通用 loading prop——影响全部消费面，远超本诉求；② 新增独立 POST 同步端点+按钮联动——已被 2026-10-13-change-files-refresh-sync D-007@v1 否决（GET 纯读语义 + 用户诉求是刷新动作本身带同步），不复潮。

## D-unmapped-115@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-21-task-wakeup-restore
原编号：D-001@v1
锚点：未记录
最近确认：440f3fd244d4810e1f4fb0a30c875767cab088e3
理由：答：最大风险是产品语义回退复发——本次恢复与 10-13 删除是同一取舍的正反对翻，为防「短任务噪音」复发，阈值门槛 + 0 关闭阀 + stopped 不唤醒三重降噪全部保留；若未来 claude 引擎在流式模式原生自续跑，会出现双轮，届时设 SILLYHUB_TASK_WAKEUP_QUIET_MS=0 一键关闭（[TASK_NOTIFICATION]/注入行可观测，当天可发现）。次要风险：未知帧降级桶（codex/cursor 未知事件映射 subtype='task_notification'）理论上可携带 task_id 进入唤醒判定——旧链六周共存无误触发记录（降级桶帧通常无 task_id，strOf 早退），恢复时保持原样不加新防线，避免为理论面扩表。死路：①「daemon 私推引擎流绕过 backend」——已否决，幽灵轮无审计无权限路由（$46 事故先例）；②「前端折叠系统行升级」——原裁定本变更不做，执行期用户改判（dsh「收到任务消息」形态实证后明确要求可见留痕），已并入 FR-06；③「local.yaml 阈值载体」——放弃改 env，理由见做法概述。

## D-unmapped-116@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-21-archive-patch-repair
原编号：D-001@v1
锚点：未记录
最近确认：5c97d62770d4dddf8fa3d9ea833b8905f3cbd098
理由：答：最大风险是手工修准与 CLI 未来版本的 schema 演进漂移——缓解：键集不变只修值、repair 为纯新增字段（后端投影对未知键 fail-open，schema.py 侧 assets 读取面已核），且 verdict 枚举已从后端权威源查证（`planned/unplanned/untouched`，schema.py:745），无需凭空造值。放弃方案：① 接受现状不动——平台卡面持续误导 + 未来 FR 归属按错误清单污染，且 review.json 的 git-diff 权威面在历史压扁后成孤儿引用，评估已否；② 只追加 repair-note 文件不动冻结件本体——半吊子修复，卡面照旧错，不解决用户可见面；③ CLI 官方通道重建——`flow` 子命令无重建能力（已归档注销）、`--reopen` 属厚流程阶段机、知识库无先例，通道不存在。仓内已有 `patch-reanchor` 命令（归档后锚点修复）先例，佐证归档后修复在该流程文化下是被认可的形态（本变更为其内容面扩展，手工执行）。

## D-unmapped-117@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-21-spec-manifest-incremental
原编号：D-001@v1
锚点：未记录
最近确认：5115487c570daf7efdcedd873932b50372333d36
理由：最大风险：**未来新增清单写点漏盖章 → 增量流漏行**。缓解：四个写点（apply_ops / _write_spec_root 对齐 / soft_delete_change_dir / heal_manifest_tombstones）逐点内联盖章并带「2026-10-21」锚注释，模型列注释与各写点 docstring 均注明「新写点必须盖章」；增量端点语义上把 NULL 行排除（未盖章行不进增量流）反而是显式失败面——漏盖章表现为客户端漏看到该行，靠全量兜底可发现（CLI 侧将带定期全量对账，sillyspec 仓消费变更内做）。评审补强两处：heal 写点盖章（P2-1，原实现漏）与 get_manifest 先读版本后读行（P2-2，封 READ COMMITTED 双快照跳行窗口——多读行是幂等超集无害）。次风险：rename 软删使墓碑行累积增速略升（原来硬删的行现在留存）——与既有 delete op 墓碑同量级（月千级），且有 `landing_version` 后未来可做墓碑 GC，可接受。 放弃的方案：① 按 `version`（行级谱系）直接过滤——不同行计数不可比，语义错误。② `updated_at` 时间戳游标——时钟回拨/同秒多事务不可判定，且 DB 与应用时钟双源。③ ETag/If-None-Match 整体未变短路（无增量行）——只能省「无变化」场景，任何单行变化仍全量 2.2MB，治标不治本。④ 服务端缓存全量序列化按 spec_version 键控——省的是 0.9s 生成段，5s 传输段不动（带宽受限），收益不足。⑤ 只做响应瘦身（裁墓碑/字段）——上限 ~15%，不解决无界增长。

## D-unmapped-118@v1 参考粒度＝交互模型与数据口径，不移植 DSH 插件化客户端架构
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-001@v1
锚点：未记录
最近确认：328788cbe
理由：沿用既有裁决，不重新论证（我的判断：继承）。2026-08-19-session-stream-ux 在 A 渐进增强 / B 全量移植 deepseek-harness 架构 / C 共享装配器 三条路线中选定 C——「参考 deepseek-harness 设计思想但不移植其插件化架构」。本仓客户端是 Next.js 14 + React 18 + TanStack Query + antd 的单一应用；DSH 客户端是 Cordis 插件图 + 58 个 `packages/client/*` 包 + slot 注册表。移植成本与回归面远超收益，且本仓已用「单一装配器 + 段模型」达到同一目标（事件 → 结构化轮次模型 → 对话/进度多视图消费）。
故障面：若后续出现「按工具/按视图独立演化」的强需求，集中式渲染（frontend/src/components/agent-log/tool-renderers.tsx，731 行 switch）会先成为瓶颈——届时按需抽轻量注册表，而不是回退到插件化架构。
退役判据：出现 ≥3 个需要独立加载、独立版本的客户端扩展方（第三方插件生态）时重议本边界。

## D-unmapped-119@v1 动机＝日常主力工作台 + 对外演示可用 + 与 DSH 直接对标（非「会话规模爆炸」驱动）
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-003@v1
锚点：未记录
最近确认：328788cbe
理由：用户多选三项动机：①与手边在用的 DSH 直接对比，差距刺眼；②想把它当主力工作台，日常别扭感累积到临界；③要给别人用/演示，观感与可读性要能打。**未选**「会话规模变了（几十轮 + 子代理/团队会话撑不住）」——即本次不是为极端长会话/多并发现场做容量设计。
故障面：「主力工作台」与「演示可用」对同一处有相反要求——前者要高密度、后者要留白与呼吸感；若不分场景一刀切排版，会牺牲其中一侧。
退役判据：若后续出现真实的规模压力证据（单会话轮次/日志量级或并发会话数成为瓶颈实测），重新评估容量线是否入范围。

## D-unmapped-120@v1 视图模型不在对话里拍板——先出 HTML 原型看效果再定（用户选 C）
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-004@v1
锚点：未记录
最近确认：328788cbe
理由：用户选 C——先出 HTML 原型看效果再定视图模型；本轮**不**承诺 A（允许重构）也不承诺 B（保守增强）。
故障面：原型先行把"设计定稿"推迟到原型确认之后；若原型用理想化假数据（无超长轮/大 diff/失败轮），确认结论会落空——原型语料必须覆盖真实形态。
退役判据：用户看过原型并明确选定形态后，本条目由对应的视图模型决策条目取代。

## D-unmapped-121@v1 原型出「A/B 双形态对比」单页（我的判断）
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-005@v1
锚点：未记录
最近确认：328788cbe
理由：我的判断：一份单文件 HTML，可切换地并排呈现 A（单视图可伸缩：整轮折叠 → 过程分组 → 单条 disclosure）与 B（两视图保留 + 细节档位），共用同一份真实形态语料（超长轮、连续工具调用、失败轮、子代理轮），并把 D-003 登记的「高密度 vs 呼吸感」张力做成两套排版参数同页对比。依据：仓内既有 AI-Native 视觉方向与既有原型留档形态。
故障面：两形态同页使状态维度上升（形态 × 展开层 × 档位），需以静态语料 + 少量本地交互实现，避免体积与状态管理失控。
退役判据：用户选定形态后原型仅作留档，不再迭代。

## D-unmapped-122@v1 成功标准延后到原型确认后定稿（草案 SC-01..SC-05 随原型呈现）
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-008@v1
锚点：未记录
最近确认：328788cbe
理由：用户选「先看原型再定」——成功标准（尤其 SC-01/SC-02/SC-04 的尺度）在看过原型后一并定稿。
故障面：若原型轮只确认形态而漏确认 SC，后续 tasks 与 verify 探针会缺少判据锚点。
退役判据：SC 定稿写入 requirements.md 后本条目仅作过程留档。

## D-unmapped-123@v1 方案定稿推迟到原型确认轮；原型出 A/C 双形态（修订 D-005 的 A/B 组合）
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-009@v1
锚点：未记录
最近确认：328788cbe
理由：用户选「先出双形态原型，看完再定」——本轮不承诺 A 或 C；原型按 **A/C 双形态**出（C ＝ A 的全部呈现 + 旧「进度」视图保留为可切回的入口），看完效果再定稿。Step 4 的三方案对比表与推荐（推荐 A）已被接受为讨论基础，但不构成选择。
故障面：若把 A/C 做成两页独立实现，对比成本上升且会掩盖真实差异（C 多出的只有回退入口）；须同页可切换、共用同一份语料与同一套排版参数。
退役判据：方案定稿后本条目由对应的视图模型决策条目取代。

## D-unmapped-124@v1 原型形态升级为 dev 预览路由（直接渲染真实会话组件）
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-010@v1
锚点：frontend/src/app/proto/session-fold/page.tsx
最近确认：328788cbe
理由：用户选 ①「dev 预览路由」+ 改动边界「允许改生产链路」。已落地：新增 dev-only 路由 `frontend/src/app/proto/session-fold/page.tsx`，直接 `import` 真实 `TurnTimeline`，喂 fixture 轮次（`segments` 含 thinking / Grep / Read / Edit(structuredPatch) / Bash）。验证：`tsc --noEmit` 0 错；`next dev` 实测 `GET /proto/session-fold 200`，HTML 98KB 内命中真实组件标记（「思考过程」×2、`Grep` ×2、`turn-timeline.tsx` ×10）——即为真实组件树渲染，非复刻。
故障面：dev 路由需起 `next dev`（本机 spawn 受限，需完整权限跑），且因不受 middleware 守卫而存在未授权访问面——必须保持 dev-only 且不进导航，否则等于新开一个匿名入口。
退役判据：折叠模型正式落到生产组件后，本路由降级为回归对照页或删除。

## D-unmapped-125@v1 「继续用静态 prototype:build 复刻会话页」被否决
状态：rejected
变更：2026-10-20-session-page-dsh-alignment
原编号：D-011@v1
锚点：未记录
最近确认：328788cbe
理由：否决（用户选择 dev 预览路由）。静态管线是 `tsc + react-dom/server`，无浏览器运行时，无法承载 `turn-timeline` 的 antd / zustand `useSession` / `thinking-translate` 依赖；复刻只能逼近观感，功能面永远补不完（用户实测判断「缺很多功能」）。
否决理由：静态产物只能「像」，无法证明真实组件在折叠模型下的行为，且复刻成本无上限。
复潮条件：需要完全无运行时的离线观感稿（对外文档配图）时可临时用静态管线生成素材，但不得作为定稿原型。

## D-unmapped-126@v1 静态交付形态＝真实组件树的 SSR 快照 + 内联 CSS（交互仍走 dev 路由）
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-014@v1
锚点：未记录
最近确认：328788cbe
理由：采用「dev server 的 SSR 输出 → 内联 CSS → 剥 &lt;script&gt;」导出：`export-proto.ps1` 抓 `/proto/session-redesign`（v2）与 `/proto/session-current`（现状）两份快照，产出 `prototype-session-v2.html` / `prototype-session-current.html`（各 ~295KB，零依赖双击可看）。它是**真实组件树的静态投影**，不是手绘复刻。
故障面：快照剥掉了 `<script>`（无 hydrate），任何依赖 JS 的交互或懒渲染内容不会出现——拿静态稿当"功能完整性"证据会误判；CSS 已内联但字体等 url() 资源离线可能缺失（回落系统字体）。
退役判据：若 Next 侧启用 `output: 'export'` 能直接产出静态站，本脚本由官方导出替代。

## D-unmapped-127@v2 视觉基线＝真实页面的**结构**（三主题并存，不把深色当基线）〔取代 D-015@v1〕
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-015@v2
锚点：未记录
最近确认：328788cbe
理由：用户更正（原话）：「不是颜色问题 平台就是有三套主题，我给你de截图是深色而已」。故 @v1 的「浅色稿作废、以深色为基线」判断错误，本版取代：**基线是真实页面的结构与信息组织**（布局、信息项、行式、chip、轮头/轮尾、工具卡形态）；**主题是三个并存维度**（ai-native / blue / dark），三套都必须成立。
故障面：三主题共用一套语义 token 时，某些混色（如 brand 边框 + card 底）在浅色主题下对比度不足——每套主题需各自校验对比度（正文与 muted 至少 4.5:1 / 3:1）。
退役判据：平台若收敛到单主题，则本条的"三主题"要求降为单主题规范。

## D-unmapped-128@v1 视觉稿必须由真实组件产出（手绘 HTML 只作参考，不作定稿）
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-017@v1
锚点：未记录
最近确认：328788cbe
理由：不可以。用户指出（原话）：「这个是不是 直接改的 html 而不是 转换的？ 你这样直接改 html 后面代码实现会有偏差的呀」。该判断与仓规一致——`PROTOTYPE.md` 铁律：手绘定稿后每条意见都要反向翻译回真实代码。故 `prototype-session-v3.html` 降级为**视觉参考稿**，不定稿；定稿原型必须是对真实组件（Tailwind + token + 现有 `.sh-*` 类）改造后、由 dev 路由渲染、再由导出脚本固化的 HTML。
故障面：真实组件改动面大（`turn-timeline` / `turn-segment-views` / `globals.css` / `session-list-panel`），且会话页无 E2E——落地时须逐条配单测断言用户可见行为，否则"稿=实现"只能靠肉眼保证。

## D-unmapped-129@v1 静态原型导出必须「浏览器水合后序列化 DOM」，禁止抓 SSR HTML
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-018@v1
锚点：frontend/scripts/export-hydrated.mjs
最近确认：328788cbe
理由：实测证明 SSR HTML 不可用：`prototype-session-fullpage.html` 含 **138 处 CSR bailout `<template>` 占位、0 个 `.wmde-markdown`**（助手答复正文全缺）。改为 `frontend/scripts/export-hydrated.mjs`：playwright 打开路由 → `networkidle` → `waitForFunction(.wmde-markdown ≥ 50, 120s)` → 逐片收集 `cssRules` → `outerHTML` → 剥 `<script>/<link>/原 style` → 合并单 `<style>` → 落盘，并机械校验各闭合标签恰好一次。
故障面：导出耗时上升（需起浏览器 + 等水合），且依赖 dev server 在跑。
退役判据：Next 启用 `output:'export'` 且能正确产出 CSR 子树时，可改用官方导出。

## D-unmapped-130@v1 此前三次「效果不咋地 / 看不出区别」的判定，基于缺正文的残缺稿，需在修复稿上重判
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-019@v1
锚点：未记录
最近确认：328788cbe
理由：部分不成立。三次判定所看的静态稿缺全部答复正文（见 D-018），等于在"没有回答文字的页面"上评判。修复稿（`prototype-session-final.html`）已含 138 个正文块，需在该稿上重判。
故障面：若重判仍不满意，说明问题不在正文缺失，须回到 D-016 的层次问题继续定位。

## D-unmapped-131@v1 删除轮间 1px hairline，仅以留白分隔轮次（用户方向）
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-020@v1
锚点：未记录
最近确认：328788cbe
理由：用户原话「轮间 1px hairline 多余」→ 删除。`turn-block` 容器 `border-b border-border pb-7 last:border-b-0` → 仅 `pb-7`（28px 留白保留）；`globals.css` 全文核对无其它轮间画线规则（已用测试锁死）。
故障面：长会话滚动时"分轮感"完全依赖留白，若留白被压缩会失去分段感。

## D-unmapped-132@v1 对比加强（答案压过过程）——四组参数定稿
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-021@v1
锚点：未记录
最近确认：328788cbe
理由：用户原话「对比加强」→ 落地为四组：①正文 14.5px/1.78/段距 0.6em → **15px/1.8/0.65em**（标题 16.5/15.5、行内 code 13）②过程行（思考+工具）12px → **11.5px + `text-muted-foreground/80`**，并去掉思考摘要额外 `opacity-75`（叠乘后浅色主题 <3:1 不可读）③工具行左规线静息 `border-border` → **`border-border/60`**（hover 仍 brand）④过程块与答复块间距 6px → **14px**（列 gap 7px + 答复块 mt-7px，过程行彼此仍 7px）。
故障面：11.5px + 80% 墨色在部分浅色主题下接近可读下限，再降即失效。

## D-unmapped-133@v1 轨迹视图形态＝泳道时间轴（共享绝对时间轴 × 输入/模型/工具），账本降为「调用」档
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-024@v1
锚点：未记录
最近确认：328788cbe
理由：用户提供 DSH 轨迹截图作为目标：**三条泳道（输入/模型/工具）+ 一条共享绝对时间轴 + 顶部三档视图（时长/轮次/调用）+ 搜索 + 选中区间高亮**，主视图不是表格。此前实现的「每轮一行小刻度 + 856 行账本」判定为形态错误。
故障面：共享绝对时间轴在 577 分钟窗口下短轮会挤成一小撮，必须有缩放/窗口，否则退化回"看不出哪步慢"。

## D-unmapped-134@v1 过程行采用 DSH 式语义标签（思考 / 运行命令 / 收到任务消息…），daemon 采集缓发
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-025@v1
锚点：未记录
最近确认：328788cbe
理由：用户提供 DSH 截图：每一步是**紧凑单行**——图标 + 语义标签 + 「 · 」+ 一行摘要（如「思考 · The backend model-usage agent finished…」「运行命令 · Regenerate OpenAPI and generated types」），并有独立的 **「收到任务消息」卡片**（带时间、可展开）。**更正**：截图中那张「收到任务消息」实际是变更 `2026-10-21-task-wakeup-restore` 的任务消息**误投到本会话**；用户从未说「daemon 采集缓发」，D-023 的 TTFT/attempt 采集**仍在范围内、不缓**。
故障面：标签是**展示层映射**，不得改写日志原文；未知 event_type 必须回退「其它」而不是丢弃（否则新工具上线即隐身）。

## D-unmapped-135@v1 1b 快照落库点修正——interactive 轮走 `close_run_steps`，不走 `lease/service.complete_lease`〔2026-10-21 execute 期实证〕
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-027@v1
锚点：未记录
最近确认：328788cbe
理由：不成立。实证：`_upsert_batch_model_usage` 唯一调用点是 `lease/service.py:457`（batch `complete_lease` 路径）；interactive 轮的终态是 `daemon/hub-client.notifyRunResult` → `POST /leases/{id}/runs/{run_id}/result` → `router/lease.py:233 close_interactive_run` → `run_sync/service/__init__.py:386-449` → `run_sync/service/close_run_steps.py:_close_apply_terminal`，`agent_run_model_usage` 的 upsert 在 `close_run_steps.py:379-417`。若按原写作落点实现，1b 快照对真实产品路径**永不落库**。
故障面：若未来新增第三条 run 终态写入路径（如离线补报），同样必须在 `_close_apply_terminal` 或新增的共用 helper 处调用，否则快照再次断链；design 的「落库点」表述应改为「`close_run_steps._close_apply_terminal`（interactive）/ `complete_lease`（batch）」两条。

## D-unmapped-136@v1 1b 读模型落点＝`GET /sessions/{id}/runs`（SessionRunRead），`TurnOutlineItemRead` 不加字段〔2026-10-21 execute 期裁决〕
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-029@v1
锚点：未记录
最近确认：328788cbe
理由：放 `SessionRunRead`（`GET /sessions/{id}/runs`）——前端 `runsMeta`（`session-panel-page.tsx:805` 的 `Map<string, SessionRunRead>`）就是消费面，task-11 的轮级卡片与 task-12 的模型泳道都从它取；`TurnOutlineItemRead` 走进程内 LRU 指纹，指纹不含 `daemon_run_snapshots`，快照晚到时会产生**陈旧读**（读到旧快照却不自知），且当前无消费方。
故障面：前端若直接吃 turn-outline 缓存而非 `/runs`，会拿不到快照；task-11 必须以 `runsMeta` 为准（设计已如此要求）。

## D-unmapped-137@v1 后到快照必须在「run 已终态」的二次上报里补写侧表（否则 1b 对 interactive 全废）〔2026-10-21 execute 期实证〕
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-030@v1
锚点：未记录
最近确认：328788cbe
理由：会丢。实测：`close_run_steps.close_interactive_run` 的 terminal 分支（`agent_run.status in TERMINAL_TURN_STATUSES`）先 `rollback()` 再 `return`，**整条不写侧表**；而 daemon 侧 `_onResult` 是「`await onResult(...)`（含首报 close）→ 之后才 fire-and-forget 采集 → 二次上报 file_changes/timing」，因此带快照的那次上报**永远命中 no-op 分支**。若不修，interactive 会话的轮级卡一律退 `tool_only`，1b 数据链路等于没通（只有 batch 路径能出卡）。
故障面：后到快照是一次**额外**的 result 上报（携带首报终态三字段复述）；若未来把 `notifyRunResult` 的幂等改成 409/抛错，这条补写路径会静默失效。批量补发（outbox）同理需保证只写侧表。

## D-unmapped-138@v1 前端降级判据以 capability 为准；`snapshot=null` 且 `capability` 也缺＝「未接线」，不出卡〔2026-10-21 execute 期裁决〕
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-031@v1
锚点：未记录
最近确认：328788cbe
理由：三分法（对齐 design E6/E8）：①`capability="tool_only"`（含 snapshot=null）→ 出「仅工具编辑」降级卡 + 说明行；②`status="failed"|"unavailable"` → 同样降级卡（快照不可信）；③`snapshot=null` **且** `capability` 为 `null/undefined` → **不出卡、不出占位**——这是「挂载方没接线」（dialog / 旧消费方），把它显示成「daemon 老版本」是另一种误导；④`status="ok"` 且 `files=[]` → 不出卡（快照确认零改动，且全树禁止出现「本轮无改动」字样）。
故障面：老 daemon 会话里「每轮一张仅工具编辑卡」会显得吵（20 轮 → 20 张）；这是 E8「显式提示不静默」的代价，收窄需另立设计条目（建议后续：仅末轮/首轮出卡 + 汇总卡统一提示）。

## D-unmapped-139@v1 TTFT/attempt 实际只能 `basis="approx"`（三引擎均无「模型请求起点」事件）；attempt 沿用近似起点而非只记终点〔2026-10-21 execute 期实证〕
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-032@v1
锚点：未记录
最近确认：328788cbe
理由：**不能**，三引擎在 daemon 事件边界都没有稳定的请求起点：①claude 的 SDK `message_start` 被归一化器吃掉（只用于算 `api_duration_ms`，不产 AgentEvent，`:973-1031`）；②codex 的 `turn/started` 只是**轮**起点，工具结果后无通知；③pi 的 `message_start` 当纯生命周期丢弃（`pi-events.ts:36`），`turn_start` 只产 status。故按 plan 降级口径：attempt 起点＝轮首（首段）/「本批工具全部 result 返回」之后；首 token＝首个 text/thinking delta；终点＝下一个 `tool_use` 或轮终态；`basis` 恒 `"approx"`。
故障面：前端会**长期**显示「近似（无 TTFT 采样）」而非「真实占用」——UI 的 observed 分支目前只有单测覆盖、生产不可达；若产品要求「真实占用」必须先在 driver 层补 `request_start` 事件（跨 daemon 驱动改造，不在本变更）。

## D-unmapped-140@v1 迁移链尾锚测试随新迁移一并前移（提交 hook 强制连带）〔2026-10-21 execute 期登记〕
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-033@v1
锚点：backend/tests/test_align_platform_change_events_migration.py
最近确认：328788cbe
理由：仓内 pre-commit hook 的「迁移」钉子会校验迁移链尾锚测试——新增迁移后 `heads[0]` 不再是旧 head，hook **直接拒签**（实测：首次提交被拦，提示「迁移链尾锚测试 heads[0] 前移到新 head（注释链续写）」）。故把 `heads[0]` 由 `c3f8a1d6e2b4` 前移为 `20261021120000` 并在注释链续写一行是本变更的强制连带改动，不是新交付面。
故障面：该锚点测试是「迁移双头」的守护，若把它改成不校验（例如 `assert len(heads) == 1` 以外全放行），未来并行迁移再出双头就无人拦。

## D-unmapped-141@v1 `partial` 且无文件清单时出「一行提示卡」——不得静默成「本轮无改动」〔2026-10-21 execute 期独立审查阻断项修复〕
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-034@v1
锚点：未记录
最近确认：328788cbe
理由：**该出**。独立审查（execute stage review）实测：daemon 超时与队列溢出都返回 `files: []`（`turn-file-changes.ts:813-824`、`tests/interactive/turn-file-changes.test.ts:433-435`），而前端 `toFileChangesCardProps` 先把 partial→`truncated`，随后 `if (files.length === 0) return null` 整卡不渲染 → 用户看到「没有卡」，无法区分「采集没完成」与「本轮真的没改文件」，与 design「partial 卡片照出」相悖（E6/E8 立意）。修法取 A（实现意图，而非改口径）：partial 且无文件清单 → 渲染 28px 单行提示卡（`data-testid="file-changes-notice"`），文案「工作区快照未完成（超时或队列溢出），本轮改动未知」。
故障面：提示卡与「仅工具编辑」降级卡是**两种**话术（前者「没拿到清单」、后者「没有这项能力」），未来若合并会再次丢语义；`reason` 细分（timeout vs queue_overflow）在快照里保留，但 UI 合并表述——若要区分需在 `notice` 上带 reason。

## D-unmapped-142@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-21-session-git-branch
原编号：D-001@v1
锚点：未记录
最近确认：4f66ab1e2364cbdfeafb01bb48f3dec9c6d08b3a
理由：最大风险：每 60s 轮询触发 daemon `git_status`（内含 `git fetch`，15s 超时）——remote 慢时轮询堆积。缓解：fetch 失败/超时在 daemon 内降级（fetch_error 字段），分支采集（本地 porcelain）不受阻；轮询仅前台可见时执行；多会话面板并开时按 sessionId 各自 queryKey 独立节流，最坏面=可见面板数×1 次/60s（与会话列表 10s 轮询同量级，可接受）。 试过放弃的方案：① 复用 `git_refs` RPC 推当前分支（head sha 与 refs/heads 匹配）——同 sha 多分支歧义 + detached 不可判，放弃；② daemon 新增轻量 `git_branch` RPC（免 fetch）——跨服务契约变更 + 旧 daemon method_not_found 兼容面，轻量变更不值得，放弃（若后续轮询负载实证过重再立项）；③ `git_gateway`（backend 本机 subprocess）查 worktree——worktree 物理位于 daemon 宿主时 backend 不可达，且 session cwd 语义就是 daemon 宿主路径，方向错，放弃。

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

## D-unmapped-143@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-22-review-risk-fixes
原编号：D-001@v1
锚点：未记录
最近确认：c975a003a577bfb5ce79a8445906f9f358939c82
理由：最大风险：FR-04 用 codePoint 重组字面字符后，若输入字符串本身是坏 UTF-16（孤立代理项）产出坏字节——与修复前同样产生乱码但不会更差（防御性等价，且 git 输出不会给孤立代理）。放弃的方案：① 给 `/proto/**` 加 middleware 鉴权——D-010 故障面已登记为独立事项，本次不动鉴权语义（避免 proto 预览页依赖登录态改变 dev 评审工作流），以「数据不进产物/上下文」双层代替；② 把真实导出换成人造 fixture——违背 FR-frontend-018（dev 预览要真实会话观感），不做。

## D-unmapped-144@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-22-daemon-snapshot-report-log
原编号：D-001@v1
锚点：未记录
最近确认：e135cab86ae8863568b5e46d1957f661b38fa068
理由：- **最大风险**：日志量。每轮上报 +1 行（一轮通常也就 1 行 `collected` + 1 行 `reported`），长会话是线性增长；`delivered` 走 info 级、`failed`/`dropped` 走 warn 级，`config.log_level` 调到 warn 时只留异常（正常轮静默），可观测性与噪声可按部署调。另一个风险是**日志不能证明后端落库**——`delivered` 只代表 HTTP 2xx，后端若在事务里 best-effort 吞掉写入仍会丢；故「reported=delivered 但页面无卡」这条仍要靠后端侧查 —— 本变更只把「采到没发」这一半的盲区补上，文档里写明这条边界。 - **试过但放弃**：①继续保留四个零散 `on_turn_snapshot_*` tag 并各自补字段——grep 时要记四个名字，且成功路径仍无 tag，配对不了；②把日志塞进采集器（`turn_file_changes_collected` 里带上报结果）——采集与上报分属两层（SessionManager vs Daemon），采集器拿不到上报结果，硬塞会把上报结果回灌进采集器接口（接口膨胀 + 循环依赖风险）；③用 `console.info` 直接打而不走 `_logger`——绕过 `log_level` 过滤，warn 级部署下也会刷屏。

## D-unmapped-145@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-22-fix-translate-cjk-segments
原编号：D-001@v1
锚点：未记录
最近确认：779a0e3c8865c337e3c385d20482692a03e97199
理由：- 风险：段级只按语言占比判定，中英混排在同一段内（如「这个方法用 `cache` 缓存」）仍会整段送翻，模型对段内少量中文可能仍有破坏——整段送翻是现有粒度的边界，彻底解决需句级切分（成本高、破坏块保真）；当前修复覆盖生产实测的「中文正文 + 代码块」形态。 - 风险：纯数字/符号段判定为不送翻，若模型本可处理（无意义）不影响；可接受。 - 放弃方案：直接调高整条 worthy 阈值。放弃理由：会让「英文正文夹中文」也整条跳过，损失正常翻译。 - 放弃方案：前端也做段级判定。放弃理由：后端是权威兜底，前端重复实现易漂移；整条通过时请求成本可接受。

## D-unmapped-146@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-22-protect-cjk-source
原编号：D-001@v1
锚点：未记录
最近确认：e5dce012e35a102b4c8d37a364e2519df32483df
理由：- 风险：中文片段保护后，正文段可能被切碎（引号、空格、英文单词片段），块数上升、单块过短；模型对极短片段（如孤立的 `"` 引号）可能产出空串或原样。可接受——碎片不携带语义，且 `should_translate_segment` 对无字母/汉字段直接跳过。 - 风险：中英紧邻无空格（如「这个是chunk」）会出现中文保护段与英文正文段相邻，重组顺序仍保真；可接受。 - 风险：轻量模型对英文长句的翻译质量本身一般（本次复现中 `sillyspec decisions add` 被译成「愚蠢的决定添加」），属模型能力上限，不在本变更范围；如需质量提升应另行更换更大模型。 - 放弃方案：调高段级判定的中文占比阈值。放弃理由：中文引用只占句内小部分，占比阈值永远够不到，整段仍送翻。 - 放弃方案：译后清洗反斜杠。放弃理由：治标——中文引用已经被破坏，清洗无法恢复原文语义。

## D-unmapped-147@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-21-task-wakeup-event-queue
原编号：D-001@v1
锚点：未记录
最近确认：e5dce012e35a102b4c8d37a364e2519df32483df
理由：答：最大风险是唤醒条目操作能力收窄的争议——事件行不提供 ✕ 删除/⚡ 立即发送，用户若想丢弃一条待派发通知没有入口（现状 chip 有 ✕）。接受理由：通知是系统自治行为（派发由本轮结束自动触发、会话 interrupt 后立即派发），人工删除是伪需求；且后端删除端点对 task_wakeup 行的权限语义未经核实，前端先不给入口避免能力错配。若后续真有需求，单开小变更核实后端语义后补。死路：①「mid-turn steering 直注入活跃轮」——已否决，router 层 2026-09-20 起恒排队（steering 收敛到队列条 ⚡ 显式入口），为通知重开 steering 通道违背收敛裁定且打断用户可见的执行流；②「泛化 turn_trigger 段（schedule/channel/auto_resume 全分类学）」——本变更不做，呈现架构级泛化留独立变更；③「事件行移出 MessageQueueBar 独立组件」——放弃理由见做法概述。

## D-unmapped-148@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-22-turn-trigger-generalize
原编号：D-001@v1
锚点：未记录
最近确认：7338a61c878a5f33c1d1a0647cf900f2b71c14d1
理由：答：最大风险是内容前缀检测的伪造/漂移面——用户手打 `[系统续跑` 或 `【影子直聊】` 开头会被误标来源行（不丢内容、仅标注错源）；daemon 模板文案改动会静默漏检。双向前缀为 daemon/后端单一源常量且有测试锁定（auto_resume.py 注释「单一源导出供测试锁定」），跨语言同步义务注释落在前端常量处；根治靠 Phase 2 metadata 驱动（设计已排期）。死路：①「run metadata 驱动分类」——Phase 1 放弃（装配签名穿透成本，见做法概述）；②「定时消息并入」——用户裁定留 Phase 2（派发侧无标记需后端动 scheduled_send）；③「每源独立段类型」——组合爆炸，设计对比稿已否决（A 案）；④「shadow/group 前导保留 preamble 段双呈现」——进度视图双卡（来源注入卡 + 触发行）冗余，已裁定触发行替代。

## D-unmapped-149@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-22-askuser-card-inline
原编号：D-001@v1
锚点：未记录
最近确认：05c42dea444bb413efd0c2d6b0a7a9f53e8e0f9d
理由：最大风险：内嵌后用户滚动到长日志深处时新提问卡不可见、错过提问。兜底不缺：①待决策 pill 定位还原保留（点击滚顶+ring 闪烁直达卡片）；②卡片仍在内容流最顶部，回到顶部即见；③输入栏输入轮由后端 permission 队列门控，不答则挂起不丢。 放弃的方案：a) 保留 sticky 但滚动时折叠成细条——复杂度与状态面增加，用户明确不要悬浮形态；b) 新卡到达时自动滚动定位到卡——会打断用户阅读长日志的当前位置，侵略性强，弃。

## D-unmapped-150@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-22-turn-trigger-metadata-p2
原编号：D-001@v1
锚点：未记录
最近确认：125f15809bfcba92270420feb915fffc88a8cec2
理由：答：最大风险是盖戳覆盖群聊键的理论冲突——群聊链路未来若也需 turn_trigger 语义（群聊来源标注），合并序（trigger 覆盖 chain）会吞掉；现状群聊 turn_metadata 不含 turn_trigger 键（键空间不相交），风险登记不设防。次要风险：'schedule' 排队行 origin 若被用户伪造——busy 路径入队的 origin 由 _handle_busy_turn 参数派生（HTTP 注入端点不透传 turn_trigger），浏览器不可达，伪造面不存在。死路：①「run metadata 盖戳」（metadata_.auto_resume_of 同族）——放弃，前端时间线装配以日志行为输入、run metadata 需跨 API 关联穿透装配签名（Phase 1 已评估放弃）；②「前端按内容前缀识别 schedule」——定时消息派发是裸 user prompt 无标记，前缀方案要求派发侧改 prompt 内容（污染正文），metadata 盖戳零污染；③「排队行加新列」——origin 列同族语义复用即可，零迁移。

## D-unmapped-151@v1 轨迹面板以 dsh（deepseek-harness）ui-trajectory 为视觉与交互基准
状态：implemented
变更：2026-10-22-trajectory-view-redesign
原编号：D-001@v1
锚点：未记录
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4
理由：用户提供的截图来自 dsh 的轨迹视图，并明确要求「看 dsh 源码」；参考实现为 deepseek-harness/packages/client/ui-trajectory（CSS Modules + DSH token），本项目需用 Tailwind + themes.ts token 等价实现。
故障面：直接照搬 CSS Modules 类名/API 会引错依赖；必须翻译为 Tailwind + 本地数据模型。
退役判据：本项目轨迹视图形成独立设计体系且不再需要对标 dsh 时。

## D-unmapped-152@v1 顶部固定布局——工具栏与时间线不随账本滚动
状态：implemented
变更：2026-10-22-trajectory-view-redesign
原编号：D-002@v1
锚点：未记录
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4
理由：用户明确「顶部是固定位置的」。dsh 根容器为纵向 flex + overflow:hidden，工具栏 sticky 32px、时间线固定 50px，唯一滚动容器是账本 pane。
故障面：若仍挂在 turn-timeline-scroll 内，整页滚动会把顶部带走（当前缺陷根因）。

## D-unmapped-153@v1 工具栏四项语义与行为
状态：implemented
变更：2026-10-22-trajectory-view-redesign
原编号：D-003@v1
锚点：未记录
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4
理由：时长＝时间线比例开关（实际时长 vs 等宽操作，偏好持久化）；轮次＝展开/收起所有轮次（折叠为“… + 摘要”行）；调用＝展开/收起所有工具调用（合并为“N 个工具调用”摘要行）；搜索＝按文本 AND 过滤账本行并绕过折叠，时间线非命中条降透明。

## D-unmapped-154@v1 账本形态——无表头两列紧凑表格
状态：implemented
变更：2026-10-22-trajectory-view-redesign
原编号：D-004@v1
锚点：未记录
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4
理由：dsh 为无表头两列（事件列 122px + 内容列自适应），行高 30px、下边框；内容列＝类型标签（19px，图标+文字）+ 摘要，有结果时右侧“→ 结果摘要”；耗时/token/状态文字不进行内而进详情；按 turn 分组用竖线与 Turn 标签表达，子工具通过缩进 +26px，无嵌套 DOM。
退役判据：账本信息密度与可读性在其他形态下经实测更优时。

## D-unmapped-155@v1 详情面板——多标签 + 可调宽
状态：implemented
变更：2026-10-22-trajectory-view-redesign
原编号：D-005@v1
锚点：未记录
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4
理由：工具行五标签（概述/参数/结果/Schema/计时），消息类/系统类各有自己的标签集；面板宽默认 clamp(320px,38%,440px)、可拖拽 320–720、双击复位；≤760px 改为抽屉；无选中时不渲染。

## D-unmapped-156@v1 采用组件族拆分方案（B）
状态：implemented
变更：2026-10-22-trajectory-view-redesign
原编号：D-009@v1
锚点：未记录
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4
理由：用户选择方案 B——TrajectoryView 只做装配，新增 trajectory-toolbar / trajectory-ledger / trajectory-detail-panel 三个组件，复用现有 trajectory-timeline 与数据层；数据层（build-trajectory / from-turn-views）不动。

## D-unmapped-157@v1 否决「原地重构 trajectory-view.tsx」（方案 A）
状态：rejected
变更：2026-10-22-trajectory-view-redesign
原编号：D-010@v1
锚点：未记录
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4
理由：用户未选方案 A。
否决理由：单文件将膨胀到 1000+ 行，职责混杂、测试耦合，与项目大文件拆分既有方向相反。
复潮条件：若组件族拆分导致回归面显著超出预期（改动文件数或测试返工翻倍），可退回局部原地重构。

## D-unmapped-158@v1 否决「直接移植 dsh 组件」（方案 C）
状态：rejected
变更：2026-10-22-trajectory-view-redesign
原编号：D-011@v1
锚点：未记录
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4
理由：不可行——dsh 使用 CSS Modules + 自有设计 token 与数据模型，本项目为 Tailwind + themes.ts + SessionTurnView，无法直接复制。
否决理由：依赖与数据模型不兼容，移植成本高于重写且会把两套 token 体系混在一起。
复潮条件：仅在 dsh 改为输出可复用、无框架绑定组件库时重新评估。

## D-unmapped-159@v1 总览缩略条随 D-017 一并裁剪，实际时长保留缩放/平移/双击重置
状态：implemented
变更：2026-10-22-trajectory-view-redesign
原编号：D-021@v1
锚点：未记录
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4
理由：50px 高度预算下无法容纳总览条（原 14px）与三泳道+轴；裁决随说明区一并视觉裁剪。实际时长模式仍保留滚轮缩放、拖拽平移、双击重置；等宽模式保持 D-016 的只读概览。D-016 尾句「保持现有全部交互」中的总览刷子部分由本条修订。

## D-unmapped-160@v1 设计方案与真码原型定稿
状态：implemented
变更：2026-10-22-trajectory-view-redesign
原编号：D-012@v1
锚点：未记录
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4
理由：用户确认按该设计实施；原型经 prototype-as-code 管线编译并登记为变更目录 prototype-trajectory-redesign.html。

## D-unmapped-161@v1 搜索时折叠整体失效，时间线不做降透明
状态：implemented
变更：2026-10-22-trajectory-view-redesign
原编号：D-013@v1
锚点：未记录
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4
理由：有搜索词时所有折叠失效、直接显示全部命中行（含其父轮次与调用组）；零命中显示「没有匹配的记录」空态；时间线条块不随搜索变化（不实现 dsh 的非命中降透明，减少无数据支撑的视觉分支）。我的判断：降透明属纯装饰，本平台先不做。

## D-unmapped-162@v1 折叠/搜索隐藏选中行时清空选中，键盘只遍历可见行
状态：implemented
变更：2026-10-22-trajectory-view-redesign
原编号：D-014@v1
锚点：未记录
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4
理由：折叠状态或搜索词变化后，若当前选中行不再可见，立即清空选中并关闭详情；↑/↓ 只在可见行之间移动；scrollIntoView 只对可见行调用。我的判断：保留不可见行的选中会让用户「看不到却占着详情」。

## D-unmapped-163@v1 工具行参数/结果字段来源（允许 from-turn-views 小改）
状态：implemented
变更：2026-10-22-trajectory-view-redesign
原编号：D-015@v1
锚点：未记录
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4
理由：产品路径工具段已有 `raw`（tool_use JSON 原文）与 `result`（配对的 tool_result 文本）、`primary`（主参数摘要）。映射为 inputText=raw、outputText=result ?? primary；from-turn-views.ts 允许本次小改（仅工具行字段映射与行 id 稳定性），build-trajectory.ts 仍零改动。

## D-unmapped-164@v1 等宽模式为只读概览
状态：implemented
变更：2026-10-22-trajectory-view-redesign
原编号：D-016@v1
锚点：未记录
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4
理由：等宽模式只做条块等宽排列的概览——禁用滚轮缩放、拖拽平移、总览刷子与双击重置，不拦截滚轮默认行为（页面正常滚动）；隐藏时间刻度与轮边界竖线；点击条块仍按等宽几何命中并选中对应行。实际时长模式保持现有全部交互。

## D-unmapped-165@v1 D-007 覆盖 D-005 的 Schema 子项
状态：implemented
变更：2026-10-22-trajectory-view-redesign
原编号：D-018@v1
锚点：未记录
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4
理由：D-007 覆盖 D-005 的 Schema 子项；D-005 的其余内容（标签结构、可调宽、抽屉）继续有效。

## D-unmapped-166@v1 时长偏好为全局偏好
状态：implemented
变更：2026-10-22-trajectory-view-redesign
原编号：D-020@v1
锚点：未记录
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4
理由：采用全局偏好（对齐 dsh 的 `dsh.trajectory.duration`），localStorage key `sillyhub.trajectory.scaleMode`，不按会话区分。

## D-unmapped-167@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-16-session-pill-dock-drag
原编号：D-001@v1
锚点：未记录
最近确认：f0ba3f3fb30b7b0743ad3265a86578205a46ed43
理由：最大风险：拖拽与点击手势冲突（按住 pill 移动一点算点击还是拖拽）。口径=位移阈值 6px（小于阈值放行 click）+ 松手后 250ms 吞 click 时间窗（比布尔位稳：拖出元素外松手 click 不触发，布尔位会误吞下一次真点击）——两者均沿用悬浮球实测过的先例。 试过但放弃：a) pointer capture 实现拖拽——jsdom 无实现（测试不可达）且 capture 会劫持 click 目标破坏 pill 点击；b) 拖动过程每次 setPos 都持久化——localStorage 高频写（悬浮球现状），改为松手单点写；c) 保留 hover 双触发——用户明确要求纯点击防误触；d) 沿用挂载点 absolute 容器改竖排——拖不出面板且受祖先裁剪，改 portal body fixed。

## D-unmapped-168@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-16-provider-switch-transcript-sanitize
原编号：D-001@v1
锚点：未记录
最近确认：030eceeece1388442415e8cd66c3cd3cc443083d
理由：- **最大风险**：把「工具块」降级成 text 块会改变历史的结构语义（模型看到的是一次纯文本陈述而非工具调用）。 影响面评估：本次实证的私有块 `input` 为空、价值全在结果文本里，文本形态保留了全部信息，且优于 「换供应商后该会话永久 400」。 - **死路 1（放弃）**：请求期代理改写——需要 daemon 代理全部 anthropic 流量，性能/安全/越权面不可控。 - **死路 2（放弃）**：直接删除脏块所在记录——会打断 `uuid`/`parentUuid` 链，CLI resume 可能失配； 改为「替换成 text、记录条数不变」。 - **死路 3（放弃）**：直接删私有块、结果文本丢弃——丢上下文且无必要，文本化成本更低。 - **遗留（明确不在本变更范围）**：本机默认会话 + 用户手改宿主机 `~/.claude/settings.json` 换档的路径， 平台无任何变更信号可挂钩，自动化清洗不覆盖；本变更以「分类器可读提示 + 一次性修复实证（task-02）」 兜底，后续如需自动覆盖需单独立项（涉及平台是否代管宿主配置的取舍）。

## D-unmapped-169@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-19-host-settings-live-reload
原编号：D-001@v1
锚点：未记录
最近确认：e5a2c7ee31881d2d20c3f831c729ca01c07a81e5
理由：- **最大风险**：换档瞬间的批量重载会让所有本机默认会话引擎各重启一次（每个约 1-3s、各会话独立 并行）；正在等用户输入的会话无感（下一轮才用新引擎），运行中会话延迟到轮边界。可接受——比 「模型烙死 + 跨供应商 400」轻得多；且有关闭阀。 - **风险 2**：若用户以非 cc-switch 方式频繁改 settings.json 的 env 块（如脚本），会周期性触发重载。 去抖（两拍一致）+ 3s 节拍已把频率压到「真实变化」粒度；重载本身幂等无害。 - **死路 1（放弃）**：daemon 注入 env 覆盖模型/网关——平台不知道宿主档位语义，且实验实证 settings 的 base_url 本来就每轮热生效，注入反而制造新的钉。 - **死路 2（放弃）**：fs.watch（事件式）——Windows 下 cc-switch 若走替换写会掉 watch/漏事件， 还需目录级 watch 兜底；轮询+指纹在 2-6KB 文件上成本可忽略且行为确定（跨平台一致性优先， CLAUDE.md 规则 13）。 - **死路 3（放弃）**：只做 UI 提示不改行为——用户已明确要免手动处理。 - **遗留（明确不在本变更范围）**：宿主机档位变化对「运行中那一轮」仍不生效（轮边界语义，与平台内 切供应商一致）；`/model` 钉在重载后清零属预期副作用（正是解钉手段）。

## D-unmapped-170@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-19-host-settings-reload-latency
原编号：D-001@v1
锚点：未记录
最近确认：ee8bc717b7b00bcc4e78a5e1da5788638735b776
理由：- **最大风险**：空转读文件频率 ×3（每秒读 2-6KB + JSON 解析）。量级可忽略（单核微秒级）， 定时器仍 unref；接受。 - **风险 2**：重载风暴更密（用户连续快速换档时，每 2 秒可触发一波）。上一变更已论证 per-session 串行 + 覆盖写幂等承载得住；去抖两拍本身就是节流。 - **死路（放弃）**：去抖单拍化（见做法概述）；fs.watch（同上变更死路 2）。 - **遗留**：UI 可感知提示（切换时平台界面出 notice）需 daemon→backend→frontend 三端契约 （新端点 + SSE 帧 + 类型再生成），本变更明确不做，留待单独立项。

## D-unmapped-171@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-20-pill-dock-left-align
原编号：D-001@v1
锚点：未记录
最近确认：a303e730226d05a93ba959773366a676cf54aa09
理由：最大风险:存档恢复首帧对齐闪动(恢复帧 items-end、下一帧切 items-start)。已消除——恢复路径改走 `snapPos`,首帧即携带正确 left。 试过但放弃的方案:① render 期读 `dockRef.getBoundingClientRect()` + bounds 现算对齐——render 读 DOM 不纯(ref 首帧为 null),且每次 render 强制布局;② 持久化存档带 left 字段——存档格式变化,既有 toEqual 断言与旧档兼容都要跟着动,left 可从坐标幂等重推导,入档属冗余状态。两案均弃,采用吸附判据单源派生。

## D-unmapped-172@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-20-pill-dock-drag-align-keep
原编号：D-001@v1
锚点：未记录
最近确认：4f77e50c12b353f42e8442aed1fcdfea34234511
理由：最大风险(声明边界):拖拽中把组拖到对面半边但未松手时,视觉位置在左/右而对齐仍是拖拽前方向——这是设计意图(对齐切换只在松手吸附时发生,避免拖拽中过中线来回翻转抖动),非缺陷。 放弃的方案:拖拽中实时按位置中线切换对齐——过中线时两个 pill 的对齐侧来回翻转,组框跟手移动叠加对齐抖动视觉混乱,且拖拽中位置本就是临时态,实时切换无信息增益。

## D-unmapped-173@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-21-agent-profile-slim-default
原编号：D-001@v1
锚点：未记录
最近确认：9458a48db2d349cf18861d098796265ca018fe31
理由：最大风险：daemon prune 是删目录操作，误删会话工作区文件——缓解：复用既有 pruneSkillsToSubset（限定 `<workDir>/.claude/skills/` 基目录、跳过隐藏项与非目录、单条失败仅 warn），且仅 spawn 前置链执行一次；实测门覆盖 daemon 测试。次风险：空=清空语义对存量用户反直觉（选了空技能档案的默认档案会让会话没技能）——缓解：设默认交互处提示「该档案未勾选技能，设为默认后你的会话将不挂载技能」（前端文案警示）。 死路：①档案行级 is_default 列（仿供应商）——放弃：档案跨用户共享（workspace/platform 可见），行级标记会让甲的默认影响乙，必须用户级存储；②改通用 pickStrList 空数组语义——放弃：effectiveAllowedRoots 等多调用方依赖「空=不过滤」既有契约，新 strict 变体隔离影响面；③热切换会话技能重挂载——v1 不做：需 daemon 会话存活期重跑 link/prune 链，收益低复杂度高，记边界。

## D-unmapped-174@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-21-provider-default-ui-hint
原编号：D-001@v1
锚点：未记录
最近确认：01207058ca048f4015b4074b38e32f1e2bba4335
理由：最大风险：历史轮 timeline 用当前默认名标注的轻微失真（默认改名后历史轮名跟着变）——已声明可接受（FR-02），优于现状「本机默认」的反向误导。死路：把默认名写进会话/轮快照（config_snapshot）——放弃：属后端改动且引入快照一致性维护，显示问题不值当。

## D-unmapped-175@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-21-profile-default-prehint
原编号：D-001@v1
锚点：未记录
最近确认：9711e7721de76c3f71b59ac13d1bb63815c7ed53
理由：最大风险：provisional 兜底项文案「不指定（默认：名）」与运行中「不指定（无人格）」语义并存，用户切换会话形态时文案变化——有依据（两态实际语义确实不同），非漂移。死路：把默认名显示进非 provisional 会话——放弃：该会话不会注入默认，显示即撒谎。

## D-unmapped-176@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-22-agent-profile-modal-restyle
原编号：D-001@v1
锚点：未记录
最近确认：2fef11f807db97a27cdbd0f4fb036d7030bf821c
理由：最大风险：既有单测查询方式依赖旧 DOM（antd Checkbox.Group 的 label 结构），重构后需按新 DOM（芯片以 role=checkbox/aria-checked 暴露）调整查询手段——行为断言不变、只改查询方式，逐用例核对防止「改测试凑通过」。次风险：antd Modal title 传 ReactNode 后高度变化在不同视口的表现，靠实页三主题截图对照兜底。已放弃方案：①继续用 antd Checkbox.Group + options render 定制两行芯片（Group 布局受限、工具栏与三态联动要绕过 Group 自身 state，别扭且难测，放弃）；②全局滚动条主题化（影响面全站，超出本变更范围，收窄为作用域工具类，全局化留给后续独立变更）。

## D-unmapped-177@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-22-agent-profile-edit-refresh
原编号：D-001@v1
锚点：未记录
最近确认：302ebb786c739b33837b2fda22f89141637412bb
理由：风险极低（追加一次幂等失效调用）。已放弃方案：①在全局页给表单传 onSuccess 回调手动失效（页面层补丁，只修全局页一个消费面，工作区内页若他日复用同形态还会漏，且表单 props 要加口子；放弃）；②把四个 CRUD hook 全部补 mineList（delete/copy 的消费页列表桶本就正确，全局页复制/删除已有页面层手动失效覆盖，扩大面无实证收益；本变更不动）。

## D-unmapped-178@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-22-merge-test-debt
原编号：D-001@v1
锚点：未记录
最近确认：457db3f86efa272c64aeacd06333aa538f3636ea
理由：最大风险：文案中文化对依赖英文 message 做断言的下游测试造成破坏。已核查：全量 backend 套件除本变更修复的 3 红外无其它红（9058 绿），无测试 pin 这两句英文原文。放弃方案：把英文文案登记进 l10n 守卫的 `ALLOWED_ENGLISH` 白名单——放弃理由：这两条是面向用户的报错（403/413），项目惯例（守卫文档自述）是用户可见文案中文化，白名单是给机器码/专有名词的，走白名单会把该守卫的立规意图绕空。

## D-unmapped-179@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-22-merge-regression-fixes
原编号：D-001@v1
锚点：未记录
最近确认：c4a82ff0be9d18ad4cdaa333e43ff178b0007e8b
理由：最大风险：扩容 metadata 闭包引入 users↔agent_profiles、workspaces↔agent_profiles 环——姊妹 conftest 已实证同形态可建表（SQLite 内存库 + to_metadata + create_all），本变更照抄该范式并在隔离复跑中验证 62 passed。放弃方案：给 agent_profiles 建仅含 id 列的 stub 表——放弃理由：stub 与真实表结构漂移会掩盖后续 FK 问题，纳入真实表闭包与姊妹模块一致、可维护。

## D-unmapped-180@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-22-change-delete-session-history-fix
原编号：D-001@v1
锚点：未记录
最近确认：a0af14684ac4433ef87f97e4f33906c9e5e9f6f4
理由：最大风险：改为 SET NULL 后，被删 change 的执行 run 会保留但失去 change 归属；`_change_run_ids` 的无锚分支可能把这些 run 归到同会话其它 change，导致用量报表轻微漂移。缓解：仅在 change 物理删除（低概率）时发生，用量按 run 去重不重复计数；在 `agent.md`/`change.md` 文档登记该语义。 回灌格式风险：引擎 JSONL 与 daemon 线上上报格式存在细微差异，渲染可能不完全一致。缓解：严格对齐 `_persist_agent_event` 的 `[ASSISTANT]/[THINKING]/[TOOL_USE]/[TOOL_RESULT]` 前缀与 `metadata.agent_event` 形状；回灌行带 `restored_from` 标记，便于按 run id 回收；生产先 dry-run 再 apply。 迁移对账误伤：全局 `turn_count` 下调可能影响未知会话。缓解：只下调（`turn_count > expected`），expected 只统计有 user_input 日志的 run，`tool_report` 的 0 语义天然保留；迁移前备份 `agent_sessions`。 放弃方案 A：只把 reparse 里的 `session.delete` 改成逐条搬 run——路径多（reparse、占坑回滚、未来新增删除入口），漏一处就复发，不是根治。 放弃方案 B：把左栏轮数改为列表接口实时聚合 `count(runs)`——改动面大、每会话子查询性能风险，且会改变 `tool_report` 的 `turn_count=0` replay 语义；保留存储列 + 对账路径更稳。

## D-unmapped-181@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-22-file-changes-card-fix
原编号：D-001@v1
锚点：未记录
最近确认：c2a675686324f2ee56e0a3b2a7a5c5c27a1754b8
理由：最大风险：慢盘上从 2 条 git 命令增至 3 条，首轮仍可能超时；但 `/mnt/` 基础预算提升 + 超时后自动升级 + 超时保留清单，使「超时后整卡空白」不再发生。另一个风险是「本轮改动」口径扩大：轮内 commit 的文件现在会出现，卡片数字可能比以前大——这是修复目标（以前漏报），需在发布说明中明确。 放弃方案 A：只调大 timeout——不解决轮内 commit 漏报与 numstat 超时丢清单。 放弃方案 B：只用 `git diff --name-status` 不跑 numstat——行数全变破折号，信息退化。 放弃方案 C：忽略文件读到真实行数——`/mnt/e` 上读文件比 git 更慢，且 untracked 可能很大；保持诚实破折号。 放弃方案 D：给卡片加「重新采集」按钮——需要新增 daemon RPC 与平台端点，超出本次修复面，留作后续。

## D-unmapped-182@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-22-sillyspec-probe-db-missing-evict
原编号：D-001@v1
锚点：未记录
最近确认：b01334c76b3644cff83b081c3942d73823c95f46
理由：最大风险：把「暂时没 init 但马上要 init」的项目误淘汰——项目 init 后 workspace 重新 claim 会重新注册根，且淘汰阈值 3 次（默认采集间隔 + backoff）留了观察窗；误淘汰代价仅是面板暂缺该工作区数据，重新 claim 即恢复。 次要风险：CLI 未来在 db_missing 时改掉 stdout envelope 契约 → 解析不到 codes 回退既有 nonzero_exit 记账（降级不劣化）。 放弃方案 A：restore 时向平台批量核对工作区存活状态——boot 增加平台往返与失败面，且运行期删除的工作区仍会残留到下次重启，不如运行期连败淘汰直接。 放弃方案 B：CLI 侧 db_missing 改 exit 0——改机器接口语义，影响其他消费方，违反「CLI 零改动」。

## D-unmapped-183@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-20-session-awaiting-answer-status
原编号：D-001@v1
锚点：未记录
最近确认：c0dbab0121e933d6bbfec711f0839bec0c580290
理由：最大风险：列表刷新频率下新增一次 IN 查询的负载。评估：与既有 owner_name/current_run_status/terminating_at 注入同构（同一查询函数内多次 IN 批查），单表 `idx_session_dialog_requests_status` + session_id 索引齐备；10s/30s 轮询与事件驱动共用的仍是同一次列表查询，增量成本可忽略。 另一风险：`dialog_kind` 语义扩容（如未来出现非「等用户回答」的持久化对话类型）会误显示问号——以「所有持久化 pending 对话即等用户回答」为当前契约（模型注释明示：普通 canUseTool 审批不落行，落行的都是 may wait indefinitely for a human answer）。若未来出现例外，在该注入点按 kind 白名单收窄即可，改动局部。 试过但放弃的方案： - 前端用 `fetchPendingDialogs`（workspace 聚合端点）在 portal 侧合并——portal 有 workspace/change/quicklog 三 scope，要各自请求+合并+多一轮轮询，且未打开会话也在左栏，聚合端点按 workspace 粒度不匹配行级展示。放弃。 - 复用活性 `blocked` 区分——blocked 是 tailer 10s 推导的通用「停住」态，无法区分等审批/等回答/其它阻塞，且本地 CLI 会话 30s 轮询下最坏 ~40s 才可见。放弃。 - 在 run 表加列——写路径多、语义错位（等待是对话请求状态而非 run 状态）。放弃。

## D-unmapped-184@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-22-conversation-live-marquee
原编号：D-001@v1
锚点：未记录
最近确认：0bc8e38f727cf2fe343cea748bf7cc493aa8c50e
理由：- 最大风险：流式高频更新导致派生/重渲染成本。缓解：派生 `useMemo` 只依赖 `segments` 引用，条目上限 200；滚动由单条 rAF 直接写 `transform`，不触发 React 每帧 state 更新；组件 `memo` 隔离。 - 交互风险：跑马灯持续动效可能干扰阅读。缓解：单行低矮、低调配色、`aria-live="off"` 不打扰读屏；终态立即消失；用户上滚使轮尾离开视口时 IntersectionObserver 自动停表。 - 视觉风险：窄屏下超长工具参数撑破。缓解：条目等宽 13rem + `truncate` + `min-w-0`，轨道容器 `overflow-hidden`，整行不产生横向滚动。 - 动画正确性风险：轨道内容变化（新增条目）时目标位置需重算，否则最新条可能停不进视口。缓解：`entries` 变化即重算 target，只向更负方向推进、不回滚；首次挂载直接定位到最新。 - 放弃方案：① 吸底悬浮（用户明确选择"运行中轮末尾"）；② 多行信息牌 / 竖向事件流（用户选择单行横向跑马灯）；③ 每条思考 delta 都入队（会刷屏，改为按段 id 就地去重）；④ 复用「进度」视图的完整时间线（信息密度过高，违背"不必看清"的目标）；⑤ 固定节奏逐条停留 + 循环回放（用户裁决改为连续流动、不循环、只流到最新）。

## D-unmapped-185@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-23-translate-budget-align
原编号：D-001@v1
锚点：未记录
最近确认：3cdca075ab2d93060e02b6ef663af8d05165bde6
理由：最大风险：修复 1 的「最坏块数」估算通常精确（前端单段块按 1800 硬切、`ceil(len/1000)` 是其上界），但**保护段碎裂**（单块内多个 <1000 可译 run 被保护段隔开，块数超 `ceil(len/1000)`）或长句贪心装箱形态下可能低估 >2 块——此时后端预算反超前端死线，前端先 abort（回退原文 + 60s 退避），重现 FR-01 要消除的误杀形态。降级边界已裁决：可接受——HTTP 断开不触发后端 `_on_crash`（不累计崩溃计数/不进 600s 退避），后端线程照常完成推理并写双层缓存，退避期满重试即命中缓存恢复；触发需单条内 ≥3 个保护段的罕见碎裂。修复 2 的风险是重构 `translate_items` 主编排引入回归——用既有 12 个 service 用例 + 新增乱序用例钉死全等断言。修复 3 改 `_reader` 签名是内部私有面，风险低。 放弃的方案：①后端预算封顶 20s 并缩批——放弃，直接推翻 e7ce2a101 的生产实测结论，重新引入满批误杀；②前端按「条数」而非「估算后端块数」算超时——放弃，前端块 1800>后端 1000，16 条最多膨胀 32 块，按条数算（57.5s）仍会被 97.5s 预算的后端合法超出；③engine `_stop` join 读线程——放弃，Windows 管道 EOF 交付时机不可控，join 可能阻塞崩溃恢复路径，队列构造时捕获以零等待达成同一隔离。

## D-unmapped-186@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-23-semantic-color-scale-fix
原编号：D-001@v1
锚点：未记录
最近确认：aeae93b1364ac8a3e84863afc939e3fd625da7ca
理由：最大风险：`color-mix` 的混合比例是目测估算（10%/35%/50%），与传统 Tailwind amber-50/200/700 的观感存在细微差异；且低版本浏览器不支持 color-mix 时数字阶声明失效（项目既有 brand/slate 透明度已使用 color-mix，基线浏览器要求一致，不新增兼容风险）。缓解：700 档已按评审 P2 以 WCAG AA 复算把基色占比从 75% 降到 50%（两套浅色主题 × 三调色板对 bg-50 的最小对比度从 3.08:1 提升到 5.07:1，全部 ≥4.5:1），并以真实构建 + 对比度复算固化；若某档观感偏差大，后续调比例即可（单点改动）。 试过但放弃的方案： - 改调用点为 DEFAULT 单色（`bg-warning-500`→`bg-warning`）——只能救实心点，救不了徽章的「软底+描边+深字」三档设计，等于降级视觉；且要改两个组件多点，回归面更大。放弃。 - 在 globals.css 为三套主题各补 12 个分档变量——变量块膨胀 36 行且与「基色变量派生」的既有约定重复，主题新增/调整时需同步多处。放弃。 - 直接写死 Tailwind 默认 amber/red/cyan hex 阶——违反对照原型与「无硬编码色值」铁律，深色主题对比会失真。放弃。

## D-unmapped-187@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-23-review-risk-fixes-2
原编号：D-001@v1
锚点：未记录
最近确认：d5025964ba5f773353e8fbe92bcf4c07569660ea
理由：最大风险：修复 1 的键控放宽使「同根换 wsId 重建但项目侧仍缺库」形态多付 3 拍探测（约 90s）才重新淘汰——对比旧形态的「永久静默停摆」，属可接受的有限成本。另按评审 P3 补披露：**多个活跃工作区同根且项目侧永久缺库**时，双方连败会交替互覆 Map 条目（ROOT→ws-a/ws-b），稳态退化为每轮约 1 次探测——这是双键判定的规定行为（每个 ws 各自重新计满连败才淘汰），warn 被 `_evictedSkipLogged` 封顶不刷屏，可接受。修复 2 的风险是重启链路遗漏（target 更新但未重启滚动）——`applyTarget` 是 target 更新的唯一入口，ensureScroll 挂其尾部即全覆盖，可见性恢复另有点位。修复 3 的回调是可选参数，漏传即静默（与旧一致），由 session-manager 唯一生产调用点接线兜住。修复 4 的退避策略对脏体与网络失败一视同仁——单次脏体触发 60s 退避略保守，但防风暴优先（与 engine_ready=false 同款口径）。 放弃的方案：①在 daemon.ts evict 回调里二次核对映射再放行——放弃，治标不治本：skip 表仍在 manager 侧裸根键控，legacy 单槽位路径不经过回调，竞态窗口仍在；②给 `TurnFileChangesReason` 加 `git_error` 枚举值——放弃，types 注释明令「固定枚举，禁止新增值——错误按事件命名，不造无依据枚举」，加值违反模块自身设计契约且牵动前端 reason 映射；③修复 2 用「追平后降频轮询（如 1fps 续排）」——放弃，仍是空转只是变慢，且引入与速度常量耦合的第二节拍；④修复 4 只兜 null 不退避——放弃，脏体通常意味着代理/网关异常，不退避会对异常源形成请求风暴。

## D-unmapped-188@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-23-turn-file-diff-dialog
原编号：D-001@v1
锚点：未记录
最近确认：c91a1d6c30d543016c1570e8bdc00cade0374987
理由：答：最大风险是补丁配对覆盖率——subagent（Task 工具）内部的 Edit 日志带 parent_tool_use_id/depth 归属列，文件卡 numstat 归因不区分主/子代理；方案按「本轮全部日志（含子代理行）」配对，多出的补丁段照实展示（它们确实改了该文件），不做主/子过滤（过滤反而丢内容）。Write 新建文件的 structuredPatch 可能缺行号形态，parseStructuredPatch 对形状不符返回 null → 该段占位「补丁格式不可解析」，不伪造。 试过放弃的方案：① 给 daemon 快照 DTO 增加 patch 文本字段——放大 /runs 全量轮列表载荷（500 文件上限 × patch 体积），且历史轮无数据，放弃；② 新增 daemon `git diff baselineHead -- path` 端点实时重算——可覆盖 shell 归因行，但需 daemon HTTP 面 + backend 代理，且历史正确性妥协（后续轮改同一文件后 diff 不再是「本轮」内容），跨度超出本需求决策面，记为后续独立变更候选；③ 点击跳转 agent-log 视图——非弹窗形式，违背用户明示「弹窗形式」。

## D-unmapped-189@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-22-askuser-dock-inputbar
原编号：D-001@v1
锚点：未记录
最近确认：17f2273dc06c094cd830f77fce052c55e8606933
理由：最大风险：pending 期间输入框不可用——用户想「先不答、先输入别的内容」没有入口。缓解：卡头最小化按钮保留，最小化后右下角胶囊可还原；pill 定位还原保留；且 pending permission 语义上本就阻塞 agent 轮次（先答后问语义），输入框被替换与队列语义一致。此边界为用户显式裁决（「替换底部的用户输入框（遮挡）」）。 次风险：SessionInputBar 重挂载丢内部局部态（光标/展开的菜单）——受控值全在父级，丢的只是瞬时 UI 态，可接受。放弃的方案：a) absolute 定位把卡覆盖在输入栏上（输入框仍挂载）——「遮挡」会露出输入栏残边、且输入栏仍可聚焦与「答题优先」语义矛盾，弃；b) 全部最小化时恢复输入框（需最小化状态上抛或受控化）——状态同步面增大、交互分叉（输入框出现/消失多一层条件），且「pending 期间不该发新消息」语义下价值低，弃；c) 保留 TurnTimeline 内渲染不动、仅用 CSS 把卡定位到输入区——跨组件定位（卡在滚动容器内、目标在容器外）需 hack（fixed/portal），脆弱，弃。

## D-unmapped-190@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-23-marquee-item-detail
原编号：D-001@v1
锚点：未记录
最近确认：f4421724555649a61a85146556038565c84c0b3b
理由：- 最大风险：条目内部滚动与轨道滚动叠加造成视觉噪声。缓解：只有 running 条目内部滚动（通常 1~3 条），完成条目静止；轨道速度仍按追赶距离自适应。 - 短文本循环重复感：用双份文本 + 固定窗口，文本很短时会出现重复片段；属纯感知场景的可接受取舍（用户不需要看清）。 - 时长准确性：thinking 为客户端观测时长，受挂载时机影响（边界已在上文披露）；工具/子代理使用段真实时刻，不伪造。 - 放弃方案：① 继续用 emoji 图标（用户明确要求项目 lucide 图标）；② JS 逐帧滚动内部文本（与轨道 rAF 叠加成本高，改用 CSS animation）；③ 用「当前时间 − 段 ts」填充历史思考耗时（会伪造，违反宁缺勿假）；④ 条目加交互展开（用户已裁决纯感知不交互）。

## D-unmapped-191@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-23-marquee-ticker-speed
原编号：D-001@v1
锚点：未记录
最近确认：33645b42e6613df200997828141cff7eabdaafba
理由：- 风险：速度过快时短文本重复感更明显；3s 为折中值，若仍不合适继续微调该单一常量即可。 - 放弃方案：按文本长度动态计算时长（需要测量宽度、增加 JS 复杂度，收益有限）；改轨道整体速度（用户只反馈条目内部滚动慢，轨道行为已被确认）。

## D-unmapped-192@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-23-live-turn-meta-time
原编号：D-001@v1
锚点：未记录
最近确认：475a8da2eec4b9e711dbd43e881244d506a474aa
理由：最大风险：RoundDivider 是 memo 组件，detail 从 string（值相等可命中 memo）变为运行中轮每渲染新建的 React 元素 → 该轮 RoundDivider memo 恒 miss。评估：仅单条运行中轮受影响、RoundDivider 渲染成本极小（几个 span），且运行中轮本就随流式 delta 高频重渲染（tokens meta 同步变化），无可感差异；终态轮 detail 仍是 string，memo 命中率不变。 放弃方案：① 父级 TurnRow 持 interval 整体重算 metaDetail——每秒整轮重渲染，违反渲染经济铁律（FR-06 惯例，TurnStatusBar 注释明载 tick 不外溢），放弃；② 只改数据层（running → replyAt=null）——该位置整体消失，不满足「进行中显示实时走秒历时」的用户裁决，放弃；③ RoundDivider 开专用 liveElapsed prop——为单场景在共享组件上扩接口面，比向后兼容的类型放宽侵入更大，放弃。

## D-unmapped-193@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-23-askuser-history-live-sync
原编号：D-001@v1
锚点：未记录
最近确认：cd3a5746b656945ae7c55a801932582e1ba94d7d
理由：最大风险：resolved 事件到达时后端答案落库与事件推送的时序竞态——若推送先于落库（理论窗口），重拉拿到的仍是 pending 态，记录短暂停留未更新，直到下一次事件/刷新兜底。评估可接受：backend 的 resolved 语义是"请求已收口"（落库后广播），实际窗口极小；且问答级频率下无重试风暴风险。 放弃的方案：a) 前端把 SSE 事件手工转 SessionDialogRead 增量 append/merge——resolved 事件不含 answers（SessionPermissionResolved 无答案字段），必须伪造或再查单条，且 id/created_at 等 REST 字段 SSE 缺失，拼装体与刷新后权威数据不一致（闪变）；b) 后端在 resolved 事件里加 answers 字段——动 SSE 契约+后端，改动面大且只解决 resolved 一半（request 到达仍需转换），违背"前端回显权威数据"原则；c) 轮询 dialogHistory——问答级频率用轮询浪费且延迟不可控。均弃。

## D-unmapped-194@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-23-file-card-agent-grouping
原编号：D-001@v1
锚点：未记录
最近确认：0ea7bf0d129c6dfba9a04915c83c36329bbfbbfd
理由：答：最大风险是「本轮AGENT 0 个但 shell 很多」的形态——用户会先点开卡只看到空列表 + 按钮行，可能困惑；缓解：agent=0 时头部第一段显示「本轮AGENT 无直接文件编辑」（不渲染 +0 −0 假零），按钮行置顶显眼。次要风险：双段标题在一行 28px 内拥挤（长数字/窄面板），处理：两段间分隔符 + min-w-0 截断，两端 shrink-0。 试过放弃的方案：① daemon 侧给快照加「并行会话」独立归因（把 shell 再拆 command/parallel）——需要 mtime/进程级证据，daemon 现有采集拿不到可靠信号，放弃；② 前端按路径启发式猜并行会话（如 .sillyspec/ 前缀）——路径黑名单是伪归因，误伤用户业务文件，放弃；③ 两张独立卡片（agent 卡 + 其他卡）——把一个快照拆两张卡破坏「一轮一卡」的既有形态与测试锚，用户要的是卡内分组不是拆卡，放弃。

## D-unmapped-195@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-23-session-input-clear-fix
原编号：D-001@v1
锚点：未记录
最近确认：f4cceafeb72c4b28c56c69a96d4d642f2b5b87e0
理由：- 最大风险：立即清空后「失败窗口期」用户误以为发送成功。缓解：失败路径既有 errorMsg/notify 提示（不变），且文本自动恢复到输入框。可接受。 - 放弃方案 A「发送时输入框转禁用+spinner 等响应」：不解决切换会话后的草稿残留，且阻塞连续输入，体验更差。 - 放弃方案 B「卸载 cleanup 里清草稿」：卸载时无法区分「发送在途」与「用户主动切走（草稿应保留）」，语义不可判定，死路。 - 放弃方案 C「dialog 模式（session-panel-dialog.tsx）同步修」：用户报障场景为会话页面（page 模式）；dialog 无测试覆盖基础，本变更不扩面，遗留同构问题已知并记录。 - 预会话「不回读草稿」牺牲了「预会话写一半切走再回来继续」场景：与「新建=全新开始」预期冲突时取后者（用户报障明确）；真会话草稿不受影响。

## D-unmapped-196@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-23-marquee-motion-polish
原编号：D-001@v1
锚点：未记录
最近确认：997f1963fcc327dd57cce4cc431382d1c309270c
理由：- 风险：流光调得过淡会“看不见”，过亮又会干扰；本版取 22% 宽 + blur + 6.5s 周期为柔和档，可在原型上继续微调。 - 速度曲线：最小速度 40px/s 保证不会出现长时间拖尾；上限 1600px/s 保证事件爆发仍能追平。 - 遮罩兼容性：同时写 `mask-image` 与 `-webkit-mask-image`；不支持时退化为无渐隐（不影响功能）。 - 放弃方案：① 纯指数缓动（尾巴过长、停止时间不可预期）；② 动态测量每条文本宽度调整滚动时长（收益有限、增加大量 observer）；③ 完全去掉流光（用户要“优化”而非“删除”）。

## D-unmapped-197@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-23-diff-dialog-copy-fallback
原编号：D-001@v1
锚点：未记录
最近确认：f6b0aa43c19e5ea9fc198380a8a79e78ba0b8f47
理由：答：最大风险是复制文本与 DiffView 视觉行的对齐预期——用户可能期望复制的内容可直接 `git apply`，但平台没有 hunk header（`@@ -a,b +c,d @@`）与文件头，纯前缀文本不能直接应用。缓解：按钮 label 与段标题明确语义（「复制该段 diff」），脚注保持「仅行级内容」表述；不伪造 header 是刻意选择。 试过放弃的方案：① 直接复制原始 edit_patch JSON——粘贴出去不可读且与脚注「完整内容」语义不符，放弃；② 给 diffRowsToText 拼造 unified header（用 rows 行号推 @ 头）——hunk 边界信息已丢（分隔伪行是视觉标记），拼造可能错位误导 git apply，放弃；③ 升级 DiffView 为内置复制（改共享组件签名）——DiffView 现有 5+ 消费方（agent-log 工具卡、daemon tool-args-detail）都有自己的复制兜底，改共享件会牵动面过大，本变更在弹窗消费侧挂按钮即可，放弃。

## D-unmapped-198@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-23-diff-copy-p3-cleanup
原编号：D-001@v1
锚点：未记录
最近确认：e849e16ee3a34212c2abfd144b0503f6064b6b1d
理由：答：最大风险是脚注文案过长挤压 85vh 弹窗的可视区——缓解：脚注保持 10.5px muted 两行内文案，追加在半句后而非独立段；若仍拥挤可后移为 tooltip（本变更不做，避免过度设计）。 试过放弃的方案：① 给 diffRowsToText 加缓存（Map by rows 引用）——rows 每段唯一且弹窗生命周期短，缓存无收益还增加清理面，放弃；② 改 CopyButton 共享组件加 builtin getText 优化——其 getText 已存在，无需改；③ 回改上一变更归档的 requirements 修正 FR-02 措辞——归档件冻结（审计真相），不回改历史文档，放弃。

## D-unmapped-199@v1 每轮注入【网络环境】前导段，不动首轮一次性策略
状态：implemented
变更：2026-10-23-session-network-context
原编号：D-001@v1
锚点：backend/app/modules/daemon/session/service/inject.py:433
最近确认：55e50da155266013c97475c0c6787bd964170980
理由：每轮注入。复用【页面上下文】的每轮注入通道先例（backend/app/modules/daemon/session/service/inject.py:433 的 page_context 参数，create.py 与 control.py:246 两处复用）；既有 D-002「前导仅首轮拼装」决策不触碰，网络环境走独立每轮段。
故障面：每轮注入若不去重会重复烧 token——由 D-006 去重机制对冲。
退役判据：若平台改为会话级网络信息主动推送（WS 通道）且 agent 可按需查询，可退役每轮注入。

## D-unmapped-200@v1 同网段判定双源——后端观测 daemon 请求源 IP 为 ground truth，daemon 自报网卡列表用于拼访问地址
状态：implemented
变更：2026-10-23-session-network-context
原编号：D-002@v1
锚点：未记录
最近确认：55e50da155266013c97475c0c6787bd964170980
理由：我的判断：双源。①后端从 daemon 心跳/注册请求直接观测来源 IP（复用 auth 模块 _client_ip 的 XFF 最右段逻辑，提为公共工具），这是平台亲眼所见、不可伪造的 ground truth，落库 daemon_instances；②daemon 心跳体新增自报 network_interfaces（os.networkInterfaces 过滤后），用于给 agent 拼「用哪个 IP 访问机器上的服务」（机器多网卡时观测 IP 只有一个，拼 URL 需要网卡列表选合适地址）。CIDR 匹配在两源上做：用户请求源 IP vs daemon 观测 IP（主判定）、vs 各网卡 IP（辅助，找可达地址）。
故障面：daemon 经 NAT 出口访问平台时观测 IP 是 NAT 出口而非机器本机 IP——同网段判定仍成立（用户与 daemon 同 NAT 即同可达域），但拼 URL 必须用自报网卡列表。
退役判据：无（观测 IP 是零成本副产品，长期保留）。

## D-unmapped-201@v1 共享机器的内网 IP 对借用人可见
状态：implemented
变更：2026-10-23-session-network-context
原编号：D-004@v1
锚点：未记录
最近确认：55e50da155266013c97475c0c6787bd964170980
理由：可见。内网 IP 属低敏信息（不出局域网无路由意义），共享语义本身即「授权在这台机器上干活」，拼访问地址是借用场景的核心诉求；方案中已建议、用户「做吧」批准。
故障面：内网拓扑对借用人暴露——接受（共享授权已含更高权限的机器操作权）。

## D-unmapped-202@v2 共享机器权威口径 = grants 表（supersedes D-005@v1）
状态：implemented
变更：2026-10-23-session-network-context
原编号：D-005@v2
锚点：未记录
最近确认：55e50da155266013c97475c0c6787bd964170980
理由：我的判断（经源码查证）：绑定机器仍查 workspace_member_runtimes（本人 runtime 绑定）；共享借用查 daemon grants 表——grants/queries.py:352 的 resolve_granted_daemon_for_borrow 注释明确记录借用判定已从 member_runtimes/queries.py:171 的 binding 表迁移至 grants 表（enabled=TRUE / grantee 工作区+成员 / 非本人 / online，语义逐条等价）。网络环境段的机器清单与派发链路同源，复用该函数族查询。
supersedes：D-005@v1
故障面：口径再迁移（grants 表重构）时本清单滞后——与派发链路共用函数族可同步演进。

## D-unmapped-203@v1 注入去重——内容快照变化才重注 + 会话内最短间隔兜底
状态：implemented
变更：2026-10-23-session-network-context
原编号：D-006@v1
锚点：未记录
最近确认：55e50da155266013c97475c0c6787bd964170980
理由：网络环境段内容做规范化快照（源 IP + 各机器判定结果摘要的 hash），与上一轮相同则不重注（只在首轮注入）；变化（用户切网、机器上下线）才重注；另设最短重注间隔（60s）防移动网络 IP 抖动导致连注。快照存 Redis（会话级 key，TTL 7 天）。
故障面：Redis 快照丢失→多注一次，无正确性影响。

## D-unmapped-204@v1 排队/steering 轮注入语义——入队存用户 IP，派发时重算判定
状态：implemented
变更：2026-10-23-session-network-context
原编号：D-012@v1
锚点：未记录
最近确认：55e50da155266013c97475c0c6787bd964170980
理由：我的判断：镜像 page_context 的入队存储模式——入队时把 user_ip/has_xff 随条目序列化存储（queue.py:304 同款）；派发/steering 重放时用存储的用户 IP + **实时**机器数据（daemon 心跳最新态）重算判定并注入，不重放旧判定文本。排队窗口通常秒级~分钟级，用户 IP 变化概率低，机器状态取最新最准。
故障面：排队期间用户切网→派发用旧 IP 判定——接受（窗口短，且下轮提问即纠正）。

## D-unmapped-205@v1 快照 60s 窗口语义——不吞变化，到点补注
状态：implemented
变更：2026-10-23-session-network-context
原编号：D-013@v1
锚点：未记录
最近确认：55e50da155266013c97475c0c6787bd964170980
理由：我的判断：Redis 存「上次**已注入**的内容 hash + 注入时间戳」。当前渲染 ≠ 上次注入且 ≥60s → 注入并更新；<60s → 不注入也**不更新**快照，下一轮重新比较，到点即补注。变化永不丢失，抖动被窗口吸收。
故障面：无新增（相对 D-006 仅明确写入时机）。

## D-unmapped-206@v1 心跳契约扩展须同步四个钉子测试文件
状态：implemented
变更：2026-10-23-session-network-context
原编号：D-007@v1
锚点：未记录
最近确认：55e50da155266013c97475c0c6787bd964170980
理由：知识库共享断言面钉子②：daemon 心跳加参（sillyhub-daemon/src/daemon.ts _sendHeartbeatOnce 平铺传参）后，length 钉四文件必须全部 N→N+1：tests/daemon-heartbeat-pending.test.ts、tests/daemon-heartbeat-sillyspec.test.ts、tests/sillyspec-platform-command.test.ts（6 处）、tests/integration/selfupdate-scenarios.test.ts（2 处）。同一变更内完成，否则 CI 补红。
故障面：遗漏任一钉子文件即 CI 红——task 清单显式列出四文件。

## D-unmapped-207@v1 daemon_instances 加 JSON 列 + Alembic 迁移，链尾锚测试前移一行
状态：implemented
变更：2026-10-23-session-network-context
原编号：D-008@v1
锚点：backend/tests/test_align_platform_change_events_migration.py
最近确认：55e50da155266013c97475c0c6787bd964170980
理由：我的判断：daemon_instances 新增 network_info JSON 列（存 {observed_ip, interfaces:[{name,ip,cidr,family}]}，单列整体读写）+ observed 单独查询便利不加独立列（JSON 内取）。不复用 capabilities（语义混杂）。新 Alembic 迁移落库时必须前移链尾锚测试 backend/tests/test_align_platform_change_events_migration.py 的 head 常量一行（知识库钉子①）。
故障面：老版本 daemon 未升级时 network_info 恒 NULL——判定降级为「无网卡数据，仅观测 IP」，不报错。

## D-unmapped-208@v1 实现方案选定——方案 A 平台自动注入（每轮 CIDR 判定 + 前导段注入）
状态：implemented
变更：2026-10-23-session-network-context
原编号：D-009@v1
锚点：未记录
最近确认：55e50da155266013c97475c0c6787bd964170980
理由：用户选定方案 A：daemon 心跳上报网卡 + 后端观测落库 + 每轮 CIDR 判定生成【网络环境】段自动注入。理由：原始诉求是「agent 每次回答时都知道网络情况」，只有注入保证 100% 触达；B 依赖 agent 主动查询、最需要的场景最容易漏；C 浏览器探测被 Chrome mDNS 混淆封死且 agent 依旧无感知。
故障面：见 D-001/D-006（token 成本由去重对冲）。

## D-unmapped-209@v1 落选方案 B——agent 按需查询工具（get_network_info MCP 工具）
状态：rejected
变更：2026-10-23-session-network-context
原编号：D-010@v1
锚点：未记录
最近确认：55e50da155266013c97475c0c6787bd964170980
理由：落选。不主动注入，新增 MCP 查询工具让 agent 按需调用。
否决理由：治不了本——agent 不主动调用就依旧不知道网络情况，而用户最需要的场景（问「怎么访问项目地址」）恰恰最容易漏；且需扩 MCP 工具面、daemon 不掌握用户浏览器源 IP 须回平台查询，链路更长。
复潮条件：若注入 token 成本实测不可接受且 agent 主动调用习惯可被 prompt 稳定养成，可重议按需查询形态。

## D-unmapped-210@v1 落选方案 C——仅前端展示网络徽标不注入
状态：rejected
变更：2026-10-23-session-network-context
原编号：D-011@v1
锚点：未记录
最近确认：55e50da155266013c97475c0c6787bd964170980
理由：落选。仅在聊天界面显示网络徽标，agent 无感知。
否决理由：浏览器侧探测局域网 IP 已被 Chrome mDNS 混淆机制基本封死（返回 *.local），拿不到可用数据；且不解决核心诉求——agent 依旧不知道网络环境，等于不做。
复潮条件：若浏览器重新开放可靠的本机 IP 探测能力且需求退化为「仅人看」，可重议。

## D-unmapped-211@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-23-session-dialog-input-align
原编号：D-001@v1
锚点：未记录
最近确认：2012a0426db5ce4e6f7307f847c4c1b18eb8deac
理由：- 最大风险：立即清空后「失败窗口期」用户误以为发送成功。缓解：失败路径既有 errorMsg/notify（不变）且文本自动回填；与 page 模式同一口径。 - 放弃方案 A「只在 dialog 内部给 idle 态加 nonce/重挂载」：宿主已用 key 表达会话切换（`attachSession?.id ?? "live"`），再叠一层 nonce 会与宿主 key 语义重复；改由「idle 不回读草稿」直接消除残留来源，更小改动面。 - 放弃方案 B「dialog 与 page 合并为同一实现」：两模式 2334 行 vs 6163 行、渲染容器/队列 hook/SSE 生命周期不同（dialog 零 react-query、page 挂 react-query），合并属重构级改动，本次不扩面（记为长期项）。 - 放弃方案 C「失败恢复用 setInput(prompt) 无条件覆盖」：会吞掉用户在失败窗口期新输入的内容；与本仓 `handleInterrupt` 回退、page 版「仅空时回填」口径冲突。 - 明确边界（可接受）：`handleResend`（时间线失败卡「重新发送」）不走输入框语义，失败不把该轮 prompt 回填输入框——用户未在输入框输入该文本，回填属越权写；保持现状。 - 明确边界（可接受）：`cancelSched`/定时发送相关路径清空语义不变（`confirmSchedCreate` 保留原 trim 比对清空），定时创建成功不属「发送受理」，不回填。

## D-unmapped-212@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-23-session-first-window-turn-align
原编号：D-001@v1
锚点：未记录
最近确认：780bda6099858d50f9908ea6d9e308c2eb46b8ab
理由：最大风险是首屏多一次 runs 快照与至多 9 次单轮直达拉取（1 次截断轮 + 最多 8 个更早轮候选**并行**，一个 RTT 批量；slim 截断传输）；预算 3000 行、单轮 2000 行、单次 8 轮三上限把最坏请求量与传输量同时锁死，短轮会话不会串行发数百次请求。切会话/卸载经 AbortSignal 立即取消在途补拉链。直达不完整/失败时整体回退底窗（不合并、不向前补拉），新增更早轮只在完整时采纳——两条路径都保证轮间无洞。放弃方案：① 直接调大 `HISTORY_PAGE_SIZE`——仍会在大轮上复现且无轮对齐；② 后端改日志接口做服务端自适应分页——最优雅但改动面跨前后端、影响所有消费方，留待后续；③ 首屏全量加载所有轮次——长会话传输不可控（500 轮 × 数千行）。

## D-unmapped-213@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-23-skill-prune-git-safe
原编号：D-001@v1
锚点：未记录
最近确认：dd0532e5d5ffdcb72e047c5a157a4bf4d4fa786a
理由：答：最大风险是「裁剪失效感」——git 仓库里的技能目录不再被删，会话 agent 能看到（读到）全部仓库自带技能，超出会话勾选的技能面。定性：技能只是说明书文档，读取面放宽不改变工具权限面；且平台技能下线本就走「仓库提交」通道（2026-10-23 实证 b6f3114d9），daemon prune 对 git 仓的删除本就属于越权行为。缓解：`prune_skill_kept` 日志保留可观测。次风险：`git ls-files` 在超大仓的耗时——限定 pathspec `.claude/skills` 后输出量级为技能文件数（几十到几百行），15s 超时兜底，启动路径一次性可接受。 试过放弃的方案：①link 时打 marker 文件/命名约定——存量已 link 目录无 marker，需迁移清理，且 marker 本身又落在工作区（新污染），放弃；②workDir 是 git 仓则整体跳过 prune——判定太粗，daemon link 副本在 git 仓里（.gitignore 了 .claude/skills 的部署形态）也无法清理，放弃；③删除改移动到 daemon 回收站——仍改工作区，只解决可恢复不解决「不该动」，放弃；④把 `.claude/skills` 整体加 gitignore——动仓库契约、影响技能作为正式文件分发的既有形态，放弃。

## D-unmapped-214@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-23-marquee-blank-track-fix
原编号：D-001@v1
锚点：未记录
最近确认：d32d1a2b1f4f1d6bff5ad855aee08edf0e154678
理由：- 风险：offset 补偿瞬间若测量宽度为 0（字体未加载/隐藏容器），step 回退 208，可能有一次轻微跳动；已在 clamp 与 rAF 缓出下弱化。 - 放弃方案：① 每次滑动直接重置 offset=base（画面会瞬移一条，不流畅）；② 无限保留历史条目（DOM 无界增长）；③ 用 CSS 循环轨道（无法满足“只到最新不循环”）。

## D-unmapped-215@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-23-rename-ghost-pit-doc
原编号：D-001@v1
锚点：未记录
最近确认：e24e1eb9da5f05b4950b595c8f33640034e3bf4d
理由：最大风险：文档与 sillyspec 仓修复细节漂移（修复侧后续演进时本文可能滞后）。缓解：文档只记事故事实与修复锚点（变更名/提交哈希/一句话机制），不复刻实现细节，演进史归修复仓变更档案。死路：把修复代码也搬进本仓——跨仓重复实现无意义，放弃。

## D-unmapped-216@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-23-marquee-queue-window
原编号：D-001@v1
锚点：未记录
最近确认：bde8745c66dec2a3745f7cfdfaeff7d3708ea923
理由：- 风险：窗口只有 12 条，用户无法在跑马灯回看更早事件。缓解：跑马灯定位是「感知」，完整过程在「进度」视图；12 条约 3 屏，滚动节奏足够。 - 窗口频繁滑动（每次新事件）：每次只前进一条且补偿平滑，视觉与性能均可接受；轨道总宽恒定，不累积。 - 放弃方案：① 保留 200 条（用户指出成本不必要）；② 只保留 10 条（12 条保留约 3 屏上下文，性能差异可忽略）；③ 用虚拟列表（12 条不需要）。

## D-unmapped-217@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-23-session-first-load-ux
原编号：D-001@v1
锚点：未记录
最近确认：58cebf9df158804564dd87110c7673ef898a3703
理由：最大风险：第二段 prepend 合并的轮块拼装正确性（锚点轮直达段与底窗同 run 跨块、#e 变体 key、游标推进条件）——缓解：合并逻辑提炼为纯函数（输入：已渲染 turns、底窗行集、adaptive 结果；输出：prepend 轮块数组 + 新游标），单测覆盖跨 run/同 run/空补拉/整体回退四种形态；沿用「加载更早」已验证的拼接语义而非新造。 已放弃方案： - 「底窗后立即建 SSE 流」：直达整轮可能带回底窗边界之外的行，cursor 语义需重推导（现版注释明确「游标不前进会重复拉取」），风险大于收益——建流时序保持不变。 - 「取消/砍掉 buildInitialWindow 恢复纯底窗」：回退 first-window-turn-align 的轮对齐目标（轮首被截的困惑回归），治标不治本。 - 「补拉自动连翻触顶翻页（maybeAutoFill 循环）替代直达链」：串行多页 RTT 比并行 8 轮慢，且首屏先闪半轮再补全跳变更丑。

## D-unmapped-218@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-23-marquee-thinking-fulltext
原编号：D-001@v1
锚点：未记录
最近确认：092618dd5c0095a13d5e2646e92c1a5a826d42f7
理由：- 风险：极长思考滚动时间较长；但跑马灯定位是感知，正文区有完整思考可读，窗口仅 12 条、DOM 文本量可控。 - 流式增长时文本宽度测量依赖 ResizeObserver / 文本变化 effect；浏览器布局稳定时跟随连续，极端情况下可能有一次轻微追赶。 - 速度按文字宽度与距离自适应（220~900px/s）：流式爆发时能跟上，稀疏时慢速流动。 - 放弃方案：① 保留 64 字截断（用户明确要全文）；② CSS 无限循环动画（用户明确禁止循环）；③ 到达末尾直接停住不跟随（思考仍在流式增长时会被落在旧位置，用户明确要求跟随）。

## D-unmapped-219@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-23-diff-dialog-pairing-fix
原编号：D-001@v1
锚点：未记录
最近确认：ea5e7eb64b9bf39787f9d8b2ba1870c240086cee
理由：答：最大风险是「无 id 且同轨多悬置时补丁显示率下降」——诚实丢弃，用户看到无补丁说明。定性：错内容比没内容危害大；且①恢复 metadata 键后真实链路绝大多数补丁走精确配对，②只在极旧/异常数据上兜底。次风险：`metadata.agent_event` 在新轨未落库的历史行上缺失 → 回落顶层 slim 键；两者都缺 → ②同轨唯一悬置。均已如实降级、不伪造。 试过放弃的方案：①只改②回退「就近最近悬置」（首版实现，评审否决）——未发现①从未生效的真根因，且串行假设不成立于后台子代理并行形态，会把 A 的补丁挂到 B 名下；②悬置>1 一律丢弃但不修①——真实链路仍全落②，串行轮也可能因悬空而大面积丢段，放弃；③按「补丁内容文件路径启发式」猜归属（structuredPatch 不带路径，伪归因，放弃）；④弹窗列出「本轮全部无主补丁」转嫁用户（弹窗语义劣化，放弃）。

## D-unmapped-220@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-23-watchdog-steering-guard
原编号：D-001@v1
锚点：未记录
最近确认：8e6a6b644c3481a47ec381533ce4422fcc9b64d7
理由：答： - 最大风险：`observedRunIds` 无界增长。用 256 上限 FIFO 驱逐；单个 UUID 约 36 字节，单会话上限约 9KB。 - 风险：同 runId inject 跳过 stale-reset 后，若 backend 重启导致旧 turn 已死但 currentRunId 残留，会不会永远不收敛？不会：该形态下不会布防看门狗，但 backend 的 pending run 300 秒清扫仍兜底；且真正的「新 run 被吞」runId 与残留 currentRunId 不同，仍会正常布防。 - 放弃方案：只提高 60 秒/90 秒阈值。治标不治本，长 turn + 慢模型仍会命中，且会延迟真僵尸轮的收敛。 - 放弃方案：在看门狗触发时再检查 `lastTurnEventAt`。此时错误布防已经发生，根因在布防前；前置守卫比事后补救更可靠。

## D-unmapped-221@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-23-knowledge-scope-maintenance
原编号：D-001@v1
锚点：未记录
最近确认：80f9dd90355be5253439d049cadcd771baf88c09
理由：风险=节定位歧义（同名 heading 重复）导致改错节——对策：多义直接 422 并要求唯一 heading；marker 只在该节范围内增删，绝不触碰其他节。放弃：整文件 content 替换式维护（丢其他节编辑并发、无结构校验）；文件级 scope（无法表达节级语义）。

## D-unmapped-222@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-24-close-run-quota-fallback
原编号：D-001@v1
锚点：未记录
最近确认：92bbf833e5595acbe7617b6bd61ad6f25c9fc748
理由：答：最大风险是**误报**——把非限额失败标成 quota_exceeded。缓解：双重锚定（必须同时含 429 状态码与限额关键词，正则逐条对齐 classifier.ts 规则 1），且 429 语义即 Too Many Requests、配限额关键词才定 quota（纯 429 落 rate_limited 的情形本方案不推断、保持现状）；实测 9-04/10-23 两批真实限额文本均稳定命中。次风险：推断规则的维护漂移（daemon 侧改文案后端不知道）——注释钉死对齐源路径，daemon classifier 改动时须同步（评审检查点）。 试过但放弃的方案：① 前端兜底（失败卡渲染时翻时间线日志找 API Error 行）——前端拿不到结构化 run 日志查询入口，且 error_detail 为空时 buildSystemFailureItem 只吃 error_code/failure_summary 两参，跨组件翻日志链路重、auto_resume（后端读 error_detail）完全受益不到，放弃。② 后端复制 daemon 全类型分类规则——双源维护面大，auth/timeout 等类型文本特征弱误报高，收窄为 quota 专项（理由见做法概述）。③ 只升级 daemon 不改后端——那台机器不归本平台代码库管，升级排期不可控，且未来任何机器的 daemon 版本倒挂都会复发，后端兜底是对部署倒置的结构性防御。

## D-unmapped-223@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-24-pi-edit-patch-synth
原编号：D-001@v1
锚点：未记录
最近确认：4d07114b353e26c3c2462eebf3133b4cff03ac55
理由：答：最大风险是 **oldStart 行号的近似性**——块替换前面的内容有他源改动时，累积偏移算出的旧行号有偏差（diff 内容仍真实，行号标注可能偏几行）。缓解：jsdoc 披露；newStart（新文件行号，弹窗主体信息）由实盘定位恒精确。次风险：入参登记打破 pi-events 零状态设计——登记面收敛为 call_id→args 单 Map、轮内生命周期、容量上限，复杂度受控。 试过放弃的方案：①daemon 在 tool_use 时刻读旧文件、end 时刻读新文件算真 diff——旁路观察与工具执行竞态（start 到 end 间他源改动会被误算入该工具），且 pi 工具在 driver 外执行、时序不可靠，放弃；②解析 pi 结果文本中的路径与块数——结果无内容无行号，解析只得元数据无 diff 体，放弃；③前端从 tool_call 入参自行渲染（A+ 方案）——不改 daemon 但弹窗要做第二套渲染（write 全文视图/edit 块视图），且每会话拉全量 tool_call 入参放大 payload，放弃（用户已裁决走根治）；④放宽前端 parseStructuredPatch 行号可空——动 claude 轨道共用解析器，回归面大，放弃。

## D-unmapped-224@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-22-trajectory-context-jump
原编号：D-001@v1
锚点：未记录
最近确认：bbe1bbf6ba02b08fa3ef2bf7a5558d94f4d026ff
理由：风险：`scrollIntoView` effect 在流式更新（新行追加）时可能把用户正在阅读的位置拉走——限定为「selectedRowId 变化时」触发（非滚动容器内容变化），与旧实现同口径。放弃的方案：让 TurnCatalog 直接操作轨迹 DOM（跨组件 querySelector）——耦合 DOM 结构且绕过选中状态机；放弃 imperative ref 暴露滚动方法——受控信号 + 选中 effect 已够用，少一条命令式通道。

## D-unmapped-225@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-24-backend-mem-limit-raise
原编号：D-001@v1
锚点：未记录
最近确认：0a3e4ee1ab582ce08c68a988d7da3697f3436448
理由：最大风险：若后续再引入第三类常驻模型 worker 或批量推理峰值再涨，2500m 仍可能触顶——但 cgroup OOM 兜底行为不变（杀 worker 保主进程），且宿主 7.5G 对 2500m 上限仍有 3G+ 安全边际，风险可控。放弃的方案：①worker 拆独立 sidecar 容器（治本但改部署管线与进程拓扑，改动面大，超出本次决策范围）；②调小嵌入/翻译批上限（治标：压峰不治底，主进程+单 worker 稳态仍贴 1100m 顶，且推理延迟恶化）；③不设 mem_limit（失去 OOM 隔离，宿主与其它容器暴露在被挤爆风险下）。

## D-unmapped-226@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-24-trajectory-context-rows
原编号：D-001@v1
锚点：未记录
最近确认：b1d1ed8ee47ffcd26dba1175753a470e3caf08e9
理由：风险：turn_trigger 含「用户亲笔来源标注」类（shadow_chat/group_chat/schedule，contentHidden=false）——它们也显示为「上下文」行。接受：dsh 同款形态（触发源即 context 行），且行摘要有原文，用户可辨识；如需区分可后续按 trigger 字段细分。放弃的方案：继续用 processItems.system_event 作数据源——DB 实证该路径近乎恒空，修不动；为注入信息新增后端 channel——跨端大改，本平台注入已有 turn_trigger 承载，无需新通道。

## D-unmapped-227@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-23-marquee-awaiting-indicator
原编号：D-001@v1
锚点：未记录
最近确认：0fa5913d2e4444e1dc0f9a6f01469da91a958814
理由：- 风险：1s interval 在等待期间每秒触发一次组件重渲染；列表仅 12+1 条，成本可忽略，且只在等待态运行。 - 等待条目出现/消失使轨道宽度变化一条，target 单调规则下推进连续，短暂右端空档可接受（与真实事件到达通常几乎同时）。 - 放弃方案：① 从后端/daemon 发心跳事件（跨服务改动，收益不成比例）；② 用状态条文案兜底（已有「当前活动」但不持续、也无法区分等待与执行）；③ 等待条目参与 entries 队列（会污染窗口滑动与去重语义）。

## D-unmapped-228@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-25-marquee-subagent-outer-only
原编号：D-001@v1
锚点：未记录
最近确认：c596944e9698db5bfd828734cc1958b27b36ba61
理由：- 风险：startedAt 为历史挂钟时间时，挂载即显示已运行很久的时长——这是真实时长（attach 场景），符合预期；缺省客户端起点在重挂载后偏短（既有披露边界）。 - 1s tick 每秒重渲染列表（13 条）——与等待条目共用同一 tick，成本可忽略。 - 放弃方案：① 外部保留内部消息但折叠（用户明确外部只要容器信息）；② 为 running 条目单独每条一个 interval（多条 running 时多 interval，统一 tick 更省）；③ 子代理卡片内再加跑马灯（重复信息，卡片已有完整过程行）。

## D-unmapped-229@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-25-subagent-card-unify-panel
原编号：D-001@v1
锚点：未记录
最近确认：2e0ff863327ec51edee4eb034e54adfaaeb1db5e
理由：- 风险：无 Provider 宿主（回放体、悬浮助手）失去子代理详情入口——头部信息仍完整，完整过程可去「进度」视图看；属用户裁决的统一取舍（已声明边界）。 - Drawer 覆盖在弹窗内容上而非并排：弹窗宽度有限（约 60vw~90vw），固定右栏会把消息流压到不可用；浮层是移动端已验证的同构方案。 - 放弃方案：① dialog 内固定右栏（布局压缩严重）；② 保留内联展开作为无 Provider 回退（用户明确要求去掉）；③ 把 page 右栏整套抽出共享 hook（改动面大，dialog 仅需 Drawer 出口，复制 20 行状态更小）。

## D-unmapped-230@v1 按 dsh 引擎机制做全套（消息来源标记 + 请求头快照），跨三端
状态：implemented
变更：2026-10-25-trajectory-source-model
原编号：D-001@v1
锚点：未记录
最近确认：024af1a9d8d16d48a68fa1dfe07103c16afd049c
理由：用户否决前端启发式（2026-10-25-trajectory-system-rows 已 reject），要求按 dsh 机制做全套：消息来源标记（source）+ 请求级系统提示词/工具快照上报，含 daemon 侧改造，跨 backend + sillyhub-daemon + frontend 三端完整流程。
故障面：盖戳遗漏新增注入点时该类消息回退「用户」行（可发现的标签回退，非数据损坏）。
退役判据：若平台日志层未来引入原生来源列，metadata 键机制可整体退役。

## D-unmapped-231@v1 系统提示词行做「配置面快照」口径（引擎全文不可得）
状态：implemented
变更：2026-10-25-trajectory-source-model
原编号：D-002@v1
锚点：未记录
最近确认：024af1a9d8d16d48a68fa1dfe07103c16afd049c
理由：用户裁决：做配置面快照——daemon 轮边界上报「档案配置的 systemPrompt 追加段 + 工具清单」快照，变更时显示「系统提示词已更新/工具已更新」行；对比对象是配置面非引擎全文，该边界写入设计文档。

## D-unmapped-232@v1 存量历史会话如实呈现（无标记 → 用户行），不做启发式兜底
状态：implemented
变更：2026-10-25-trajectory-source-model
原编号：D-003@v1
锚点：未记录
最近确认：024af1a9d8d16d48a68fa1dfe07103c16afd049c
理由：用户裁决：如实呈现——新机制只对新产生的会话生效，存量无标记的历史注入仍显示「用户」行，不伪造标记、不保留启发式兜底（与 dsh 数据驱动同构）。

## D-unmapped-233@v1 revert 已提交的启发式代码（77ba0588b / c93aafc84）
状态：implemented
变更：2026-10-25-trajectory-source-model
原编号：D-004@v1
锚点：未记录
最近确认：024af1a9d8d16d48a68fa1dfe07103c16afd049c
理由：用户裁决：在新变更中 revert 这两笔提交，方案彻底切换到 dsh 机制（代码已在 main，通过 revert commit 处理，不 reset 历史）。

## D-unmapped-234@v1 采用方案 A——复用日志通道（metadata 盖戳 + 新 channel 快照 + submit 透传修复）
状态：implemented
变更：2026-10-25-trajectory-source-model
原编号：D-005@v1
锚点：未记录
最近确认：024af1a9d8d16d48a68fa1dfe07103c16afd049c
理由：用户选 A：注入点盖 metadata（照 turn_trigger 先例）；daemon 轮边界把配置快照作为新 channel 日志上报；修复 submit_steps metadata 只落 _agent_event 的透传缺陷；前端新增段类型照 turn_trigger 先例装配。全链路复用现有管道，历史回放自动有快照。
故障面：channel 扩枚举后旧前端把快照行当未知日志（需前端兼容分类：未知 channel 归中性系统行不丢）。
退役判据：若日志层拆分内容/元数据双流，快照 channel 可迁离。

## D-unmapped-235@v1 否决「独立快照表 + REST 上报」（方案 B）
状态：rejected
变更：2026-10-25-trajectory-source-model
原编号：D-006@v1
锚点：未记录
最近确认：024af1a9d8d16d48a68fa1dfe07103c16afd049c
理由：用户未选 B。
否决理由：新表+新端点+前端新查询链路，实时/回放各接一套，改动面远大于复用现有日志管道且无对应收益。
复潮条件：日志表容量/查询性能因快照行出现实测问题时重议。

## D-unmapped-236@v1 否决「纯前端不落库」（方案 C）
状态：rejected
变更：2026-10-25-trajectory-source-model
原编号：D-007@v1
锚点：未记录
最近确认：024af1a9d8d16d48a68fa1dfe07103c16afd049c
理由：用户未选 C。
否决理由：刷新即丢、历史会话无快照，不满足 D-001 的历史回放要求。
复潮条件：无（需求本身要求持久化，除非需求变更）。

## D-unmapped-237@v1 设计定稿——三段式（注入盖戳 / daemon 快照 / 前端行）+ 真码原型
状态：implemented
变更：2026-10-25-trajectory-source-model
原编号：D-008@v1
锚点：未记录
最近确认：024af1a9d8d16d48a68fa1dfe07103c16afd049c
理由：用户确认定稿；原型（轨迹原型扩展三类新行）已登记 prototype-trajectory-source-model.html。

## D-unmapped-238@v1 新注入类归 turn_trigger 体系（非独立 sender 键）
状态：implemented
变更：2026-10-25-trajectory-source-model
原编号：D-009@v1
锚点：未记录
最近确认：024af1a9d8d16d48a68fa1dfe07103c16afd049c
理由：我的判断：扩 turn_trigger（team_brief / worker_dispatch / agent_notice 三新 kind）——前端配置表/装配链/轨迹映射全套已就位，零新管道；dsh 的 source.kind 独立轴在本平台等价物即该闭表。

## D-unmapped-239@v1 变更检测在 daemon 侧，只报 initial/change（非每轮落快照）
状态：implemented
变更：2026-10-25-trajectory-source-model
原编号：D-010@v1
锚点：未记录
最近确认：024af1a9d8d16d48a68fa1dfe07103c16afd049c
理由：我的判断：daemon 缓存上次快照做字段级比较，仅 initial 与 change 上报——dsh 同构（agent.ts:635-650 同款条件），省日志量。

## D-unmapped-240@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-25-session-tab-visual-unify
原编号：D-001@v1
锚点：未记录
最近确认：17f1dfc084703c7d72c86a4c5d44eb1099c5794f
理由：风险：DialogQaBlock 去 ml-9 后对话视图 ❓ 块左缘与其它 agent 段对齐（视觉位置变化，属统一的预期部分）；进度视图提问卡不再展示全部 options 选中态（信息量下降，用户裁决优先统一形态）；类名锁定的测试断言需逐个同步，漏改会假红。 放弃方案一：进度视图保留 AskUserToolCard（保留全部 options / 选中态展示）——用户明确裁决「优先使用对话的」，且问答块已含问题+回答主信息，弃。 放弃方案二：宽度用固定像素上限（如 max-w-[880px]）——「整行宽度 − 120px」语义要求随容器宽度自适应（弹窗版/整页版/移动端容器宽度不同），固定值会在窄容器下越界，弃。

## D-unmapped-241@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-25-askuser-keyword-overkill-fix
原编号：D-001@v1
锚点：未记录
最近确认：e283fed09505c71f36ac96dc6ec1d237a80b08c0
理由：- 最大风险：放开 `[ASSISTANT]` 正文后，若存在「正文含该词且确实该丢」的历史行形态被误放行。排查生产库全量形态分布后排除：含词行仅四类（user_input 提示词——不经 classifySessionLog；[TOOL_USE] 文本行/tool_call JSON——维持丢弃；[ASSISTANT] 正文——正是要恢复的；compaction 摘要行——其丢弃由 compact 前缀分支另行处理，且本就不进对话正文）。 - 试过但放弃的方案 ①：直接删除 318 行（丢 [TOOL_USE]/tool_call 的兜底全部交给既有规则）。放弃理由：tool_call AskUserQuestion JSON 行当前也被 318 行丢弃，删除会让它落到 tool_use 段映射，过程视图新增 AskUser 工具行——与 DialogQaBlock 提问卡双画（前一轮变更刚统一的单画形态回归），行为漂移面大。 - 试过但放弃的方案 ②：按 `"tool"\s*:\s*"AskUserQuestion"` 正则精确匹配 JSON 行。放弃理由：daemon JSON 序列化空格形态不稳定（生产库实测两种形态并存），匹配脆弱；「正文前缀行豁免」一刀切更简单且对未知形态保守（非前缀行维持旧行为）。

## D-unmapped-242@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-25-marquee-inactive-awaiting-fix
原编号：D-001@v1
锚点：未记录
最近确认：3a1f4551fb083eb1cd2ef1ec56438fdcadf60c13
理由：- 风险：子代理运行中但内部全部工具完成时（等 LLM），等待条目照常显示——这正是期望行为（子代理还在跑）。 - 放弃方案：① 终态卡片不渲染内嵌流动条（用户要求框内持续展示内部过程，只是不要假等待）；② 等待条目由宿主自行渲染（重复逻辑）。

## D-unmapped-243@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-23-pre-session-draft-persist
原编号：D-001@v1
锚点：未记录
最近确认：b83d2f2da7b9f30541f9b80b1bb7311d27462be0
理由：- **本变更显式反转前序裁决**（须记 decisions 新版本取代）：`2026-10-23-session-input-clear-fix` FR-04「预会话恒空白、新建即弃稿」与 `2026-10-23-session-dialog-input-align` FR-04「idle 恒空白」。复潮条件已满足——用户实测后显式要求保留（本次 --input 原话）。两处被反转用例（「同一入口重进：输入框恒空白」「同 workspaceId 重开 dialog：恒空白」）就地改写为恢复语义，防口径漂移。 - 最大风险：清空后「组件卸载早于写 effect」丢清空事件 → 回来回显旧 AAA。评估：写 effect 在 input 变化的 commit 后同步 flush，用户「清空→切走」是人手两个操作，时间上必然晚于 effect 执行；唯一理论窗口是程序化清空（无）与清空后同 tick 卸载（无此路径）。风险可接受，FR-02 用例锁定。 - 放弃方案 A「预会话卸载钩子里补写草稿」：为不存在的窗口加防御，卸载钩子读 state 闭包易踩过期值（前序变更已知陷阱），不引入。 - 放弃方案 B「把预会话草稿并到每入口一个 sessionStorage」：用户明确要求刷新（新标签/重开浏览器）也保留，sessionStorage 不满足。 - 放弃方案 C「回读时同时回显 @ 联想/附件」：草稿键只存文本（R-7 语义），附件与 @ 绑定需重选是既有裁决，不扩scope。 - 明确边界（可接受）：同一入口的预会话草稿不区分「哪个用户意图」——只要没发送，重进就恢复；用户想丢弃就清空（FR-02 即为此设计）。 - 明确边界（可接受）：预会话草稿无 TTL（会话草稿同款），残留量级 = 入口数 × 一条文本。

## D-unmapped-244@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-25-marquee-awaiting-real-data
原编号：D-001@v1
锚点：未记录
最近确认：6cfbdbe137fdb12b2a8829192a79c454cd394a5f
理由：- 风险：本机与服务器时钟偏差使等待时长有几秒误差——感知级展示可接受；如需精确可后续由 daemon 推等待起点事件（跨服务改动，本次不做）。 - 等待期间 token 不再增长（tokens 事件随日志批次到达，等待期无新批次）——显示的是"本轮已消耗"快照，语义如实。 - 放弃方案：① daemon 新增"API 请求开始"心跳事件（跨服务改动大，收益秒级）；② 等待条目显示 ctx 环（已有轮头状态条展示，避免重复）；③ 前端轮询 usage 接口（无谓请求）。

## D-unmapped-245@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-25-session-git-worktree-root
原编号：D-001@v1
锚点：未记录
最近确认：02a41abacd68fef103b96a0e005733cccc0566bc
理由：最大风险：探测层多一次 RPC（stat 5s）加在每轮 60s 轮询上——离线场景先 stat 失败（静默 miss，≈即时）再 git_status 502，延迟增加可忽略；正常场景 stat 是本地文件 lstat，毫秒级。次风险：current_change_id 有值但 agent 实际已 apply 回主仓继续干、worktree 未清理——探测命中显示工作树分支（非 agent 实际工作目录），语义偏差存在但方向正确（该 change 的隔离环境分支正是用户关心的），接受为显式边界（收口评审裁决）。 试过放弃的方案：① 从会话日志 stdout 文本解析 agent 输出的 worktree 路径——自然语言解析脆弱、覆盖率不可控，放弃；② daemon 侧实时跟踪 agent 进程 cwd——agent 的 cd 是 harness Bash 内 shell 状态，外部进程不可见，机制上不可行，放弃；③ sillyspec worktree create/apply 时回调平台 API 登记——跨系统契约变更（CLI/npm 包 + daemon + backend 三端），且存量已创建的 worktree 无登记回填，重；留作后续正路（平台 worktree 注册表），本变更先零侵入探测。

## D-unmapped-246@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-25-fe-build-unblock
原编号：D-001@v1
锚点：未记录
最近确认：a632a37e3975ae0bf31c92290078a9fbede8ce2a
理由：风险可忽略：`?.` 与 `?? null` 在 i>0 且元素必存在的构造下与原 `.whoLine` 等值。试过放弃的方案：把测试 opts 类型改为 LlmProviderRead[]（需 import + 464/504 fixture 补齐必填字段，改动面扩大且可能引出 agent_kinds 类新错）——放弃，取 never[] 边界断言最小面。

## D-unmapped-247@v2 忽略条目按顶层聚合展示，不递归展开（措辞精度修订）
状态：implemented
变更：2026-10-25-explorer-git-status
原编号：D-003@v2
锚点：未记录
最近确认：19783ad99
理由：结论不变（顶层聚合）；normalized_requirement 措辞收敛为「与忽略目录内部文件数无关（--directory 只聚合目录），散落的忽略单文件仍逐条、规模与其线性相关」
supersedes：D-003@v1
故障面：同 D-003@v1
退役判据：同 D-003@v1

## D-unmapped-248@v1 diff 基线一律 HEAD，不区分暂存区；untracked/已删除特例展示
状态：implemented
变更：2026-10-25-explorer-git-status
原编号：D-004@v1
锚点：未记录
最近确认：19783ad99
理由：我的判断：一律与 HEAD（最近一次提交）比，不拆「更改/已暂存更改」两组（平台 agent 场景不走暂存流程，YAGNI）；untracked 文件 diff 展示整文件为新增（全绿）；已删除文件保留在修改集合清单（红色删除线），diff 展示整文件删除（全红）
故障面：用户本地手动 stage 后清单不体现暂存态，可能误判「还有未暂存改动」
退役判据：平台引入暂存区工作流（如平台内提交功能）时重议口径

## D-unmapped-249@v1 explorer 树着色不改点击行为，diff 入口仅修改集合视图
状态：implemented
变更：2026-10-25-explorer-git-status
原编号：D-005@v1
锚点：未记录
最近确认：19783ad99
理由：我的判断（按用户原话字面）：explorer 树点击行为维持现状（右侧内容预览）；「点击看 diff」仅是修改文件集合视图的交互。explorer 树只加状态着色
故障面：用户若预期「树上点文件直接看 diff」会与实现不符——design 图例中写明
退役判据：用户反馈想从 explorer 树直达 diff 时，加辅助入口（如右键菜单/图标按钮）

## D-unmapped-250@v1 状态采集沿用 git_log 既有三层链路，daemon 新增两个平名能力
状态：implemented
变更：2026-10-25-explorer-git-status
原编号：D-006@v1
锚点：未记录
最近确认：19783ad99
理由：我的判断：沿用 git_log 模块既有「backend(GitLogService 绑定解析) → ws_hub.send_rpc → daemon execFile git」链路与安全守卫；daemon 侧新增两个平名 RPC 能力——①文件级状态清单（porcelain v2 文件行 + ignored --directory 聚合行 + numstat 增删行数）②工作区单文件 vs HEAD diff（git diff HEAD --unified=3 --no-color -- <path>，untracked 用 no-index 形态或标记位由前端渲染全文新增）。backend 暴露两个新只读端点（WORKSPACE_READ 门控）
故障面：daemon 旧版本无新平名能力 → backend 需按未知方法映射为 422「daemon 版本过旧」降级（对齐现有 git-log 降级形态）
退役判据：若后续 daemon 与 backend 合并部署形态变化，再评估链路简化

## D-unmapped-251@v1 落选——方案 B（explorer 契约内嵌状态字段）— rejected
状态：rejected
变更：2026-10-25-explorer-git-status
原编号：D-008@v1
锚点：未记录
最近确认：19783ad99
理由：落选
否决理由：懒加载树逐层列目录导致重复采集（每层一次 git status）；逐目录语义拼不出全量修改清单，Git 日志页修改集合另开接口形成两处数据源，一致性无保障；ExplorerEntry DTO 变更牵动 gen:types 双份义务
复潮条件：explorer 树改为一次性全量返回（无逐层懒加载）且修改集合需求取消时，可重议内嵌口径

## D-unmapped-252@v1 落选——方案 C（daemon watch + 实时推送）— rejected
状态：rejected
变更：2026-10-25-explorer-git-status
原编号：D-009@v1
锚点：未记录
最近确认：19783ad99
理由：落选
否决理由：大仓库 fs 监听开销大且 Windows 文件监听坑多；需新增推送通道与连接状态机；当前场景刷新按钮 + react-query 失效机制已覆盖，YAGNI 严重超范围
复潮条件：出现多端同改工作区需秒级感知的真实场景（如多人协作审阅同一工作区）时重议

## D-unmapped-253@v1 untracked diff 采集用局部 execFile 读退出码（exit 0/1 均成功）
状态：implemented
变更：2026-10-25-explorer-git-status
原编号：D-010@v1
锚点：sillyhub-daemon/src/host-fs-handler.ts:1661
最近确认：19783ad99
理由：我的判断：untracked 分支不走 runCmd 的 ok 通道，用局部 execFile（对齐 runGitFetch 先例 sillyhub-daemon/src/host-fs-handler.ts:1661）直接读退出码——exit 0/1 均视为成功（1=有差异，常态），≥2 或 killed 才 error；stderr 的 CRLF warning 行不进 error 文案。备选「改 ExecResult 暴露退出码」影响公共件全调用面，不取
故障面：git 未安装/版本极旧时 no-index 旗标行为差异——退化为 error 通道，前端按 diff 拉取失败降级，不致错数据
退役判据：ExecResult 未来暴露退出码后，可回归统一 runCmd 通道

## D-unmapped-254@v1 porcelain v2 解析契约——末段 rejoin、u 条目按 modified、祖先蓝点不含 ignored
状态：implemented
变更：2026-10-25-explorer-git-status
原编号：D-011@v1
锚点：未记录
最近确认：19783ad99
理由：我的判断：① `1` 条目前段字段以单空格分隔、path 以制表符与前段分隔（git 官方契约）——按行内首个 `\t` 切出 path（含空格安全；path 含 `\t`/换行时 git 自动 C-quote 包裹）；② `u`（unmerged，合并冲突）条目按 modified 归类（四态不扩冲突态，YAGNI，测试用例覆盖）；③ explorer 祖先目录蓝点口径=子树内存在 added/modified/deleted/untracked 任一，ignored 不算改动
故障面：冲突文件显示为「修改」蓝而非专门冲突标识——平台场景罕见，图例不提示；用户在别处解决冲突后状态自然消失
退役判据：平台出现高频合并冲突场景时增补第五态「冲突」

## D-unmapped-255@v1 并行变更遗留红测试的就地对齐（turn-timeline 断言恢复）
状态：implemented
变更：2026-10-25-explorer-git-status
原编号：D-014@v1
锚点：未记录
最近确认：19783ad99
理由：我的判断：该红由并行变更 subagent-card-unify-panel 已提交主仓但漏更新对应测试所致，非本变更文件；为恢复提交门可用，在收口提交 0f3bf815a 中顺带对齐断言（20/20 绿），commit message 留痕
故障面：顺手修复与变更主体混于同一提交，追溯需读 commit message
退役判据：无（一次性修复留痕）

## D-unmapped-256@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-26-worktree-group-collapse
原编号：D-001@v1
锚点：未记录
最近确认：01714da0c91b515bd6e12b0c4a02ae2cc9ae2401
理由：最大风险：默认收起后用户找不到 untracked/ignored 内容——已用收起态头行计数（N 个文件/N 项）+ 旋转箭头提示可展开缓解。试过放弃：把三组并成 Tab 切换（放弃——破坏三组同屏对照，IDEA 参照形态就是纵向分组树）。

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

## D-unmapped-263@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-26-push-skill-docs
原编号：D-001@v1
锚点：未记录
最近确认：a02cfdce546116b079b6df27d6db3c137402cb12
理由：最大风险：文档描述与 CLI 实际行为漂移（CLI 升级改 flag 后文档滞后）——缓解：FR-01 要求命令与 `--help` 逐字一致，且 push 技能内含「禁止直接 git push」等绝对规则防误用。无放弃过的方案（纯新增文档，无方案分叉）。

## D-unmapped-264@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-26-config-staged-all-states
原编号：D-001@v1
锚点：未记录
最近确认：23e594809cead8633de53663204401d5a0458413
理由：答：最大风险是「运行中点选即暂存」与后端忙轮排队语义的行为差异认知——旧语义「运行中受理即排队、本轮结束生效」改为「点选无任何后端动作、下一条消息才生效」，若用户在运行中点选后期望「本轮结束就换供应商（不发消息）」则不满足（需发送一条消息才生效）。此为用户明确指令（全部不触发轮次），接受该语义；运行中点选的 toast/提示已随 D-001 静默，控件值变化即反馈。 放弃的方案：①运行中点选仍即时 POST 但要求后端不建轮——需后端新增「无轮切换」通道，改动面大且与「发送时生效」的统一模型冲突；②模型下拉单独传暂存供应商 prop——比组件内派生 displayProviderId 多一条 props 通道，无收益。

## D-unmapped-265@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-26-turn-phase-prod-fix
原编号：D-001@v1
锚点：未记录
最近确认：f8d6db60af6d40416709c57f4719802dbc28ace5
理由：最大风险：观测部署后证据指向的根因超出 daemon 仓（如 backend SSE 某条件下丢弃）——静态证据已基本排除该向（delivered 可显示证明同信封类型可通），若仍发生则范围扩至 backend 转发链，任务面相应扩。放弃的方案：①盲改可疑点（静态五项排除后命中率低且不可证伪）；②前端超时兜底假阶段（掩盖问题，违反 FR-02 禁绕过）；③上报改同步阻塞换可见性（违反不阻塞主链路语义）。

## D-unmapped-266@v1 回退安全性前提=单会话单活跃 run 不变式(反例排查)
状态：implemented
变更：2026-10-26-turn-phase-orphan-fallback
原编号：D-001@v1
锚点：未记录
最近确认：65081d429e74019db614c9b39035464c74bd4be2
理由：前提=平台「单会话单活跃 run」硬不变式。反例逐一排查：①跨轮子代理——parent_tool_use_id 归属派生轮，是轮内事件不建轮，不产生 turn_phase；②团队分身——parent_session_id 独立会话树，事件按 agent_session:{id} 频道各自路由；③忙轮守卫——已有活跃轮时后端拒绝新 run（DaemonSessionTurnConflict）或转排队（排队消息非活跃轮，派发建轮才活跃）；④steering 中途注入——沿用活跃 run 不建新轮；⑤自动续跑——前轮终态后才建新轮。实现侧保险：回退只写 currentRunId 指向的轮（现有状态机维护，只指向 pending/running/interrupting），不做模糊匹配。

## D-unmapped-267@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-26-subagent-card-width-unify
原编号：D-001@v1
锚点：未记录
最近确认：79ceac488b490ddecf30feb415b76ef4788d59bf
理由：- 风险：既有测试若有锁定 `w-full self-stretch` 全宽形态的断言会假红（预计无——宽度断言只锁 TextSegmentView 的 calc 限宽）；视觉上子代理卡右缘留白变化属统一预期。 - 放弃方案一：连 TurnLiveMarquee bar 变体（`w-[min(100%,52rem)]` 胶囊条）一并统一——它是独立胶囊形态非信息块，用户未点名，避免面扩大，弃（如需另行变更）。 - 放弃方案二：限宽类抽公共常量（如 SEG_MAX_W）——Tailwind JIT 扫描需要完整类名字面量，抽常量会丢样式，必须保持字面量类名，弃。

## D-unmapped-268@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-26-subagent-task-meta-restore
原编号：D-001@v1
锚点：未记录
最近确认：5eca947cd15ca5a45a62ff94e1600fdc8e968ec3
理由：- 风险：①悬挂 Map 在 asAssembled 收窄视图构造点若漏 transfer 会断链（悬挂后恰逢收窄再回填的窗口）——实现时 transferAssemblerInternals 必须同步携带（改动点已列）；②tool_use 建段点有两处（顶层新建 + stub 合并）漏一处则该路径悬挂不回填——测试覆盖 stub 先于 TASK 行形态。③进程退出导致的真僵尸任务（daemon 无终态信号，快照表无记录）本变更**不治**——卡片将统一显示"后台运行中"走秒（一致但仍在走），终态补写属 daemon 侧独立缺陷，建议另立变更（生产 06:22:43 进程退出实证）。 - 放弃方案一：治 DB 排序（backend 落库加二级排序键 seq）——动后端且存量行已乱序，历史数据救不回，前端防御普适，弃。 - 放弃方案二：tool_result 配对处加 taskAsync 豁免（不翻终态）——元数据回填后 metaStatus 优先级已压住显示，配对层再加豁免会让"真完成（同步 Agent）"与"回执（async）"歧义化（回执文本判定脆弱），收益低风险高，弃（endedAt 污染由 FR-02 显示优先级兜住）。 - 放弃方案三：一并修 [TOOL_USE] stdout 行与 tool_call 行双段并存（tool:uuid 孤儿段）——独立缺陷（显示为普通工具行，非本诉求主因），改动面涉及双行合并语义，超 thin 范围，弃（design 记录在案，后续另立）。

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

## D-unmapped-282@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-26-ws-evict-close
原编号：D-001@v1
锚点：未记录
最近确认：97d4780904d3f99be61dc78d641f6e34ee291707
理由：答：最大风险是 `close` 的 await 在 socket 极端僵死时理论上可悬挂——但 Starlette 的 close 仅向 ASGI 协议层投递 close 消息（不走网络层关闭握手），uvicorn 侧对死 transport 的投递立即返回或抛错，与同文件 `connect()` 替换路径 `await existing.close(code=4000, ...)` 的既有先例风险面完全一致（该先例运行至今无事故），故不加超时、保持同款写法。已试放弃的方案：daemon 侧「HTTP 心跳正常但 WS 长期无下行 → 主动重连」看门狗——协议改动大、需 daemon 发版铺开才生效，且 backend 单侧修复到位后该缺陷类不再产生，留作后续纵深防御候选（另立变更）。

## D-unmapped-283@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-26-ci-red-to-green
原编号：D-001@v1
锚点：未记录
最近确认：fa5a6fe1108b468f037a94263c1adb76f2e62dc6
理由：- **最大风险**：daemon 源码 try/catch 加固若吞掉本应上抛的错误——已核对 reportTurnPhase 唯一职责是 fire-and-forget 上报（后端 POST），失败本就设计为不可见（D-009 + 2026-10-26-turn-phase-prod-fix 观测首警兜底），吞同步异常不改变任何业务承诺；且加固后被影响测试断言的是「create 被调用」「pull 被调用」，不依赖上报失败外溢。 - **断言收窄的掩盖风险**：task-lifecycle 过滤收窄可能掩盖未来真实旁路消息污染——对策：收窄精确到 `type==='turn_phase_report'`（不放宽为白名单制），TASK 行数/形状断言原样保留。 - **importOriginal 风险**：真实 spec-sync.js 顶层执行若未来引入副作用（如启动定时器）会进测试——记为已知取舍，当前顶层纯声明（已核对 export 清单）。 - **试过放弃的方案**：① 给 SessionManager deps 增加独立 `onTurnPhaseReport` 回调取代带内 `turn_phase_report` 消息——属 2026-10-26-session-stage-progress D-013④ 已定桥协议的重构，超出本修复变更范围且要动 archived 变更的契约，放弃；② frontend 删/跳过 5 个慢文件——掩盖手法，违反 FR-03「不得删断言」，放弃；③ backend-ci 撞顶再抬 timeout-minutes 到 60——治标，若无挂死实证不先动，留待 FR-04 判定。

## D-unmapped-284@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-27-mobile-chat-dense
原编号：D-001@v1
锚点：未记录
最近确认：a4987c1728d6233de670f91f7d87214d28de3811
理由：最大风险：13px 若仍偏大/偏小需再调——参数集中在该块一处，回调成本一行。放弃的方案：改组件内 Tailwind 类（需在各组件加 mobile 分支 prop，改动面 5+ 文件）——CSS 数值变更走既有元素级通道一处收口更稳；下调至 12px 紧凑档底线——用户仅说「小点」，13px 相对 14px 保守回调一档，避免一步到底过小再回调。

## D-unmapped-285@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-27-mobile-chat-visual-round2
原编号：D-001@v1
锚点：未记录
最近确认：a758f2707ab5d0ddade35f7fdd7bb1de93dbb25d
理由：最大风险：玻璃半透明在深色/花哨内容上滚动时对比度下降——bg-card/75+blur-md 是透明度与模糊的平衡点（穿行内容呈朦胧块非清晰透字），真机不满意可一行调参（/75→/85 或 blur-md→lg）。放弃的方案：①直接改组件内 max-w 类（两挂点+PC 要分支判断，CSS 一处覆盖更稳）；②输入区外框也玻璃化（非悬浮层，无穿行内容只有色差，无视觉收益）；③两面板收进 Drawer（⋯ 菜单开关已够轻，Drawer 交互重）。

## D-unmapped-286@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-27-scheduled-send-attachments
原编号：D-001@v1
锚点：未记录
最近确认：c2d6111ec3d0c98ee7bd96054eaa91fc0a24f734
理由：- 最大风险：**附件 chips 残留或误清的观感回归**——清理时机若用全清（clear）会误伤用户在创建窗口期新上传的附件。缓解：按本次携带 id 精确过滤（onSendSettled 同款 `prev.filter`），meta 镜像逐 id delete；新增测试断言「部分删除后只清剩余」。 - 次要风险：空文本+附件定时属行为放宽，用户可能误建无上下文的定时消息——后端既有附件豁免口径（D-7 看图说话）已覆盖该形态的合法性，与普通发送/忙轮排队一致，不额外设限。 - 试过放弃的方案：①定时弹窗内做独立附件上传入口——上传管线与 UI 重复建设，且与既有交互叙事冲突（弹窗说明「请先在输入框写好要发送的内容」，入口语义是「把输入框现有内容定时发出去」），放弃；②只修 page 模式——dialog 模式同缺口，双模式必须同修否则口径分裂（两处 confirmSchedCreate 历史上就是成对复制维护）。

## D-unmapped-287@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-27-task-wakeup-precision-fix
原编号：D-001@v1
锚点：未记录
最近确认：4dc531554f19e0cb3ed0561f06e4d4c979375f8f
理由：- 最大风险：**既有测试与生产行为的隐性依赖**——现有唤醒用例（如「61s completed 注入恰一次」）的 task_started 构造不带 tool_use 元数据，新判据下走「信息不足兜底」路径，行为恰好不变；但若未来有用例显式构造 meta 而期望旧行为，会静默走新分支。缓解：新增用例显式覆盖三态（true/false/undefined），并在 WARN 日志中标注判定来源，行为可观测可归因。 - 次要风险：Bash 纳入 meta 登记后 `[TASK_STARTED]` 的 task_name 兜底路径变化（meta.taskName 对 Bash = description，与帧 description 同值）——无行为差异，但 `[TASK_STARTED]` 落行量不变（仅 meta Map 增条目），内存开销可忽略（会话终态清理）。 - 试过放弃的方案：①以「tool_result 同轮配对」为判据（最本质）——需跨事件流追踪 result 与轮次绑定关系，改动面与回归面远超本变更体量，放弃；②以「任务名/命令特征」启发式判断——脆弱且不可解释，放弃；③backend 正则只认新文案——混版本窗口功能退化，改为兼容双文案。

## D-unmapped-288@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-27-task-wakeup-inject-retry
原编号：D-001@v1
锚点：未记录
最近确认：41c8d228b7f4e1cd6fffa667deaa9316cab005fa
理由：- **最大风险**：重试造成的重复唤醒轮（首注入实际成功但响应丢失时）。缓解：后端忙轮合并恒≤1 条 + prompt 防重执行指令；空闲期重复轮为纯汇报轮，成本可容忍。 - **次风险**：env 覆写错误计划（如全 0 列表）导致重试风暴——解析层非正整数项忽略、默认计划兜底；止血开关 `=0` 一键回旧行为。 - **放弃的方案**：B/C 两方向（理由见上问评估）；「WS onConnected 立即重试一轮」（recover 链先例）——需挂 WS 连接回调穿层接线，收益（最快场景省 ≤5s）不配复杂度，退避首档 5s 已够短；TRACE 刷屏曾考虑在 daemon.ts 拦截点把 `notePhaseEmit` 挪到 first_event 防重 Set 判定之后——只治桥侧半边，emit 侧（events.ts 每 envelope）仍刷，防重做进 helper 一处治两侧。

## D-unmapped-289@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-27-mobile-chat-visual-round3
原编号：D-001@v1
锚点：未记录
最近确认：3266725e5f931c7b00101b1d1bff2c36ceaf6fa1
理由：最大风险：truncate 超长省略会把尾部信息（如 tok/s）截掉——已通过 mobile 不渲染 detail 优先省出宽度，极端长仍省略属可接受降级（完整信息在轮内详情可见）。放弃的方案：①轮次信息收进可点展开（交互重，分隔行本意是轻量锚点）；②返回钮用 router.back（深链进入会退出站点，显式路由恒可达）；③状态标 mobile 自建简化词表（与 PC 两套词表必漂移，直接消费单一源函数才是「同款」的正解）。

## D-unmapped-290@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-27-session-input-spacing-tighten
原编号：D-001@v1
锚点：未记录
最近确认：644631ac24e0d0e40c35d12fe5ab1bc0dca19dd5
理由：最大风险：@联想浮层与 textarea 垂直对齐漂移——已通过 overlayClassName 镜像同步改消除，并由 draft-scope 回归用例兜底。试过放弃：按用户片段字面把 py-2/py-5 上下全删——会让消息顶行贴边/输入框过扁，按用户片段「只有下内边距」的口径改为只去下保上（pt-5/pt-2），更贴近其真实意图（收紧消息区与输入区之间的空隙）。

## D-unmapped-291@v1 治本目标定为增量方案（又快又稳）
状态：implemented
变更：2026-10-27-archive-reparse-oom-governance
原编号：D-001@v1
锚点：未记录
最近确认：0069bb234ffa70ccfba04426ca885095484926fc
理由：用户确认「增量方案：又快又稳」——结构性事件（归档/删除）秒级~1 分钟内可见、普通文档推送 ≤2 分钟、内存峰值大降不再 OOM；若调研后发现增量方案有安全隐患，退回合并窗方案并回来找用户重新拍板
故障面：增量判定漏路径时部分变更不收敛（需全量兜底通道与对账探针）
退役判据：变更树规模长期 ≤50 且无并发归档场景时可回退合并窗简化版

## D-unmapped-292@v1 mem_limit 再上调只作方案附录建议，不在本次实施
状态：implemented
变更：2026-10-27-archive-reparse-oom-governance
原编号：D-002@v1
锚点：未记录
最近确认：0069bb234ffa70ccfba04426ca885095484926fc
理由：用户选「只做治本评估，不动线上」——mem_limit 调整作为治本方案的配套运维建议写入附录供后续单独决策，本变更不动任何线上配置

## D-unmapped-293@v1 治本方案选定方案C（scoped 增量承接归档 + 探针对账兜底）
状态：implemented
变更：2026-10-27-archive-reparse-oom-governance
原编号：D-004@v1
锚点：未记录
最近确认：0069bb234ffa70ccfba04426ca885095484926fc
理由：用户选方案C——归档移动从 archive_hit→全量 reparse 改为 scoped=[归档名] 定向重扫（parser 三区按 name 匹配既有能力，backend/app/modules/change/parser.py:143-202 三区 iterdir 均带 scope_set 过滤，遍历成本 ∝ scope 不 ∝ 全树）；全量 reparse 退位为手动端点/异常兜底（不做常态化全量对账，尊重 knowledge decisions 拒C 先例）；配套漂移探针 + bundle gzip 构建串行化/按需化 + 内存水位日志
故障面：scoped 语义边界外漏路径（同窗既有删除+归档交错）时部分行不收敛——由漂移探针+手动全量兜底
退役判据：变更树回归百级以下且无并发归档时可选回退合并窗简化版

## D-unmapped-294@v1 方案A（免 reparse 靶向改库）落选
状态：rejected
变更：2026-10-27-archive-reparse-oom-governance
原编号：D-005@v1
锚点：未记录
最近确认：0069bb234ffa70ccfba04426ca885095484926fc
理由：落选——归档 ops 直翻行状态绕开 parser 建第二真相写径，与知识库既有架构决策「平台以镜像文件树为唯一权威、经 reparse 收敛」（knowledge/decisions/backend.md 2026-08-29 变更 D-005 家族）正面冲突；ops 流缺失/乱序时行与磁盘漂移且无自愈通道
否决理由：第二真相写径破坏单一权威架构，漂移无自愈
复潮条件：平台改为「ops 流为权威、文件树为投影」的整体架构重构时

## D-unmapped-295@v1 方案B（全量合并窗治理）落选
状态：rejected
变更：2026-10-27-archive-reparse-oom-governance
原编号：D-006@v1
锚点：未记录
最近确认：0069bb234ffa70ccfba04426ca885095484926fc
理由：落选——时效回落分钟级违反 D-001「又快又稳」用户目标；全量遍历成本仍随变更总数线性增长，治标不治本（470→2000 变更规模时再爆）
否决理由：违反 D-001 时效目标且峰值随规模线性涨
复潮条件：scoped 增量方案论证发现不可消解安全隐患（退回保守路线时按 D-001 预案回访用户）

## D-unmapped-296@v1 双通道时效分档（结构性立即 / 普通推送 2 分钟合并窗）
状态：implemented
变更：2026-10-27-archive-reparse-oom-governance
原编号：D-007@v1
锚点：未记录
最近确认：0069bb234ffa70ccfba04426ca885095484926fc
理由：设计确认轮用户确认——结构性事件（归档/删除）走立即 single-flight 通道（≤60s 收敛），普通文档推送维持既有 120s 合并窗（≤120s 收敛）；single-flight（同 workspace 同时仅一个 reparse）两通道共享不破
故障面：结构性事件风暴（短窗大量归档）时立即通道产生密集 scoped reparse——成本∝单变更，可承受；保底 single-flight 串行

## D-unmapped-297@v1 漂移探针只告警不自动修复
状态：implemented
变更：2026-10-27-archive-reparse-oom-governance
原编号：D-008@v1
锚点：未记录
最近确认：0069bb234ffa70ccfba04426ca885095484926fc
理由：设计确认轮用户确认——探针周期抽样核对（DB 行 location vs 磁盘目录形态），发现漂移仅告警日志；修复通道=人工调既有手动 reparse 端点。依据：知识库已否决「全量对账常态化」（Windows stat 断崖+全量 93s 超时史），自动修复即变相常态化
退役判据：手动兜底频率过高（周级多次）时重议自动化

## D-unmapped-298@v1 bundle gzip 构建加同版本 single-flight
状态：implemented
变更：2026-10-27-archive-reparse-oom-governance
原编号：D-009@v1
锚点：未记录
最近确认：0069bb234ffa70ccfba04426ca885095484926fc
理由：设计确认轮用户确认——同 (workspace, spec_version) 在建期间其余请求等待复用产物，不重复构建（当前可能并发重复打包白耗内存/CPU）

## D-unmapped-299@v1 structural 触发撞在途 reparse 时尾随改「完成回调即时补发」
状态：implemented
变更：2026-10-27-archive-reparse-oom-governance
原编号：D-010@v1
锚点：未记录
最近确认：0069bb234ffa70ccfba04426ca885095484926fc
理由：我的判断（评审核证采纳）：structural 触发遇 in-flight 时不入 120s 定时尾随，改挂「当前 reparse 完成回调」即时补发（完成即重算 scope 执行）；非结构尾随维持 120s 合并窗不变。承诺保持 ≤60s
故障面：完成回调链异常需兜底（回调丢失时退化为下轮触发兜底，探针可发现）

## D-unmapped-300@v1 bundle 等待者 Future 失败传播 + 降级自建
状态：implemented
变更：2026-10-27-archive-reparse-oom-governance
原编号：D-011@v1
锚点：未记录
最近确认：0069bb234ffa70ccfba04426ca885095484926fc
理由：我的判断（评审核证采纳）：single-flight Future 携带成功/失败双态——构建方异常/断连时 Future 置失败并传播，等待者捕获后降级为自建（各自构建，失败不传染不悬挂）

## D-unmapped-301@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-27-mobile-chat-visual-round4
原编号：D-001@v1
锚点：未记录
最近确认：0069bb234ffa70ccfba04426ca885095484926fc
理由：最大风险：seg-width-cap 类被未来新块遗忘挂载（回到散装限宽）——已由测试断言锚（6 用例锚 seg-width-cap）+ globals.css 注释声明单一源约束。放弃的方案：①13 处逐个加 mobile prop 分支（组件改动 13 处×两行 vs 一次类替换+CSS 两行）；②all 视图保留 TurnStatusBadge 仅调样式近似（用户明确「统一用对话的」，两套组件近似必再漂移，正解是删旧用同组件）。

## D-unmapped-302@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-27-netdata-prod-monitoring
原编号：D-001@v1
锚点：未记录
最近确认：089bc22e66afdf4baaa3f8036510f98e4c82b116
理由：答：最大风险是公网暴露——Netdata 面板无认证，若监听公网网卡且安全组放行即等于把全机指标公开。对策双保险：① 服务端只绑 127.0.0.1（应用层兜底，配置错误也不出网）；② 验收时从办公网实测 19999 不可达。次级风险：资源占用——官方口径约 1~5% 单核 + 100~400MB 内存，服务器余量 5.9G 内存，可接受；磁盘默认分层库上限约 1~2G，盘余 41G，可接受。试过但放弃的方案：① apt 装 Ubuntu 仓库版（v1.44 老旧，UI/容器插件弱于 stable 通道现版）；② Netdata Cloud 云端汇总（指标出网，与自托管诉求冲突）；③ 安全组放行 19999 限源 IP（家宽出口 IP 漂移，维护成本高且误配置即暴露，不如 SSH 隧道零暴露）；④ Prometheus+Grafana（运维成本高，单机秒级现场场景过重）。

## D-unmapped-303@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-27-sessions-panes-gap-remove
原编号：D-001@v1
锚点：未记录
最近确认：9b33461733ece7d17dd5becad05889d0bf9f9012
理由：最大风险：两栏贴合后视觉过挤（无 12px 呼吸位）——属用户点名的有意收紧，把手 6px 条仍在场提供视觉分隔；不满意可一行回补。试过放弃：把 gap-3 降为 gap-1.5 折中——用户原话是「去掉」，按字面执行不折中。

## D-unmapped-304@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-27-sessions-total-and-status-filter
原编号：D-001@v1
锚点：未记录
最近确认：9c86c078c5c3d91ea63cd439d1137a079a07a6a7
理由：- 最大风险：PC 端 SessionListPanel 体量大（~2500 行）且测试面广，「活跃→在线」改名与组内 10 条收敛可能波及既有断言文案——改动严格限定 STATUS_OPTIONS 命名 + 截断常量与在线豁免逻辑，跑该组件既有测试全量核对（该文件属本变更触及面，非全量测试）。 - 试过放弃的方案：① 后端 limit 放宽到 le=2000 让前端拉全量——放大量级敏感查询（q 搜索/links 子查询）且治标不治本（5000 条时再截），放弃；② 新增独立统计端点 GET /sessions/status-counts——多一次往返与一个 openapi 面，而 status_counts 与列表同过滤口径天然同源，并入列表响应更稳，放弃；③ 手机端 chips 计数用客户端样本估算——515>500 时计数错（正是本次要修的病根），放弃。 - 遗留已知边界：全工作区在线会话数 >500 时「在线全显」仍受单次拉取上限约束（status_group 过滤后的命中集本身 ≤limit）——不另做聚合翻页，计数仍真实（status_counts 不受 limit 影响）。

## D-unmapped-305@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-27-task-parser-md-check-fallback
原编号：D-001@v1
锚点：未记录
最近确认：4816e3611244550fc2e97be15e7049d7dbf10665
理由：最大风险：卡片 frontmatter 显式写了 `status: draft`（人工想强制 draft）的场景会被误回退为 done——已靠键存在性区分（显式 draft 优先于勾选态）消除；残留面是极旧的卡写了 status 但语义与勾选冲突（未见实例，reparse 幂等可观察）。放弃方案：①改 CLI 让 task-tick 同步写 TaskCard frontmatter status——跨工具改动（sillyspec CLI），平台侧修不动上游，且 TaskCard 是执行卡非状态源的模板约定会被打破；②reparse 后置覆盖（先解析卡再用 tasks.md 覆盖同 key）——与「卡片富信息优先」docstring 声明正面冲突且丢显式 status 语义，不如解析内回退干净。

## D-unmapped-306@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-28-knowledge-hits-cli-direct
原编号：D-001@v1
锚点：未记录
最近确认：21104e0be0f0336e046643a4253d49a138840e52
理由：最大风险：**shpsync_ 令牌的写面扩大**——此前 shpsync_ 只开放 spec 同步族端点，本变更新增一个遥测接收端点。缓解：端点只写不读（不返回任何既有数据，回执仅计数）、复用 ingest 宽容语义（坏行跳过不炸）、且遥测数据本就来自令牌持有方自己的仓库执行期——伪造收益仅污染自己 workspace 的遥测统计。次风险：CLI 侧（另仓变更）直报失败的静默面——由 best-effort 语义 + 本地文件必写 + daemon 兜底三层覆盖（前序变更 D-001）。 试过但放弃的方案： - **扩展现有 hits/batch 端点兼容 shpsync_**（require_permission 加分轨分支）：破坏四轨分轨铁律（patterns.md#四轨鉴权——shpsync_ 与用户轨混开鉴权分支正是分轨设计要防的形态），且该端点 query 显式 workspace_id 与令牌派生两来源冲突； - **CLI 走用户 JWT**（platform.token 换用户令牌）：platform connect 发的就是 shpsync_ 同步令牌（绑定 workspace 的长寿命令牌），CLI 无用户登录态可持有，改造成本远超新增端点； - **daemon 代转**（CLI 不直报、等 daemon 周期上行）：即维持现状断流形态，已被用户拍板否决（要实时性主通道）。

## D-unmapped-307@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-28-change-detail-sessions-source-fix
原编号：D-001@v1
锚点：未记录
最近确认：849706364deefb92a01024ae3ea2f72abdc6fde9
理由：最大风险：substr 64→512 放宽后单行拉回字节量增大（数百会话列表请求时放大），但 512B×N 远小于原 TOAST 全文口径，且仅标题子查询路径。评审 P1（已修复）：daemon 自愈回写 healed 原样超 title_fallback 列宽 String(64) 会使 PG 列表 500——回写截 [:64] 对齐列宽，防回归测试钉死（写回值长度断言双方言可判）。已放弃方案：① SQL 侧正则剥离（PG regexp_replace 与 SQLite 方言分叉，违反双方言约束）；② 重算存量 title_fallback 列（需迁移+回填，把小修复撑大，读侧清洗可达同显示效果）。

## D-unmapped-308@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-28-cgroup-v2-watermark-fix
原编号：D-001@v1
锚点：未记录
最近确认：19b14831150ba84a4e522925f5223fe05507323e
理由：最大风险：混合挂载形态（v2 无限制 `max` 且 v1 文件同时在）会回退用 v1 limit 算水位——语义上仍是「存在某限制」，方向安全，且该形态实际不存在于统一层级宿主。试过放弃的方案：为 `max` 字面量加显式分支返回哨兵值——放弃，因为现有 ValueError 落回路径已得到正确终态（None 跳过），加分支只增加状态面。

## D-unmapped-309@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-28-bg-scan-tailread-eviction
原编号：D-001@v1
锚点：未记录
最近确认：6239db2300df4672b57ee50eb8da500d04ffd4b8
理由：最大风险：淘汰可见集若因发现链瞬时抖动漏掉在产路径，会误删其幂等基线导致终态重报——backend 侧已声明重复上报无害（同值信号），且 discoverLivenessWatchTargets(rescan:false) 完全由内存 spawn 记录推导、无 fs 抖动面，风险可控。试过放弃的方案：①内层 Map 加条目级 TTL/LRU——放弃，会话存活期内条目本就该保留（幂等基线），TTL 反而制造重报；②保留 size>200 阈值门——放弃，每轮 O(n) 核对在 60s 节奏下成本可忽略，阈值门只是把正确性修复重新变成条件触发。

## D-unmapped-310@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-28-reparse-trigger-tests-realign
原编号：D-001@v1
锚点：未记录
最近确认：00df74b42338c5d02a9cb23a385ce07761fe66e8
理由：最大风险：若 60629d2bb 实为回归（测试才是对的），本变更会把回归固化为契约——已用四点证据排除（docstring 决策落痕、-S 唯一引入、新契约测试全过含归档翻转端到端、生产实证 OOM 治理动机）；且归档区 delete 的行删除能力由 scoped 覆盖（test_archive_scoped_reparse.py 锁定翻转），旧「全量」口径无独有能力。放弃方案：改实现回旧口径——直接违背 D-004/D-007 的 OOM 治理目标（全量重扫是内存峰值主源），否决。

## D-unmapped-311@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-28-model-retry-visible
原编号：D-001@v1
锚点：daemon/schema.py
最近确认：265543056ebc5d72193ead562b28dec0f8d38671
理由：最大风险：CLI api_retry 帧的 `error` 字段形态漂移（SDK 类型为 SDKAssistantMessageError 对象，可能随版本变化）——防御：归一化与落行两处都做「非字符串则 JSON.stringify + 截断」，前端渲染对解析失败有中性兜底（FR-02 场景三），最坏退化为不可读摘要行而非报错。次要风险：重试风暴一次轮可产生约 10 行协议行，时间线行数增多——终态轮不渲染已兜住对话正文噪声，进度视图行数可接受（与 thinking 分段同量级）。 试过但放弃的方案：①notifyTurnPhase 新增 `model_retry` 阶段——TurnPhaseValue 七阶段语义均为轮启动阶段，backend schema（daemon/schema.py TurnPhase 枚举）与前端阶段状态条渲染面都要扩，改动面大于协议行方案且信息载量低（phase 无 attempt/error 载荷位）；②daemon 侧对 rate_limited 轮做自动延迟重注入——属行为变更，与 FR-03「纯可观测性透传」定位冲突，且掩盖供应商侧问题（用户应看到限流并决策换模型/稍后再试）；③仅改前端把「API Error」assistant 文本行实时显示——该文本只在轮终态合成一次（重试期间无 assistant 帧），解决不了重试风暴期间的可见性（本次问题的主诉）。

## D-unmapped-312@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-28-release-mirror-persist
原编号：D-001@v1
锚点：未记录
最近确认：1105efc2682cce5e8cbfe50ebf9137c44423011b
理由：答：最大风险是 SQL 直改生产库绕过应用层校验（API 取 token 不可行——bootstrap 密码已与实际不符，401）。对策：单行 UPDATE、新旧值留痕、改后立即容器视角核验；不做任何凭据重置。 放弃方案： - A（compose 增设专用挂载 /srv/releases）：要动共享 compose 文件且本地语义无增益——放弃，改 env 换源零 compose 改动。 - B（走 API 建改工作区）：管理密码 401 取不到 token，重置凭据超出本变更范围且引入安全面动作——放弃，走 SQL 单行 UPDATE。 - C（/tmp 旧目录双写过渡）：双源并存违反单一数据源目标，/tmp 侥幸链正是本变更要消灭的对象——放弃，验证通过后一次性删除旧目录。

## D-unmapped-313@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-28-release-record-generator
原编号：D-001@v1
锚点：未记录
最近确认：5a38cc907fba2b2f527a74f152c7fad83e7f7ed1
理由：答：最大风险是脚本生成的 frontmatter 与平台解析器实际口径仍有隐性偏差（YAML 方言、字段类型）——对策：生成后自检 + 沙箱产物对照平台口径逐字段核对（task-03），并以 seq48（claude-code 手写、平台判 valid）作对照样本。 放弃方案： - A（脚本内自算 seq）：next-release-seq.sh 是 2026-10-18 固化的单一取号源，双实现必漂移——放弃，改为调用。 - B（走 API 取锚点）：生产 token 不可用（bootstrap 密码失配 401），且 skill 明文「不可达则看本地记录」——放弃 API 路径，本地文件推导为准。 - C（生成器直接 scp 同步服务器）：同步属部署收尾动作、依赖 ssh key 与时机，塞进生成器会让「写记录」与「部署收尾」耦合（本地流程也会被迫碰 ssh）——放弃，生成器只打印指引，同步仍由 deploy-to-server 流程执行。

## D-unmapped-314@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-28-session-list-loadmore-fetch
原编号：D-001@v1
锚点：未记录
最近确认：b9949cdbf7ab26e95b30b7016ce90fb6c4f3390d
理由：最大风险：组内点击触网拉回的 20 条可能不属于该组（进其它组），该组本次点击 只见本地展开的行——与「无限加载」心智一致（列表整体在生长、按钮可重点）， 可接受。放弃的方案：组内按钮完全等价树底部入口（点击只触网不本地展开，等 响应回来组内才多行）——本地明明还有隐藏行却等网络，慢且浪费；选「本地展开 + 并行触网」组合。

## D-unmapped-315@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-29-floating-scope-loadmore-fix
原编号：D-001@v1
锚点：未记录
最近确认：43ac7dba92d02e2eb927bcea86cf41a7fb28d09b
理由：最大风险：稳定键漏拼某个标识字段——某分支字段未进键，则该字段变化不触发清空（旧口径附加段泄漏进新视图）。对策：键构造与类型判别联合同文件同居（类型加字段时函数在同文件可被 tsc 联合收窄错误立即暴露）+ 纯函数四分支键唯一性用例钉死。放弃的方案：①floating-session-host 侧 `useMemo` 包 scope——只修一个调用入口，未来新调用方内联传参复发；且 `lockedRuntime` 若引用不稳定 useMemo 依赖仍需二次防御，不如消费端标量化根本。②effect 依赖改 `scope?.kind` 仅判 kind——同 kind 不同 id 切换漏清（FR-02 场景），不可行。

## D-unmapped-316@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-29-edit-diff-stat-badge
原编号：D-001@v1
锚点：未记录
最近确认：5e89be8febddf3883db1e01c22bccb6ef5572af9
理由：- 最大风险：大 patch（数千行）重复解析开销。缓解：跑马灯条目窗口上限 12 条、派生发生在 deriveLiveMarqueeEntries 纯函数内（段引用变化才重算，React memo 链既有）；ToolRowView 侧 useMemo 按 editPatch 字符串缓存。实测面量级（单文件 patch 数百行）无虞。 - 已放弃方案 a：用 hunk 头 oldLines/newLines 直接相加（省一轮遍历）——Write 覆盖写等场景 hunk 头与 lines 实际前缀可能不一致，且与展开区行级 diff（按行前缀渲染）不同源，会造成两处口径漂移。 - 已放弃方案 b：daemon 侧预计算统计随事件下发——多一层协议与 api-types 改动，前端已有全量数据，本变更不需要。 - 已知边界：zcode 引擎交互链路 edit_patch 暂缺（providers.ts 标记「structuredPatch 未验证」）→ 该引擎下按 FR-03 不伪造口径自然不显示徽标，引擎侧后续补齐数据后零改动自然点亮，不在本变更范围。

## D-unmapped-317@v1 落选——估算并入既有 usage_update 通道
状态：rejected
变更：2026-10-29-engine-live-perception
原编号：D-002@v1
锚点：未记录
最近确认：de68b356befe540e0c77695de92216fb36c1a5e9
理由：不采用（用户选定方案二，本条为落选防复潮记录）。
否决理由：usage 字段语义被估算值污染——预算软切断（liftSessionUsage/aggregateSessionUsage/checkBudgetCutoff）、计费聚合、ctx 环所有既有消费方都需防「估算混入聚合」，漏防一处即钱与切断阈值的事故面；与 2026-08-27「实时/终态口径必须同类」决策正面冲突（轮结束权威值落定必跳变）。
复潮条件：usage 消费面收敛到单一展示用途且预算/计费全部改走独立聚合源时成本反转。

## D-unmapped-318@v1 落选——纯前端等待态分级（不动 daemon）
状态：rejected
变更：2026-10-29-engine-live-perception
原编号：D-003@v1
锚点：未记录
最近确认：de68b356befe540e0c77695de92216fb36c1a5e9
理由：不采用（用户 P0 裁决 C 要求估算数字按引擎能力补显，纯文案不满足）。
否决理由：token 数字全程不动只换文案，不满足用户 P0 裁决 C（估算补显），治标不治本。
复潮条件：daemon 侧改动长期不可行（引擎面冻结）时可作为降级兜底单独启用。

## D-unmapped-319@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-30-task-resume-revive-notify-retry
原编号：D-001@v1
锚点：未记录
最近确认：fe76ef065bf68f74d521fccc6c1247973c1eed65
理由：- **最大风险**：SDK 续唤时是否可靠重发 task_started 未实证（CLI 转录不记 system 帧、daemon.log 无注册日志；归一化器注释已知「SDK 重放 task_started」形态存在）。若 SDK 对某些续唤路径不重发帧，resumed 信号源缺失，运行期显示失真仍在——本变更保证「SDK 重发时全链路通」，不声称覆盖引擎不发信号的场景（引擎契约限制，如实声明）。 - **试过放弃：时间阈值启发式复活**（终态后 N 秒外 running 视为续唤）——task-sweep-liveness-guard 历史否决同型，时间猜测必误判长任务/跨轮任务，不复活。 - **重试风暴风险**：上限 3 次 + 指数退避 + 仅 5xx/网络错误触发；4xx 即刻放弃。502 实测场景（平台网关故障时段）多事件并发各退避，最坏 4 次请求/事件，可接受。
