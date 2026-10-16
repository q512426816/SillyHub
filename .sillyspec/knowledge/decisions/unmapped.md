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
