# 决策知识 — sillyspec

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-006@v1
状态：implemented
变更：2026-09-19-tool-report-session-replay
锚点：sillyhub-daemon/src/agent-log/registry.ts:57（PARSERS 单项注册表——扩展点）
最近确认：53c67e02a
理由：claude-code-jsonl 新增解析器并注册（对话化 + usage 一起落地，含 D-003 归一化）；cursor-agent CLI transcript 新增扫描上报（~/.cursor/projects/*/agent-transcripts/，现 96 份零上报）+ 新增解析器（结构干净 {role,message} JSONL + turn_ended，非 Claude Code 同构）；cursor IDE store.db（cursor-chat-sqlite）维持不做对话化（blob 库、无 token），但其 409 死胡同需给出像样说明；zcode 既有解析器补 D-004/D-005 字段

## D-001@v1
状态：implemented
变更：2026-09-11-agent-log-attribution-refactor
锚点：sillyspec 仓 src/agent-session-log.js（detectZcode/detectAgentLogEntries/recordAgentLogInvocation）
最近确认：353eb11b0
理由：会话身份锚定——只给「本 run 所属 agent 会话及其子代理（zcode parent_id 链）」打 ctx；识别不出不打标（宁缺毋滥）

## D-001@v1 派生粒度=工具调用聚合为单任务
状态：implemented
变更：2026-09-07-pi-task-events
锚点：未记录
最近确认：35f3d6528
理由：以「一轮（turn）内的活动」聚合为单条任务：turn_start 建/复running行（task_id=pi-run-<runId> 稳定键，task_name 取首轮用户消息或'执行任务'），tool_execution_start 刷新 last_tool_name/tool_uses 累计/summary（'正在调用 X'），tool_execution_end 保持 running（工具成败不等于任务成败），turn_end 按 stopReason 映射终态（error→failed 其余→completed）置 message/finished_at。子代理粒度（claude Task 工具那种）pi 原始流无对应概念，不做

## D-002@v1 派生位置选归一化器（方案 A）——⚠️ 自主决策待用户复核
状态：implemented
变更：2026-09-07-pi-task-events
锚点：未记录
最近确认：35f3d6528
理由：选 A。PiEventNormalizer 增实例级 turnTask 聚合状态产出 status/agent_task_status——贴 claude-events 同位置派生信号的既有架构，session-manager/_dispatchStatusEvent→cli 上报链路零改动，纯函数测试范式可延续；代价是归一化器从逐行纯函数升级为实例级状态机（turn 边界做状态推进点，normalizeRpcLine 单行解析仍独立）

## D-003@v1 设计整体确认——⚠️ 自主决策待用户复核
状态：implemented
变更：2026-09-07-pi-task-events
锚点：未记录
最近确认：35f3d6528
理由：按 D-001/D-002 定稿确认。原型跳过理由：纯数据链路补齐，前端任务执行面板零改动（pi 会话从空态变有数据，无界面变化，原型分级「纯后端无界面变化」档）

## D-004@v1 design-grill 修正——stopReason 枚举实证与测试路径
状态：implemented
变更：2026-09-07-pi-task-events
锚点：未记录
最近确认：35f3d6528
理由：修正三处：①fixture 全量实证 stopReason 仅 stop/error 两值，aborted 是 ame.error 的 reason（流层中止）非 stopReason——删除 aborted→stopped 映射，被打断的轮按 completed 收行；②测试路径实存 tests/interactive/pi-events.test.ts，新增集成用例定名 tests/interactive/pi-task-dispatch.test.ts；③R-01 应对改写：既有用例 expected 数组需追加派生事件（预期适配非破坏）

## D-001@v1 维持 R-01 接受不修代码，文档登记观察项（方案 A）
状态：implemented
变更：2026-09-16-background-task-grace-timeout
锚点：未记录
最近确认：83b402f6b
理由：D（不改代码），文档载体方案 A。维持 2026-09-15-background-task-permission-lockout R-01 已接受的 P1 风险；本变更收窄为 known-issues.md 观察条目（四要素：暴露差/缓解链/重估触发/未来修复首选）+ 本变更 design.md 否定决策存档
故障面：若未来线上实证注册表泄漏（守卫放行但无对应存活任务），无界宽限暴露面超出设计先例——观察项记录的重估触发条件命中时按「未来修复首选：双窗兜底（条目存活=静默<60min 对齐先例 且 总时长<4h 绝对上限）」重开变更
退役判据：SDK 提供 per-task 权限上下文（canUseTool 带 task 归属）或 task_notification 可靠送达保证时，本观察项与 R-01 一并退役

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-26-assets-test-binding-raw-text
锚点：未记录
最近确认：8f587cde7811c61df600f7b7d23c9c9eaedcd1b2
理由：最大风险：requirements.md 槽格式是 sillyspec 工具约定（AGENT 注释 + 内容行），工具改版后格式漂移会让正则失配——表现为 raw_binding=None 静默降级（与现状等价，不劣化），且工具坑已留档（test-trace 截断坑里建议摘录保真，若工具侧修了截断，tests 数组本身带用例名，本原文行自然退居补充信息）。试过但放弃：①改摘录器保真——外部 CLI 工具，本项目侧改不了；②前端自行拉归档 requirements.md 展示——归档件在 spec 镜像树，无逐文件读取端点，为展示开新端点收益不成比例。正则锚点取 FR-[A-Za-z0-9-]+ 宽容匹配（含 FR-auto-xxx 等未来形态），内容行截止到下一 <!--AGENT: 或空行。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-26-assets-testfile-path-resolve
锚点：未记录
最近确认：49117b2a8bfc07fb875117a81dcd1c9a8d9f6ba1
理由：最大风险：短路径后缀匹配救错文件——同 basename 的测试文件在仓库多个模块存在且都非 `.sillyspec/.runtime/` 前缀时（如 frontend 与 backend 各一个同名测试），后缀匹配多命中已降级为候选列表由用户选，不自动猜；唯一后缀命中才自动救回，且救回时弹窗明示真实路径 + 原记录路径，用户可察觉错配。试过但放弃：①直接修归档件 test-trace.json 的路径数据——放弃，审计件 sha256 锚定链会被破坏，且同类短路径在其它归档变更可能重复出现，逐个修数据不如展示层统一兜底；②后端 assets 聚合时归一——放弃，后端容器无真实仓库文件系统，探测必须走 daemon RPC，等价于把解析搬到后端但多一跳契约变化，收益不成比例。搜索端点按文件名子串匹配（RPC 60s 超时）大仓性能由 explorer 既有实现承载，本变更只新增弹窗打开时的一次调用。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-26-change-asset-transparency
锚点：未记录
最近确认：8846b46367fb931d6e806042b88c4d591a5e8781
理由：最大风险：「待复核」标记语义≠完整知识消费面——flow start 注入的知识命中（conventions/patterns 锚点）不落盘，本组只覆盖被 flow done 打标的 FR/决策（有覆盖交集才打标）；页脚措辞如实（「知识触达（待复核标记反查）」）不冒充全量消费记录。次风险：模块图 paths glob 语义简化为去 ** 前缀匹配——深嵌套例外路径（负 glob/多段通配）会误归/漏归，模块图现行形态（单前缀+**）下无实例，误归代价是 chip 多一个可点项（低危）。中文名 h1 提取对无 h1 文档回退 id（conventions 要求模块卡 h1 中文名，存量已合规）。试过但放弃：①CLI 侧落盘完整注入清单（含知识命中）——外部工具改动，留坑建议；②模块页独立路由——平台无模块卡页面先例，开新页面超本变更换代价值，先以文档预览弹窗承接，后续有模块中心需求再升格。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-26-change-detail-restore-assets
锚点：未记录
最近确认：83bde5d52c29cd07960e1d300d9541bf6a44a5ec
理由：最大风险：恢复的挂载再次被并行会话夹带覆盖（本次事故根因即此）。缓解：新增页面级钉子测试断言资产卡与观测事件卡并存，下次任何提交删挂载会被聚焦测试拦下（CI 层面）。试过但放弃：把 aside 卡片清单抽成数组配置防漏挂——放弃，卡片间挂载条件与注释各不相同（quicklog 卡需 change_key、对账卡带 archived 语义），抽象后反而丢语义，收益不成比例。线上已部署旧镜像的窗口期：需重新部署前端镜像才能让用户看到恢复，代码层无风险。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-26-change-real-timeline
锚点：未记录
最近确认：e120a799bafc77f4b5b9f35e7971baece30c33f8
理由：最大风险：事件流覆盖不全（watcher 后拉起/单飞锁盲窗，CLI 脚注同款披露）——展示面注明「观测起点≠诞生时刻」，墙钟统计以首末事件为界，不冒充完整历史。次风险：tasks.md 机器稿行含长描述截断规则与未来格式漂移——正则宽容匹配（task-\d+ 后冒号任意文本），坏行跳过不炸。试过但放弃：①把 CLI 命令嵌 daemon RPC 直接取渲染文本——耦合 CLI 输出格式且失去结构化（前端无法做任务面表格），且 daemon 旧版无此命令会 502；②events 表加 timeline 专用投影列——违反红线 D-004（零业务加工），聚合现算即可（变更事件量级 <100/单变更）。commit 标题匹配用 9 字符短哈希前缀——碰撞概率在 limit 50 窗口内可忽略，命中多条取最新。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-26-knowledge-card-machine-block
锚点：未记录
最近确认：963dde53e652652befc497ed379f1eaefe60924b
理由：最大风险：对 writer 格式演进的耦合——tests 多值连接符 " | "、两空格缩进、字段集是 sillyspec test-bindings.js 的现行形态，CLI 侧改形态时这里需跟（宽容匹配注释标记前缀已留余量；tests 用 "|" split 天然容忍多值）。试过放弃的方案：①整块隐藏机器块——丢 tests 覆盖信号，放弃；②后端解析透传结构化字段——动 openapi/api-types 面大，展示层问题展示层解决，放弃。另注：knowledge-page 既有深链用例在 jsdom 下有 scrollIntoView 未实现的既有报错噪音（与本次无关，昨日引入）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-26-migration-chain-dedupe
锚点：未记录
最近确认：a82bf152600857f3cc6980934b6a5a296fda5bdb
理由：最大风险：重写 040000 DDL 造成「文件内容与历史已应用效果不一致」的审计歧义——某库记号 040000 但表结构可能是旧版也可能是（未来的）新版，只能靠矫正迁移的存在与 information_schema 探测兜底对齐。缓解：040000 docstring 显式记重写历史与适用边界；矫正迁移 234000 紧随其后，任何路径到达 head 后表结构唯一确定（幂等探测保证收敛，与起点结构无关）。 试过但放弃：①给 063000/040000 加「表存在则跳过」幂等 guard 保留双文件——放弃：全新库仍按图序执行两份建表逻辑，且两条分支结构不一致（stage 列有无），guard 掩盖而非消除分叉，链图审计面双份；②ts 转 ISO 用 ts::text——放弃：输出「2026-09-25 06:04:02.526+00」（空格分隔、+00 后缀）与 service 层写入的 ISO 8601 格式不一致，混合格式破坏字典序比较一致性，用 to_char 统一 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'。 次要风险：stage 历史值丢弃（119 行）——观测数据无消费方，接受；severity NULL→'info'（157 行）与 rule NULL→'' 的回填值是语义近似（历史写入端未归一），展示层无差别。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-26-probe-concurrent-rpc
锚点：未记录
最近确认：43ee45c1ffc967e605e6a35482f84318e65d9e3d
理由：最大风险：把 3s 预算设得比真实慢链路还短——daemon 在线但公网高抖动（>3s）时探测会从「慢但有真答」变成「unknown」。权衡依据：探测是三态 UI 展示（unknown 时界面照常显示「未知」并维持现状路径，§5.D），拿不到真答的代价只是显示降级，而 30s 预算下整批探测拖分钟级的代价是用户可感的全局卡顿；且单次 stat 本地执行毫秒级，3s 已含 ~3 个数量级的网络余量。 试过但放弃：给 git_probe 结果加 TTL 缓存（比如 30s 内复用）——被 R-02「每次调用实时探测不缓存」明确否决，且缓存会让「daemon 刚下线/刚变 git 态」的展示滞后，违背探测语义，放弃。 次要风险：gather 不开 return_exceptions，若未来有 git_probe 实现抛异常，并发版会在首个异常时与其余在飞任务一起快速失败——与原串行版「首个异常中断」语义一致，不视为回归。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-26-sillyspec-command-queue
锚点：未记录
最近确认：8fa02468648621a9d4bf8a745cca6b1a5a895f3d
理由：最大风险：排在长升级链（npm 安装分钟级）后的命令可能撞前端 150s 回显恢复窗（ECHO_TIMEOUT_MS）——前端恢复按钮可重试，重复排队条目执行幂等裁决（重复 resolve 同一 change 无害，冲突已消解则 no-op），且冲突计数 ≤75s 采集刷新自愈；不设队列深度上限（单管理员洪水不存在，设上限反而重新发明忙拒）。试过放弃的方案：①保留忙拒+前端自动重试——复杂度推给两端且用户仍见失败红字，与本次反馈直接冲突；②升级完成事件化（await 一次性 promise）——升级链状态机（_update running/deferred→终态+10min 展示窗）无单点完成信号，deferred 复查本身已是 1s 轮询实现，事件化需动 manager 状态机超出薄改范围；出队时 1s 轮询与其等价且零侵入。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-26-thin-badge-survives-archive
锚点：未记录
最近确认：1556fe5581282d478fa783f2808213c8f6fddb32
理由：最大风险：时间窗边界误判——若数据库存在 created_at 异常（时钟漂移/手工导入）的边界数据，可能误标/漏标出身；误标代价仅是多显示一个徽章（低危展示层），且 thin 分流上线后 quick 类型不再新增，窗口语义单调。试过但放弃：①镜像 flow-state.yaml tier==thin 精确投影——需后端详情读侧加文件系统读取，读放大不成比例；②列表页徽章同改——列表行徽章走 ChangeStepBadge（另一组件），用户诉求在详情页标题，列表另行跟进不夹带。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-27-assets-testfile-bracket-note
锚点：未记录
最近确认：99c508227642192dc929cd0702441f3303a6ceff
理由：最大风险：真实文件名含「」字符会被误剥——测试绑定约定「」为用例名注解语法，且仓库实测无此类测试文件名，接受该权衡并在函数注释言明。放弃方案 a：改 sillyspec CLI 的 flow done 补全解析（tests[] 只存纯路径）——治本但属另一仓库存量数据救不回，已按规则 15 记 docs/sillyspec/ 活跃坑；放弃方案 b：只在 TestFileBody 局部剥——resolveTestFilePath 的 norm 与搜索入参两处口径会分裂，故统一在归一函数做。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-27-audit-followup-hardening
锚点：未记录
最近确认：40d8eff338498f37fe88f548e325ba2ff9925c94
理由：最大风险：合法但形态特殊的 doc 值（如含反斜杠的合法相对路径）被误判越界丢弃 chip——影响面仅展示降级（名回退 id），不丢模块触达本身。试过放弃：①「resolve+is_relative_to 白名单」——Windows 大小写/符号链接语义跨三平台分歧大（规则 13），纯词法判定更可移植；②「doc 保留仅去 h1 读取」——越界路径仍外发给前端 chip 可点击，留下二次面；③「同步修 explorer 预览侧」——explorer 自有寻径防护（前端传参仅展示路径），无需重复设防。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-27-change-list-is-thin
锚点：未记录
最近确认：4d340be72fb09d9a120c2f65a6416da45f4f293e
理由：最大风险：判定口径与前端 lib/thin-lineage.ts 双实现漂移——注释互指+同口径测试锚定（后端 6 用例对齐前端 6 用例矩阵）；已放弃：ChangeRead 详情也加 is_thin——详情前端已有本地判定且正确，最小面原则不加。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-27-daemon-queue-stop-gaps
锚点：未记录
最近确认：3942b156fd3a9feb541d81daccbc763a2f5cad94
理由：最大风险：预算 5 分钟是经验值——合法但极慢的升级链（网络差时 npm 拉包+校验）超 5 分钟会让本可成功的命令记 failed；代价有限（失败终态可重试、命令幂等、前端恢复按钮在），优于无界楔死。其次：超时后升级仍在跑，后续命令继续排队各等 5 分钟逐条 failed——「逐条显式失败」仍是活性态（链尾持续推进），非楔死。试过放弃的方案：①「排除 deferred 态出等待」——deferred 任意时刻可翻 running，会在 npm 半安装窗口并发 spawn CLI，违背安全动机，放弃；②「等待超时后照常 exec」——同半安装风险，放弃；③「给 deferred 复查本身加上限」——改 manager 状态机越界本变更范围（deferred 无限推迟对升级链自身是合理语义），放弃。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-27-governance-rpc-actions
锚点：未记录
最近确认：3306460582a64242091b32ebee63a85f1b071444
理由：最大风险：spawn shell:true 命令串注入——kind 白名单硬编码 + 域名 [a-z0-9-]+ + root_path 元字符黑名单三层，且 root 只进 cwd 不拼命令串。次风险：RPC 优先路径的 backend 测试只验回退（happy path 由 daemon 侧 handler 测试 + 真实链路 E2E 留部署后——ws_hub mock 成本高，披露）；digest 超时 60s 偏宽（CLI 大仓绑定扫描秒级实测，留观察）。放弃方案：平台直接 spawn CLI（无 daemon 链路）——平台容器不可达成员仓工作树（2026-09-11 skills-central-library 同款结论）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-27-hover-polish
锚点：未记录
最近确认：05218185395f1b6b94a0557de0af22ab7fae78d7
理由：最大风险：muted 实色在 dark 主题的悬浮对比（dark muted=zinc-700 深灰，实色悬浮为深一档——与原型 canvas 语义一致方向）；已放弃：自定义 canvas 色阶 token——三主题 muted 即语义等价物，不新增阶。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-27-knowledge-governance-cards
锚点：未记录
最近确认：99c508227642192dc929cd0702441f3303a6ceff
理由：最大风险：与 CLI digest 的口径分叉（unmapped 基线消音平台侧没有、绑定信号缺失）——双出口数字可能不一致；缓解：unmapped 只进 totals 降展示级、绑定信号 CLI 独有已在两端注释与卡面处置文案交叉指引，v2 可经 daemon RPC 直采 CLI digest --json 收敛单源。次风险：伪域 v1 只读卡（迁移动作 CLI 手工）——动作回传 v2；阈值与 CLI 同值但两处字面量（跨仓无法单源），注释互指。放弃方案：daemon RPC 实时跑 CLI digest——正确终态但需 daemon+RPC 双端改造，v1 平台直算已解 3/4 信号可见性，性价比不对等。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-27-thin-affected-modules-from-patch-manifest
锚点：未记录
最近确认：8acb0f197f8b660e404eefa917b0fbebd621e1ac
理由：最大风险：files 含 CLI 侧冻结的 `.sillyspec/docs/` 交付文档路径（note 声明保留），可能命中文档类模块产生轻微噪声——实测本仓 SillyHub 图无 docs/ 前缀模块，噪声为零，故只滤 `.sillyspec/changes/` 而不扩大滤除面。放弃的方案：直接读 CLI 新三键 `modules[].id`——id 语义绑定 flow 运行仓的项目图，跨仓无意义，且存量件无此键。曾评估并否决「维持单图」：单图选择依赖目录字母序巧合且 Windows 平台失效（实测坐实），多图合并的粗粒度冗余命中（backend/frontend 顶层粗模块与细模块并存）经真实数据冒烟权衡为可接受展示代价，最终落地多图合并（本条为评审 P2 清偿修正——原稿写作时基于「SillyHub 单图已覆盖」的错误前提）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-27-thin-display-fix
锚点：未记录
最近确认：4d340be72fb09d9a120c2f65a6416da45f4f293e
理由：最大风险：steps 兜底判定对「无 steps 记录的标准变更」误判——判定要求 steps.length>0，空 steps 不命中（标准变更 active 期必有步骤记录，归档标准变更 steps 含四阶段痕迹已验证 observation 样本）。钉子测试暴露并修正了 quick 时间窗缺失（历史 quick 误标）；放弃：列表行归档 flow-thin 出身标识——列表投影无 steps/change created_at 有但 change_type=feature 无信号，需后端 is_thin 投影（已列遗留）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-27-timeline-coexist
锚点：未记录
最近确认：d3ee2bbd7cc53faf6cabdfc312554ef032dcddb3
理由：最大风险：厚变更若事件表有历史数据，归档后详情页会多出一张合成卡——判定为可接受（信息增量，非误报；事件恒 provisional 角标已声明观测语义）。试过放弃的方案：恢复第一代 tasks.md 勾选时间戳指令（需改 CLI 流程模板且与第二代 watcher 事件流机制重复，放弃）；后端在 steps 里带真实事件时间（改 CLI 同步协议，面大，放弃）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-27-timeline-task-time
锚点：未记录
最近确认：365d909efbe7a04dc4429d377c5a7487713fa2b7
理由：最大风险：tasks.md 行序与事件勾选计数序错位（人工重排行/中间插行）会标错时刻——CLI 同款固有语义，卡上已恒定标注「≈顺序推断」脚注，可接受。试过放弃：把推断下推到 watcher 推送时带任务 id（需改 CLI 事件协议且历史数据无法回填，放弃——推断层纯展示零协议负担）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-27-visual-align-2
锚点：未记录
最近确认：05218185395f1b6b94a0557de0af22ab7fae78d7
理由：最大风险：[&>*] 子选择器依赖子卡 SectionCard 边框类形态，子卡改版式会失效——已用详情域 134 用例对冲。放弃：时间线组件重写——核对发现其已是竖线节点形态（pl-[26px]+before 竖线），无需重写；头像完整用户名展示——原型即 20px 首字符，title 携全名。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-27-visual-gap-fix
锚点：未记录
最近确认：cf8d14e36eab43d5b4c5b9ab1d1f27620f81d1bc
理由：最大风险：两栏 grid 中 ChangesOverviewCard（内部自带高度行为）在窄栏挤压下的布局回归——已跑概览 23 用例 + 卡片 19 用例全绿对冲。试过放弃：把 WorkspaceConfigCard 也收进右栏——放弃（ql-20260821-003 用户裁决全宽展示，不推翻既有用户决策）。会话门户左栏深改（3665 行条目重构）放弃——风险收益比差，已有 11px/brand 阶打底，留待专项。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-28-change-detail-header-overflow
锚点：未记录
最近确认：389282de4db4ae033db1905cd02834f70d14ba1b
理由：最大风险：PageHeader 被 41 个页面共用，min-w-0 理论上改变极端长内容页的既有视觉（原先溢出可见、现在可能截断）——但「溢出可见」本身就是缺陷态，且正常宽度内容不受影响；jsdom 单测锁定类名在场，Playwright 生产复测定格几何。 试过放弃的方案：仅在详情页 subtitle 外包一层 `overflow-hidden` 容器——放弃：治标（裁掉溢出但不恢复截断省略号语义），且不动组件会留下其余 40 个使用方的同型隐患。 另注：三断点纪律的①spec/②执行断点按会话自主模式跳过等待（用户为报障式请求、修复面两行 CSS、根因有生产实测锚定），③归档断点结果照常汇报。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-28-ci-failures-sweep
锚点：未记录
最近确认：e31d0e07bd259252cdced59554fba8de5bec566a
理由：最大风险：daemon 超时修复依赖「waitForSpawn 轮询 mock.calls」的既有 helper 语义，若未来 spawn 前路径再加真实 IO，waitForSpawn 本身仍稳（真实时间预算轮询）；但**同文件多轮 runLease** 的用例若忘传 minCalls 会复发第二轮丢事件——已在 helper docblock 写死该死锁链与用法。 放弃的方案：①给 applyClaudeSettings 打 mock 挡 unlink——放弃，撤下语义是有意产品行为，mock 会掩盖真实 IO 时序；②e2e 改用平台 admin 身份绕过菜单权限——放弃，N4 负向断言依赖非 admin 形态，且冒烟角色语义就是普通成员。 残留风险：e2e N2/N3 本机无 Docker 全栈未实证（e2e-ci 验证）；304eba982 冲掉 fed6e9e9a 的模式提示并行会话基于旧基线提交会回退他人已合入改动——本仓库已知协作形态，非本次可根治。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-28-drop-observation-card
锚点：未记录
最近确认：7e998a5c6bfd9fffb426588186c47e250ddf2bf5
理由：最大风险：观测事件卡的 warning 告警自动展开提醒能力随卡消失——可接受（主栏时间线卡事件轴同款 warn 色渲染 warning 行，信息不丢，只失去「自动展开」交互；如后续需要可给时间线卡加告警高亮）。放弃方案：保留两卡但观测卡收敛为仅 warning（用户裁决「直接不要了」，从简执行）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-28-knowledge-inbox-clear
锚点：未记录
最近确认：e723b484ed1475bdff0907cd3be3dfbf5bc8e4a1
理由：最大风险：INDEX 锚点手写错（GitHub 中文 slug 规则：标点删除、空格转连字符）致索引点击不可达——用 node 脚本按同规则自检 41 条锚点后跑 sillyspec knowledge validate 双保险。次风险：归类判断主观（个别条目跨类，如 Next.js 代理条目兼含 SSE 范式）——按条目主锚（主要教训）归类，正文整体迁移不拆条，不丢信息。放弃的方案：按条目拆分跨类内容到多个文件（破坏原条目完整性与可回溯性，放弃）；已修复条目删除（违背收件箱头注「已修复项保留并标注状态便于回溯」，放弃）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-28-quicklog-title-overflow
锚点：未记录
最近确认：e231b269b3b23711582a7b5e62f376be937624a6
理由：最大风险：fixed 布局下各定宽列（130/90/130/150/190/130）被严格执行，极窄视口下宽度不够的列内容改为溢出裁切而非撑宽表格——移动端另有独立页面（m/workspaces），本表仅桌面消费，风险面可控；jsdom 无法测表格布局，几何断言由部署后生产全单元格扫描承担（成功标准第 4 条）。 另注：三断点①②按会话自主模式跳过等待（用户报障式请求、根因有生产实测锚定、改动面三行），③归档结果照常汇报。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-28-remove-liveness-overview-card
锚点：未记录
最近确认：2f29e2693a12839bf3f71fb8684b5db57fc628b3
理由：最大风险：误删共享受害面——agent-liveness-overview-card.tsx 删除若连带删 lib 层（listWorkspaceAgentLogs / liveness-badge）会打断会话列表活性链路；已核对引用（grep 全仓）确认仅摘卡不动数据层。放弃的方案：①「无有效数据时隐藏卡片」——判定条件含糊（库里恰有一条 manual_test idle 测试行会让门失效），且链路未建立期间卡片等于死代码，不如删干净；日后链路修复可从 git 历史整卡恢复。②「修链路保功能」——需 daemon 指回本机后端 + 各 workspace local.yaml 下发 platform token + daemon 常驻，为一个总览卡付出整条运维链路成本，用户已裁决不值得。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-28-timeline-anchor-scope
锚点：未记录
最近确认：34d39ff7c1306f64976528484698bf7330463691
理由：最大风险：本变更 commit 事件的短哈希在全局 50 窗口外（远端落后、窗口截断）→ anchor_pairs 空 → 锚 None——无锚是诚实降级优于错锚；titles 同理降级。放弃方案：锚匹配直接读 events 不经 git 窗口（事件只有短哈希无 message，token 匹配必须有 message——保留经窗口取对的形态只收窄窗口）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-28-turn-nav-empty-hint
锚点：未记录
最近确认：efcfdb431ec658f274de81ca9028bbee247b6beb
理由：最大风险：无摘要轮与「确实坏了的大纲」混淆——用户看到「（无内容记录）」可能仍疑惑。对策：本变更实证了空摘要=空数据（非故障）；若后续群聊摘要兜底（group message 表取正文）立项，该占位自然消减。放弃的方案：后端跨表取群消息正文兜底——超出文案修正范围且需群聊数据链路验证，另立变更。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-28-turn-nav-hover-flyout
锚点：未记录
最近确认：37906d3396b9a0f21a7bed25d73ae609dd74ea2f
理由：最大风险：浮层覆盖聊天区可能遮挡阅读中的内容——对策：默认收起（仅 44px），悬停防抖 300ms 防掠过误触，移开 250ms 即收，非 pin 态点行选完即收；浮层带阴影+边框视觉区分，聊天区不被挤压（absolute 不改布局）。 放弃的方案：①并入右栏详情 tab——中栏最干净但跳转多一步且右栏已有详情/文件/子代理三态；②默认 120px 收窄常驻——仍占一列，没解决本质；③保留拖宽——浮层不占布局后拖宽失去意义，砍掉（宽度记忆键随之退役）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-28-unmapped-batch-redomain
锚点：未记录
最近确认：4dfba3a2ab2d4a78936d98ebb6fc734ce5af6236
理由：最大风险：粗域错置（name/text 级判定的变更可能有个别条目实际属另一端）——条目全文随迁、搜索按内容命中，错置代价是「在相邻模块也能搜到」而非丢失；判定依据全量留档可回溯可再迁。放弃的方案：①逐条 698 次语义判定——成本翻数倍、收益边际（粗桶清理已达成可查找目标）；②给 redomain 工具补 --by-change 参数后用工具迁——正确长期路径（已留档 docs/sillyspec 缺陷2）但等工具排期，本次数据清理不该被工具改进阻塞。 >

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-29-issue-row-grid-misalign
锚点：未记录
最近确认：790c594bf0570259215b5c18178c481f6f856a22
理由：最大风险：占位 div 占据首轨 auto 宽度——空 div 无内容宽≈0，轨道宽 0，视觉零位移；对带 leading 调用零影响。放弃方案：改 ISSUE_ROW_GRID 为三轨模板/条件模板——两套模板分叉后 header/row 对齐约束翻倍，占位是同文件既有先例的最小修复。 另注：三断点①②按会话自主模式跳过等待（用户已给 DOM 级证据、根因有 Playwright 复现锚定、改动一行），③归档结果照常汇报。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-29-jump-empty-turn-dup
锚点：未记录
最近确认：46e58f4b3a574fafdc1f01d3250f768b8a9654f1
理由：最大风险：把「日志在窗口外」误判为「零正文」导致内容永不加载——不会发生：判定基于本次 run_id 直达拉回的**全量** run 日志（该请求不受游标窗口限制），拉回有正文即照旧 prepend；仅拉回全空才标记。试过放弃的方案：①「turn 在 turnState 存在即视为已加载不再拉」——孤儿空壳（displayTurns 补建/翻页空壳）不在 turnState 或因陈旧闭包查不到，且壳轮的日志可能在已加载窗口之外、首点必须拉，存在性判定会弄丢首次加载机会；②「扩 loadedHasBody 判定条件」——治标不治本，陈旧闭包（deps 无 turnState）下二次点击依旧查不到首次 prepend 的轮。ref 标记不受闭包影响，是稳态判定。实证：stash 掉修复跑新用例红（expected 2 to be 1——二次点击重复直达），恢复后绿。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-30-assets-testfile-nodeid-anchor
锚点：未记录
最近确认：bac7255cc57ba16fe9efcb44032e435a0d4d508e
理由：最大风险：锚界符（::/#/>）误伤真实路径片段——若测试文件名本身含这些字符会被截短，但本仓测试文件命名无此形态，且截短后仍有 basename 同名搜索 + 唯一后缀救回兜底，最坏退化为多候选点选而非误报未找到。半角 ( 出现在合法文件名中（如 file(1).py），为降误伤面只剥全角（，半角不剥（本轮实证数据全部为全角）。试过放弃的方案：① 改 test-trace.json 存量数据剥锚——归档件是冻结审计件不可补（先例 2026-09-26 摘录保真坑同判）；② 收紧 CLI 书写约定禁止锚后粘注解——书写契约已由 binding-anchor-fidelity 落定且 CLI 侧已有单源剥锚，重定契约属设计反转，不采纳。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-30-breadcrumb-dedupe-zh
锚点：未记录
最近确认：6a3bdf9684653bcbe9eae4eaf3b66dd76448d2eb
理由：最大风险：中文命名与用户心智不一致（如 changes 译「变更中心」而页签叫「变更」）——以侧边栏 menuLabel 为第一权威、页签 label 为工作区语境补充，两侧本来就有「变更中心/变更」粒度差，面包屑取菜单级「变更中心」与被删页内面包屑文案一致。试过放弃的方案：把动态 id 段也替换为业务名（changeKey/task_key）——需要 TopBar 拉工作区数据引入请求依赖，超出本次「去重复+中文化」范围，放弃；id 段维持现状原样显示。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-30-change-file-cn-align
锚点：未记录
最近确认：d1e177421b7887da267d28e28f269b66169c6e6d
理由：最大风险：窄列（280px 文件树列 + 深层缩进）下中文名+原名同排可能溢出——已用外层 min-w-0+truncate、原名 shrink-0+truncate 双兜底（原名截断 hover 有 title 全路径）。放弃的方案：原名整体隐藏只显中文名——放弃：丢失「原名保留可对照」的 FR-03 语义。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-30-takeover-handoff-any-location
锚点：未记录
最近确认：d9131ca545a1a0a85c49180ecc938d532cf58ab6
理由：测试：后端 test_takeover_handoff.py 增 openclaw 422「不支持会话」断言（6 用例绿）；前端 session-panel-takeover.test.tsx 增白名单过滤用例（7 用例绿）+ tsc/lint/mypy 零错。回滚=revert 单 commit（纯过滤与文案，无 schema 面）。死路：无。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-30-takeover-tier3-ambiguous-msg
锚点：未记录
最近确认：a9c4c690dd8402bdb7387669a6d182a4c1af88ab
理由：风险：机器名含 runtime.name 为空时回退 id 短码（文案仍可诊断）。死路：无——三种失败态各有明确指引。回滚=revert 单 commit（纯文案+details 字段，无 schema/协议面）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-30-title-adopt-clobber-guard
锚点：未记录
最近确认：5da89fb8c48a2117e379b3d759cc72b19e1b33c4
理由：最大风险：兜底判定把「裸模板 H1 文本」也算兜底——若作者刻意把自定义标题写成恰命中 TEMPLATE_H1_RE 的纯类型词文案（如就叫「提案书」），其标题会被收养/重派生刷新掉。该口径与 normalize_display_title 既有判定同源，非新标准；真实碰撞面可忽略。放弃的方案：a) Change 加 title_source 标记列区分收养/派生来源——需 schema 变更且两文档路径都要改判定，收益不抵复杂度；b) 只守 documents 路径不守 reparse——审查实证 _apply_parsed 同样无条件覆盖，漏守即缺陷残留（test_apply_parsed_fallback_keeps_semantic_title 先红实证）。遗留（超出本变更）：documents H1 派生值超 500 字在 Postgres 仍会 DataError（documents 路径有 broad except 降级告警；reparse 路径会使该次扫描失败——预存行为，触发需 500+ 字 H1 的病态输入）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-30-vitest-passwithnotests-rollback
锚点：未记录
最近确认：557497bae50851b1723c49d0f973a0a06f6dc744
理由：最大风险：若 sillyspec 修复未生效（CLI 未链接源码）而撤掉兜底会复现假红——已核实 npm ls -g sillyspec 指向 C:/Users/qinyi/IdeaProjects/sillyspec（npm link），且撤除前用原始失败面在修复后源码上复跑门禁函数确认全绿，风险已消除。试过放弃的方案：保留 passWithNoTests 作为双保险——放弃理由：它会掩盖未来真正错误的空收集（如过滤条件写错时 CI 静默通过），兜底价值低于语义保真。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-01-review-followup-reset-guard-machineid
锚点：未记录
最近确认：9f38792b6b354fb02d4e6b43d23726a68b1056e1
理由：最大风险：machine-id 收紧「非 uuid 形即覆写」可能误伤手工预置的非标准身份串（如有人手写短码）——但协议文档明约「纯文本 uuid（36 字符）」，非 uuid 形本就是损坏态，误伤面为零。试过但放弃：temp+rename 真·原子替换——两个并发写者各自 rename 仍是 last-write-wins，不解决本问题主矛盾（并发双生成漂移），反而多一次跨平台 rename 语义差异（Windows 目标被占用 EPERM）面；wx 独占创建 + 回读胜者用更小的面收敛同一目标。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-02-title-norm-thin-h1-family
锚点：未记录
最近确认：c854d89601d8529ac2d1e883f41972b287a89a27
理由：最大风险：误伤面——若某作者自定义标题恰为「设计记录」「任务注册表」等裸类型词（无冒号/无后续内容），会被当模板回退语义名。该风险与既有词表条目（「设计」「任务」等更短的词）同级且更小（新词更长更具体），既有测试锚定冒号自定义标题保留不受影响。遗留：已归档变更不再有 documents 推送，其存量污染 title 行不会自动刷新（新变更与活跃变更自愈）；如需清洗可后续做一次性 reparse/修数，不在本变更范围。放弃的方案：在 documents 推送侧按文件名（tasks.md/design.md）硬判模板而不看 H1 内容——放弃理由：会废掉「自定义 H1 覆盖收养标题」的改名通道（tasks.md 写自定义 H1 是合法改名路径，有既有测试锚定）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-03-local-usage-caliber-fix
锚点：未记录
最近确认：9bfb14f024d206b065210d3c1c34a4c8ce4e7305
理由：最大风险：口径切换期新旧快照并存（存量未重摄的旧口径行 input 偏大、命中率偏低）——活跃变更下次上报自动收敛，死日志不重算可接受（展示偏高不丢数）。放弃的方案：展示层按数据源分公式（本地 CLI 用 cache_read/input、平台用现行公式）——两口径数字混一张表仍费解、公式分叉扩散到三处组件；落库归一一处收敛全部下游，且与平台列语义同构。次要风险：invocations 与 api_requests 语义近似（CLI 留底计数 vs API 调用）非严格同义，注脚已声明。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-03-usage-backfill-script
锚点：未记录
最近确认：373239040c2899e288f1f904584ad692584aa2c7
理由：最大风险：daemon 离线导致大面积跳过（回填不完整）——设计为可重跑补齐，且每条独立降级不影响其他；历史日志文件已被用户清理的条目 RPC not_found 跳过（诚实缺数）。放弃的方案：写进 alembic 迁移自动跑——链内破坏性/外部依赖（RPC）不可入迁移（reset 脚本先例同裁决）；逐条即时 commit——无必要（幂等覆盖写无中间态语义）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-03-usage-ingest-session-concurrency
锚点：未记录
最近确认：bf325fda515865d118734dc1bfa6fa47233bd067
理由：最大风险：串行定位段拉长任务总时长——上限 50 entry × 每次 3-4 个本地查询， 毫秒级/条，远小于 RPC 段本身（30s 预算/条），可忽略；若 daemon 全离线， 定位仍逐条走完（每条查询+404 抛出），属既有降级路径的既有代价。 放弃方案：① 任务内自开 session（identity map 跨 session 改写复杂，见槽1）； ② 定位整体改为候选筛选时一次性批量 JOIN 查询——需改动 router 共享函数 `_resolve_agent_log_read_target`，牵连 content/messages 两端点，超出本缺陷 修复范围。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-04-knowledge-touch-plain-title
锚点：未记录
最近确认：a8d3ad5b8d85a1f303de3d358cfb010d938c7f13
理由：最大风险：文案改写后与知识库 FR 条目语义漂移（FR-auto-frontend-093 引用旧标签）——已同步最小修正该条目并 validate 通过规避。试过但放弃：①把两态口径差异做成可见副标题——放弃，机制细节对普通用户是噪音，用户诉求就是"说人话"；②顺带改写空态引导文案——放弃，超范围（其行为未变，FR 语义仍准确）；③起全栈环境渲染实页截图——放弃，纯字符串替换无布局/样式变化，组件测试断言即证据面（先例 2026-09-27-assets-testfile-bracket-note 同口径）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-04-takeover-tier3-agent-cwd-fallback
锚点：未记录
最近确认：38dac6640ba5963b70f788745959497d6b97c050
理由：最大风险：回退扩大 tier3 命中面后，若两台在线机器白名单都覆盖该 agent_cwd，会从「409 无匹配」变成「409 歧义（列候选机器名）」——不静默换机的红线不变，只是拒因更准；真歧义时用户按文案清理白名单即可。试过放弃的方案：建桶/刷新时把 agent_cwd 回写会话行 cwd——只对未来上报生效，存量会话（如线上 7ea5177a，已不会再被旧 CLI 重推）救不了，且给 ingest 增加一条写路径；协议 §4 的口径本就是 entry 级匹配，故弃。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-05-remove-promo-film
锚点：未记录
最近确认：5eb9b1dd74e57562ae64dee99adcbca21e1844d8
理由：最大风险是误删仍需要的文件——已核对 docs/promo 全部 31 个文件均由本会话生成（v1 变更与 v2 变更的交付物，无第三方内容），且 git 历史可完整恢复（git revert 6b6c18fc9）。放弃的方案：只删 v2 保留 v1——用户语义「生成的我不需要」覆盖两版，全删。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-06-opencode-settings-config-poison
锚点：未记录
最近确认：18205e82742eba62c020a512efc29e2df21fc718
理由：最大风险：清 NULL 后丢失的 enabledPlugins/skipDangerousModePermissionPrompt/model=fable 等键原本是否被用户依赖——判定不依赖：这些键来自 openai_chat 时代/导入残留，与 anthropic 直连链路冲突且正是本次故障根因，属毒数据（若用户后续要插件开关，前端表单可重配）。放弃的方案：①保留 settings_config 仅删 env 子键——保留的 model=fable 仍会改 claude settings.json 行为且其余键语义未审计，不如整清干净；②代码层加「settings_config.env 含 ANTHROPIC_BASE_URL 时告警」防护——属产品设计面（规则 7 的优先级是有意设计），超出本事故修复范围，坑文档留教训即可。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-07-assets-patch-scope-audit-fallback
锚点：未记录
最近确认：ce08f8ae7194bd05be50f99933721dba33023d29
理由：最大风险：file_list 语义按通道不同——change-patch.json 的 files 数组含 .sillyspec/ 规格工件，scope-audit.json 的 rows 只含对账表行。展示口径随之不同（各自的真实冻结 面），可接受；未来若要求统一需 CLI 侧统一留痕（第 3 层根治）。试过但放弃：在 assets 层实时重算 git diff 补数——引入实时窗口漂移，违背「归档留档冻结在收尾时点」 的既有语义。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-07-ci-failures-sweep
锚点：未记录
最近确认：4a538caa395a449c33567c50bf18c219b65a4466
理由：最大风险：test_files_router 若未来 fixture 只剩归档 change，next(... location=="active") 会 StopIteration——但两活跃 change 是 fixture 固定资产，风险极低。试过放弃：为 FR-04 新增 takeover 端点归档 409 端到端用例——放弃，takeover 前置校验链（原机四级钉定/provider 行解析）夹具过重，且其写入口经 create 链已被 test_session_create_on_archived_returns_409 的 ensure_writable 守卫用例覆盖，加重复用例只增脆弱面。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-07-ci-sweep-focus-visible-flake
锚点：未记录
最近确认：1cfe595a0aff8295da85267a43a4b3738a775b6e
理由：最大风险：文件内某用例未来若断言计算样式（如尺寸/颜色）会拿到空值——当前 19 用例均只断言行为与 DOM 结构，无此面；注释已声明约束。放弃方案：vitest 全局 retry 掩盖——放弃，会掩盖全仓真实回归；只 retry 本用例——放弃，治标不治本且每次重跑仍烧 CI 时间，stub 一次根治。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-07-ci-sweep-jsonl-mock
锚点：未记录
最近确认：768a88a694fddfb36095ef1ec42e795e77a6e582
理由：最大风险：桶文件未来再加导出时本 mock 再度漏补（结构性重复成本）——已有注释约定承担提示职责，暂不引入 importOriginal 部分 mock（会放弃「断言降级目标桩」的精确控制，且与既有 10 桩风格不一致）。放弃方案：改用 vi.mock(importOriginal) 展开真实导出——放弃，枚举桩正是该套件断言 DS 降级路径的手段，混入真实组件会引入无关渲染依赖。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-07-hide-quicklog-tab
锚点：未记录
最近确认：e62d98bcb7bddf9bc5c3313df3c47ee8ab04ab7d
理由：最大风险是既有测试对「点击 tab 进入」路径的依赖（桌面 2 个用例、移动端 12 处点击 + 2 处断言）——逐一改为 `?tab=quicklog` URL 初始化进入，并为隐藏补缺席断言。放弃的方案：a) 彻底删除 quicklog 视图与后端接口（存量历史数据失去唯一入口、牵动面数倍于收益）；b) CSS/条件 className 隐藏 tab 按钮（留下永假分支死代码，违反仓库一致性规则）。两者均未采用。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-08-backend-image-slim-no-claude
锚点：未记录
最近确认：55ea8ab01ec9a279e1210a8b4423eec60a50a642
理由：最大风险：证据面有盲区——若存在 grep 未覆盖的运行时 claude/node 依赖（如未来新代码 spawn），容器将直接 FileNotFoundError。缓解：唯二 exec 点已逐行核实为 git；diff_collector 的 FileNotFoundError 分支本就按零 diff 降级不炸；变更后本地重建全链路验证 + 服务器部署后复验。放弃方案：①保留 node 只删 claude——放弃理由：node+npm+node_modules 占大头（claude 二进制本身不大，大头是其 node_modules），半删收益减半且留「半个遗物」心智负担；②只注释不删除（防御性保留）——放弃理由：镜像层一旦保留就会被后人当成可用能力写代码，遗物越藏越深；③compose 保留 claude-data 挂载以防万一——放弃理由：卷挂载会遮盖 /app/.claude 目录语义，与「容器内无 claude」的新事实矛盾。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-08-backend-node22-for-sillyspec332
锚点：未记录
最近确认：f7eeb237e90fa48bd4da92409503176dd6ef99a4
理由：最大风险：node:22-slim 与既有层交互（如 npm 路径结构变化致 ln -sf 失效）——node 官方镜像 npm-cli.js 路径多年稳定，构建本身即验证（失败即暴露，本次实跑通过）。放弃方案：①回退 SILLYSPEC_VERSION pin 到 3.29.x（Node 20 可跑）——放弃理由：技能包已 3.32.0，CLI 落后会再次制造本次要修的「指引与技能不配套」，且 node:sqlite 是 DB 引擎长期依赖，绕不过；②容器内热修 npm install（不进镜像）——放弃理由：容器重建即丢，违反镜像即真相。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-08-backend-skills-follow-cli
锚点：未记录
最近确认：c1970cd37f0338f3a3b122bf3638e649e515f18f
理由：最大风险：sillyspec 未来版本改包内目录布局（`.claude/skills` 移位）→ COPY 构建期失败（fail-closed 可见，非运行期暗病）；其次 npm latest 引入破坏性变更直进生产（无 pin 缓冲）——缓解：build-and-save.sh 回显版本留痕、backup tag + .env pin 双回滚口，且 sillyspec 是用户自研工具、发布节奏自控。放弃方案：①保留仓库快照源 + 定期 init 刷新——放弃理由：自动化仍靠人记着做，正是本次要消灭的错位根源；②容器启动时 runtime npm install 拉最新——放弃理由：启动时延+网络依赖+镜像内容不确定（同 tag 不同行为），破坏回滚语义；③CI 定时重建——放弃理由：当前无 CI 部署链，超出本变更面。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-08-ci-sweep-2-migration-anchor
锚点：未记录
最近确认：efb85fc566889705e304026f05380aacc58d77b2
理由：最大风险：并行会话持续加迁移导致锚反复红——结构性成本已由约定承担（每次新迁移随动一行），改用「断言单 head + 链尾 ≥ 某版本」弱断言会失去精确锚定防分叉价值，放弃。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-08-ci-sweep-2
锚点：未记录
最近确认：97c6598b93fd8f805dda5ab1c3f94386881a116b
理由：最大风险：正则锚未来再随 schema 形态演化漂移——防哑绿抛错语义保留（失配即响亮失败），漂移会被即时暴露而非静默通过。放弃方案：回退四处生产变更让测试通过——放弃，均有变更档案/评审留痕的有意行为，回退等于推翻已验收功能；改用运行时 import 跨语言读词表——放弃，TS 无法 import Python 源，源文件读取式解析即先例形态。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-08-deploy-script-version-echo-msys
锚点：未记录
最近确认：45240ef8baaa17b5f1cb4c03bc262ee0a4244a9e
理由：风险极低（一行 shell）；放弃方案：MSYS_NO_PATHCONV=1 前缀——放弃理由：需按平台条件设置，比 sh -c 包裹更绕且仅 Git Bash 语义。

## D-001@v1 风险与死路（design 槽4 收割）
变更：2026-10-08-gov-action-stderr-noise
锚点：未记录
最近确认：15b0d73d3336119481d4daff23c92785176bd0cc
理由：最大风险：正则误伤真实错误行。缓解——只匹配行首严格形态 `^\(node:\d+\) \w+Warning` 与 ``^\(Use `node --trace-warnings``（实测 CLI 噪声逐字）， 真实 CLI 报错文案不以这两种形态开头。放弃的方案：给子进程注入 `NODE_OPTIONS=--no-warnings`——会静默压制 CLI 所有告警（含未来可能有价值的）， 且改的 spawn 环境面大于必要面；前端展示头 160 字符代替尾 160——CLI 结果摘要（含 条目 ID 清单）在输出尾部，取头会丢信息。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-08-shared-assertion-surfaces
锚点：未记录
最近确认：e7787cadba68c5b51b50c7aaf6c461a4caac849c
理由：最大风险：清单自身腐化（新增共享断言面不登记、钉子测试移动不更新条目）——缓解：条目末尾写明「新面按同款登记」的口径，且知识条目进 distill 链可被后续 knowledge 命令校验。放弃方案：CI 内自动扫描钉子断言生成清单（AST/grep 解析 toHaveLength/toEqual 钉子反查契约）——跨语言三端解析成本高且误报难消，先人工登记验证命中价值再谈自动化。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-08-sync-sillyspec-skills-3320
锚点：未记录
最近确认：e3a4222dcee84c1281d5e7414b11b1908724cf69
理由：最大风险：`sillyspec init` 附带刷新命令卡/指引等非技能面（v3.29.3→3.32.0 间的教学面变化），diff 面比预期大——处置：跑完后逐文件审 `git status`/`git diff`，实际改动面为「技能 + AGENTS.md 版本行 + 命令卡 + .gitignore 行尾抖动（已还原）」，无意外面。放弃方案：手写脚本只拷技能目录——放弃理由：绕开 CLI 幂等注入逻辑，AGENTS.md 版本段与命令卡仍会落后，且失去历史惯例的一致性；docker 镜像内直接改——放弃理由：镜像重建即丢，仓库才是唯一源。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-09-close-trace-single-set-platform
锚点：未记录
最近确认：2f6d525155a2b7cd8ec208e77f0f83e5f9a43967
理由：最大风险：CLI 新形态落盘字段与前端特征判定脱节（如 files 非数组）——已知防御：特征判定失败回落 JsonView 折叠树（既有机制），不白屏。放弃方案：改后端 assets.py 读 scopeAudit 子对象做投影——顶级字段（files/totals/patchStatus/savedAt）已含卡面全部所需，子对象仅前端预览增值面，动后端是无效改动面。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-09-graph-query-ux
锚点：未记录
最近确认：0c2a8bd2264230f90dbcfc4199d33c88a325750b
理由：最大风险：自动切 tab 抢走结果面焦点（实测即翻车——path 预置用例被详情 tab 抢走 reason 文案）。已收口为仅 neighbors 切详情。放弃的方案：①所有带锚点 sub 都切详情——否，impact 闭包/path 推理链的价值在结果面；②antd Select 弹层内做富 tooltip——否，原生 title 在弹层滚动环境不稳，动态说明行同信息更可靠。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-09-knowledge-touch-marker-sunset
锚点：未记录
最近确认：54e72b580d5108fd12c60fad18c2c31ca0d51535
理由：最大风险：归档态语义预期错位——用户若期待「归档后收窄为权威面」，本变更是明示不收窄（文案诚实化对冲：口径写清是注入命中留痕）。放弃的方案：① 恢复 CLI 待复核标记落盘（2026-09-29 已实证否决，反向开倒车）；② 平台按域收窄 live 数据面（改的是数据口径，会连带影响 knowledge-stats 运营指标消费，超出本变更范围且无消费者支撑）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-10-change-patch-cross-repo-view
锚点：未记录
最近确认：1f4ea92e5df86e3be6149b1f19d5fa046a8ee1ff
理由：最大风险：patch 正文内联使 change-patch.json 体积增大（跨仓多文件大 diff），预览链若对 JSON 全量 parse 可能耗内存——但 DiffView 已有 2000 行增量渲染兜底 DOM 面，且折叠默认收起，渲染成本可控；JSON.parse 本身是预览链既有成本，非本变更引入。 试过但放弃的方案：① 在变更中心 scope-audit 实时查询链（command-card）加 patch 面——该链是实时对账（快照说当下），无冻结正文书，且要动 daemon 投影白名单（repoPath 剥离逻辑），面大不做；冻结正文归属 change-patch.json 读侧。② patch 正文落独立文件族（change-patch-cross-repo/<key>.patch）——违背 2026-10-09-close-trace-single-set 单套两件纪律，producer 侧设计已显式否决（D-001@v1），平台侧不翻案。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-10-daemon-tombstone-change-guard
锚点：未记录
最近确认：c6a7c34f424a3f3f6cbccb25dafbc6c2cce00c85
理由：最大风险：白名单过严误伤合法 change 名（如未来出现含中文/空格的目录名）——现网 change_key 全部为 `YYYY-MM-DD-<slug>` 形态（目录名派生），正则与 backend 手动端点已长期同款，收紧面两端一致，误伤面为零增量。试过但放弃：在执行器 `_requireCommandPrecondition` 内加校验——该方法被 resolve/ghost_cleanup/tombstone_cleanup 三路共用，resolve 路径 change 经 CLI 数组形参已有 assertSafeChangeName，重复校验混淆守卫分工；且消息入口层一层拦截覆盖所有下发路径，更完整。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-10-dump-gzip-thread-offload
锚点：未记录
最近确认：c2dea0074b6fc874e20bd6a894d932dd25842239
理由：最大风险：to_thread 默认线程池在高并发 dump 风暴下排队——但 dump 为低频全图总览请求且单次百 ms 级，默认池容量充足；极端排队仅表现为该请求变慢，不阻塞事件循环（恰是本变更要保住的底线）。试过但放弃：①降 compresslevel 到 6（放弃理由：只缩短不消除阻塞，且改变输出字节引入对比噪声）；②ResponseStreaming 分块压缩（放弃理由：信封需整体 JSON 化后压缩才能保证 gzip 原子性与既有测试的字节级断言，流式改造收益不抵复杂度）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-10-duration-api-cumulative-fix
锚点：未记录
最近确认：303963b6019cd66b1865cd655f3f1e5e8ab4b86b
理由：答：最大风险是各 CLI 构建的 duration_api_ms 语义不一（真 Anthropic 可能为 per-query 纯 API 时长）——差分逻辑对「真 per-query」值也正确（第二轮起 snapshot≥base 时差值=snapshot−base 会把 per-query 值误差分！）。缓解：差分仅在 snapshot ≥ base 时做，per-query 形态下 snapshot 无单调性（12s→9s 走复位分支报 全量）→ 不会误差分；单调递增的 per-query 序列理论上会被误差分，但 DB 实证本 部署形态是累计量，真 per-query 序列含工具等待通常非单调——留档该假设。 放弃方案：仅做 backend 守卫不做 daemon 差分（守卫后合法累计增量被整段拒收， 正确数据也进不来）；仅做 daemon 差分不做 backend 守卫（防线单薄，其他引擎再犯 无兜底）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-10-recheck-lease-freshness
锚点：未记录
最近确认：f1d975bf97dcd3bbb12c85e510dae5617809c797
理由：最大风险：daemon 续约线程被长任务饿死超 10 分钟（宽限窗）导致健康 run 被误判死——缓解：lease 心跳在 daemon 独立定时器（task-runner 5s 间隔，与任务执行线程解耦）+ FR-02 回正兜底；极端饥饿 10 分钟本身已属病态，判死后回正比永卡合理。边界取舍：`last_heartbeat_at is None` 分支保持保守 True 不引入 lease 核验（从未心跳的实例语义模糊，patrol 同款跳过，不扩大本变更判死面）。试过但放弃：豁免轮数上限（dict 簿记 tracked→轮数）——放弃理由：按时间盲猜，对合法等用户应答的长静默轮有误杀面且需改 _recheck_deferred_runs 签名与全部既有用例；lease 续约是直接证据且零簿记。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-10-task-wakeup-quiet-threshold
锚点：未记录
最近确认：9852d96f58056927f03e7497ec1a609c7b75eed3
理由：<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-10-task-wakeup-quiet-threshold 留痕重锚 --> <!-- MACHINE-DRAFT:design-risks:end --> 最大风险：60 秒门槛把「中等时长但有汇报价值」的后台任务（如 30-50s 的检查类任务）也 静默了。接受理由：主代理仍可 TaskOutput 主动取结果，终态行/emit 都在，信息不丢，只是 不再强迫打断；常量单点可调，后续按体验收紧/放宽是一行改动。次要风险：既有唤醒用例 夹具 20-21s 低于新门槛，需同步上调（行为规格变更的正常适配，已在 FR-03 声明，非躲败）。 试过但放弃的方案：①按 subagent_type/depth 判孙任务不冒泡——SDK task 事件 metadata 无层级信号（孙任务与主代理亲派任务同形），只能靠 `_agentToolUseMeta` 猜测， 误判面大，放弃（转 FR-04 留待 spike）；②把 debounce 2s 拉长到 15s+——只合并同时窗 口内的风暴，实证通知间隔 15-100s，合并不到一起，治标不治本；③前端把排队栏系统通知 折叠展示——不动噪音源头，纯遮羞，且门槛落地后队列里几乎不会再出现通知，收益消失。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-10-turn-speed-enrich-backfill-test
锚点：未记录
最近确认：196c2280aeaf47428b5197da25e21c9224a890fc
理由：答：最大风险是 fixture 与 SessionTurnView/SessionRunRead 真实形状漂移（手工 构造遗漏必填字段编译报错，tsc 兜底）。放弃的方案：塞进 session-panel-history-race 集成测试（组件级成本高、断言间接）——纯函数直测更聚焦（评审建议即此）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-10-usage-note-to-daemon-log
锚点：未记录
最近确认：fe99e67d4c7df4c6d1dc64fdb4b3612940c832fe
理由：最大风险：排障入口从"用户可见的会话行"变为"daemon 日志事件"，运维需知道去日志找 `run_cost_may_include_bg_tasks`——通过模块文档 `daemon.md` 同步与本记录留痕缓解。试过放弃的方案：a) 阈值版"只在用量差分明显异常时报"——无真值基准，阈值任意、误报/漏报两头错（见做法概述）；b) 彻底删除不留任何痕迹——丢失原始 FR-04 排障意图（$24.10 归属误导类问题将无现场线索）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-10-ws-init-dialog-close-guard
锚点：未记录
最近确认：52b3f8031ded82c900b45dbc9ae87d89626453f9
理由：最大风险：deadline 顺延一拍（2s）在高频切页场景产生最长 2s 的判死延迟——相对 5min 超时窗可忽略，且换来的是后台零假失败。另一个取舍：回前台后重挂满窗而非续接剩余时长，最坏情况前台多等 5min——初始化轮询通常先于超时命中 init_synced_at，实际影响罕见。试过但放弃：onCancel 内按 phase 拦截（放弃理由：ESC/遮罩事件仍会触发 antd 内部状态翻转，且 X 按钮仍渲染给用户可点击的假出口，交互层禁用更干净）；deadline 用 visibilitychange 事件重算剩余时长（放弃理由：需要额外事件监听器与剩余时长簿记，复杂度超过 2s 顺延的收益）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-11-alembic-single-head-guard
锚点：未记录
最近确认：e81fef9f12b4d99f7bfa71cb3354adfb2e40f5fb
理由：最大风险：部署者绕过 build-and-save.sh 手工 `docker build`（两闸全绕）——接受：技能文档固定走脚本，纯手工路径属明知故犯；CI 闸仍覆盖 PR 流。 已弃方案： ① 只加 CI 闸——直推 main/本地部署不经 PR 时拦不住（本变更正是本地打包部署场景翻的车），弃单闸改双闸。 ② 预检 shell out 跑 pytest 复用测试——部署机未必有 pytest 环境，且脚本内嵌 python -m alembic 依赖更轻，弃。 ③ 后端启动时（容器 entrypoint）容错多头——掩盖问题不如 fail-fast，且容器已 crash-loop 即等价红灯，无增益。 无声明边界以外的取舍。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-11-apikey-mcp-copy-delete
锚点：未记录
最近确认：fffc17f482902ef9655bf2f848d94807658e7f90
理由：最大风险：**可逆存储是安全降级**——DB 全量泄露 + KEK 同时泄露时凭据直接暴露（原 bcrypt 方案下不可能）。接受理由：内部平台、用户明确要求列表可复制；缓解措施是密文落库（DB 备份/ 日志拖库单独不构成泄露）+ KEK 走环境变量与 DB 分离，与 mcp_webhooks.secret 既有风险面 持平。 试过放弃的方案：(a) 明文直接入库——放弃，密文列成本极低而拖库面显著恶化；(b) 每次「复制」 都新建 key（保持 hash-only 模型）——放弃，key 会随复制次数无限堆积，且「列表复制已生成 凭据」的需求语义不符；(c) 单独 `POST .../purge` 端点——放弃，`?hard=true` 查询参数复用 既有 DELETE 路由与权限门，改动面更小。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-11-snapshot-timeout-distinct
锚点：未记录
最近确认：d2c1b83a609869a3b817dc087520d1df691095bf
理由：<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-11-snapshot-timeout-distinct 留痕重锚 --> <!-- MACHINE-DRAFT:design-risks:end --> 最大风险：timeout 语义不止「进程未重启」一种（daemon 忙碌/网络劣化也超时）——文案用「若刚更新过请重启」条件句而非断言根因。放弃的方案：①daemon 自更新后自动重启进程——会中断活跃会话，留独立变更评估；②超时归入 unsupported——语义错误（unsupported=版本不支持，timeout=无响应），会把「忙」误报成「需升级」。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-11-sync-conflict-tri-fix
锚点：未记录
最近确认：0c821b2ec492f134411d4ab2429e8b7f1da438b0
理由：最大风险：daemon 持续真冲突下推送量放大 2×（每次同步 conflict→re-base→再 conflict）——有界一次，可接受；换来「他端先推」型冲突的全自动闭环。 已弃方案： ① daemon 拉 `GET /changes/-/spec-manifest` 做全量 re-base——该端点收紧为 shpsync_ token（CLI 通道）专用，daemon 的 shk_live_ 403；改鉴权面过大，弃（冲突响应自带 server_versions，足够定点 re-base）。 ② 冲突即回退全量 tar——违反既有设计 NFR-02「不静默覆盖」，弃。 ③ re-base 结果在失败路径落盘——磁盘缓存 hash/mtime 与 mtime 快路径耦合，部分回写易不一致，改为仅成功路径全量回写。 ④ re-base 后空 ops 特判分支（review 评审时发现为不可达死代码：op 生成条件与 version 无关，重算 ops 恒与首推同集）——删除，同内容豁免由服务端 apply_ops 承担。 评审后加固（review findings 处置，2026-10-11）： - P2「重试传输失败落 tar 回退」：已修——重试轮传输类失败转抛 SpecPushConflict（首推冲突面），不落 tar、不写 pending_push（spec-sync-incremental 新用例锁定）。 - P2「非 changes/ 路径归因失败」：**声明边界（可接受）**——注册表版本冲突面全为 docs/、quicklog/ 等非变更路径时（整树同步对象冲突，当前生产无实证案例）前端归因不出变更名不渲染行，横幅仍可见；裁决入口待后续按「路径域」扩展 compare 语义再开，留 knowledge 信号。 - P3「空 ops 分支无关闭时机」：随④删除死代码消解。 - P3「change.patch 冻结件混入并行变更 linked-repo-workspace-ref 的模块文档 diff」：冻结配方=baseline→工作区全量 diff，并行在途变更无法剔除——已知噪音，归档读者以 commit 链（1e8a4a275/c83531fe1/e0b1ce16+评审加固提交）为准。 遗留（记录不修）：经 daemon 通道撞出的冲突，机器 CLI 侧无 sync-conflict 文件，前端裁决指令在机器上可能回执「当前无 sync-conflict 文件」——缺口 2 上线后此类行基本自愈，残余真分叉以对比弹窗两侧内容为准人工处置。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-12-backup-sweep-name-ts
锚点：未记录
最近确认：1f4f6562f1b0ff62c3f34d89542488042d8e6396
理由：- 风险：机器时钟回拨后创建的备份名 ts 大于「现在」，两信号均不老 → 备份保留至时钟追平——与 mtime 语义下时钟回拨的行为一致（既有同款边界），且方向是保守保留，可接受。 - 放弃方案 A：utimes 失败时改同步重试/换 fstat——盖戳失败的根因（属主/文件系统 EPERM）重试同样失败，fstat 取不到创建时刻（跨平台不可移植）；名字内嵌 ts 是创建时刻唯一可靠的跨平台载体。 - 放弃方案 B：清扫改为「7 天内以名 ts、之外以 mtime」的切换语义——比 max 更复杂且无额外收益；max 即「双确认才删」，语义最简最保守。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-12-borrow-ctx-truncate-rest
锚点：未记录
最近确认：1cb57618a2cc9c6535c086946005b29ca8938cf0
理由：- 风险：换行/反引号等合法路径字符经 500 截断后仍可能在正文内换行呈现——截断只限长不限形（与 408bc0889 同款边界），收尾免责行+写守卫 enforcement（D-003 红线：写隔离唯一权威是 SessionManager 写守卫）兜底；彻底转义会破坏合法路径显示（POSIX 允许换行/反引号），得不偿失。 - 放弃方案 A：对字段值做 markdown 转义/去反引号——破坏合法路径与名称显示，且转义规则本身成为新注入面；截断+免责行是既有单一范式。 - 放弃方案 B：把 type/default_branch 一并截断——两字段为 backend 受约束枚举/短标识，无自由文本注入面，纳入只会稀释「自由文本长字段」防线的语义。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-12-ci-guard-diagnosability
锚点：未记录
最近确认：775cb3de8104fb40bd864ed6b1bc223e50d7e749
理由：- 风险：`|| true` 把「grep 自身异常退出」与「计数 0」混为一谈——grep 非 0 非正常退出仅有内存/参数错误等病态场景，且计数变量此时为空串 → `[-ne 1]` 整数比较报语法错退出（仍是 fail-closed 有输出），不劣化于现状。 - 放弃方案 A：改用 `grep -c ... | wc -l` 或 awk 计数——多一层管道语义更绕；`|| true` 是 set -e 下容忍「0 计数即非零退出」的标准习语，一行最小改动。 - 放弃方案 B：迁移测试改 shell out `python -m alembic heads` 并断言输出——docstring 明言「走 alembic API 不 shell out（CI/本地环境无差异）」，改 shell 反而引入环境差异；set_main_option 是 alembic API 的正规覆盖通道。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-12-daemon-path-guard-completion
锚点：未记录
最近确认：bb36a60bb75a4bf650a7069cf62e94d595da4c44
理由：- 最大风险：存量部署 allowed_roots 未包含工作区根 → linked_repos 同步被 forbidden 拒止——loadConfig 默认 allowed_roots=[homedir()]，宿主项目根通常在家目录之下；且 get_spec_bundle 对同一类值已用同款守卫跑了数月，真实环境已隐式要求「workspace root 在 allowed_roots 内」，不引入新的部署约束。 - 放弃方案 A：把 allowed_roots 校验下沉进 linked-repos-sync.ts 纯函数——纯函数无法访问 daemon 实例的 _effectiveAllowedRoots（需注入 roots 参数，改签名波及既有 25 用例）；入口（daemon.ts handler）是 allowed_roots 的天然作用域，与 get_spec_bundle 同层。 - 放弃方案 B：spec-sync 相对形态改为 warn+按 cwd 解析继续——静默写错误位置正是要堵的缺陷，warn 不可接受；fail-loud 让 backend 侧 502/失败结果可见，登记数据质量问题立即暴露。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-12-duration-backfill-harness-align
锚点：未记录
最近确认：a339d492bcea7f038e3715617f6004967c8f3368
理由：答：最大风险——旧 daemon（未部署实时计时）+ 新 backend 下，close 回填的值仍 可能是会话累计垃圾（daemon 差分修复 27695397c 未部署时），过渡期老轮显示仍 失真。缓解：部署时 backend 与 daemon 同批换镜像（deploy-to-server 单包交付）， 过渡窗口仅存在于分步部署场景。放弃方案：①保留墙钟守卫（拒真实并行子代理值， 用户正确否决）；②close 完全不写 duration_api_ms（无实时计时的引擎/旧 daemon 彻底没速度，回填好于空白——值语义在 daemon 差分部署后为正确增量）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-12-duration-nan-guard
锚点：未记录
最近确认：eba4ab5904d2f969b479704e0062bcbbfacb20ad
理由：- 风险：极低——SDK 实际报 NaN/Infinity 概率极低（审查原判「触发概率极低，仅口径不对称」），门控只在异常输入时改变行为。 - 放弃方案 A：非有限值记 warn 日志——审查明示「零新日志面」，且低概率事件打日志徒增噪音；跳过即静默对齐「SDK 未报」既有语义。 - 放弃方案 B：payload 显式置 null 上报——backend `int|None` 收 null 等价于不报，但会把「未报」与「报了非法值」两种形态混为一谈；直接不携带键更干净。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-12-init-permission-relax
锚点：未记录
最近确认：4c27f731d5dec5a89ad1d7e3bc9503808c73a424
理由：最大风险：viewer（访客）也获得 init 权限。独立评审（review.json P2， 2026-10-12）修正本节初稿的两处不准确表述，以下为补正后口径： - 初稿称"访客通常无 daemon 绑定，实际停在 409"——不准确：访客可以 自建绑定，`PUT /my-binding` 权限门同为 WORKSPACE_READ （member_runtimes/router.py:121），"通常无绑定"只是运营假设，不是防线。 - 初稿称"init 不产生服务端提权"——不准确：init lease claim 是 `shpsync_` sync token 的全仓唯一签发点（daemon/lease/context.py:856）， 持 token 可经 `POST /changes/-/spec-sync` 由 `SpecWorkspaceService.apply_ops` 单事务直写服务端 spec 源 （platform_sync/router.py:233-264，无审批门），另有 progress/documents/ approval/quicklog/agent-logs 五个写端点同通道。 - 净新增面评估：shpsync 写链路对可写角色本就存在、本次未改它；本次把 触发人群扩大到全部只读成员（viewer 含绑定自建路径）。 - 裁决：有条件可接受——init 本体（拉自己本地副本、lease 有 runtime owner 归属校验跨用户 404）无害；shpsync 链路沿用既有权限语义。 跟进项（独立变更，不阻塞本收口）：服务层按角色收窄 init 触发面， 或收窄 shpsync sync token 的写域。 试过/考虑过但放弃的方案： - 保持 WORKSPACE_WRITE、给 developer 角色加 workspace:write 权限点： 动的是全局角色种子，波及所有带写语义的端点（成员管理、配置修改等全部 对 developer 开放），远超"允许初始化本地环境"的诉求，弃。 - 仅对 init 例外放行 business_member/developer 白名单角色：在权限体系外 引入角色名硬编码（ROLE_KEY_WHITELIST 模式），角色演进时易漂移， workspace:read 已是"成员"的最自然表达，弃。 - activate 一并放宽：用户裁决仅放宽 init，activate 语义（激活工作区本体） 仍是写操作，不动，弃。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-12-pi-oldhost-fallback-pin
锚点：未记录
最近确认：293d1ec98be0e4e8bf0f8891cfba554052cfdd58
理由：- 风险：披露注释与实现漂移（规则 18 万恶之源）——缓解：披露文本与钉子用例同变更落盘，用例红即披露失真，可被常规回归捕获。 - 放弃方案 A：立即代报门改为读运行时注入结果（driver 上报「MCP 未注入」信号）——可省旧版 pi 宿主 90s 延迟，但需 driver→daemon 新增状态通道，复杂度与收益不成比例（mission 本为长耗时流程），且延迟探测已是 claude 未自报形态的既定安全网，双通道徒增双写回归面。 - 放弃方案 B：caps 表按宿主版本参数化——静态表承载运行时事实会破坏「caps 描述机制支持」的既有语义（FR-06 两层门控分工），且 daemon 启动时无法预知所有会话宿主版本。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-12-regression-review-remediation
锚点：未记录
最近确认：b63e251d656e77106b36eabed32f96d9f629e30c
理由：- 风险：移除机器白名单后，linked_repos 对「失陷 backend 下发任意存在路径」的防线回落到与会话路径相同的信任模型（backend 绑定 vouch + 存在性检查）——这是 ql-20260831-006 已裁决的平台信任边界，本变更是恢复一致性而非新增暴露；残余面（lease/spec-sync 路径同样信任 backend rootPath）在此一并留档为已知边界。 - 放弃方案 A：保留白名单但 forbidden 降级为结果体 skipped——同步仍然不做（功能回归未修复），只是把 5xx 变安静失败，更难排障。 - 放弃方案 B：机器主人把工作区根手工加入 allowed_roots 作为上线前提——把配置负担转嫁用户且与 ql-20260831-006「不该拦截」的裁决直接相悖。 - 放弃方案 C：num_turns/duration_ms 保持裸 typeof（危害止于单轮 NULL）——与同函数另两字段口径统一是一行事，成本两行。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-12-spec-backup-keep-forever
锚点：未记录
最近确认：94b977abe67ff46b0d4ec02bdbebec150d5beb19
理由：最大风险：备份区磁盘增长无上限（阿里云 40G 盘；ql-20260924 生产曾堆积 3.5 万时间戳目录）。缓解：用户已明确选择长期保留（数据安全优先于磁盘）；保留 `SPEC_BACKUP_RETENTION_DAYS` env 逃生门可随时不改代码恢复修剪；磁盘水位由运维监控兜责。次风险：测试经 monkeypatch get_settings 注入，若未来 `_prune_spec_backups` 改为经参数传入 settings，spy 断言形态需同步——已在新用例注释中标注。 死路（试过放弃）：① 直接物理删除 prune 代码与节流基础设施——放弃，逃生门与 OOM 防护仍有价值，且删除面波及三份测试的历史语义；② 用模块常量 `SPEC_BACKUP_RETENTION_DAYS = None` 替代 Settings 字段——放弃，改行为需改代码重发布，违背「运维可调」；Settings 字段与本仓 12-factor 惯例（spec_data_root 等）一致。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-12-spec-backup-retention-validation
锚点：未记录
最近确认：da47981a0f5360823b97253a1b0990b0ee91e462
理由：最大风险：存量自动化脚本若曾以 0/负数「临时禁用修剪」会在升级后启动失败——调研结论：禁用修剪的正确形态就是缺省 None（上变更引入），0/负数在上变更代码里语义是「立即全删」而非「禁用」，不存在合法依赖场景，破坏面为误配纠偏。 死路（试过放弃）：① 在 `_prune_spec_backups` 运行期钳制（<1 视作 None 跳过）——放弃，静默吞掉误配违背 fail-fast，误配者得不到任何信号，且每次调用重复判断；② 用 `Field(gt=0)` 约束——放弃，`gt=0` 无法表达 None 缺省合法（pydantic 对 None 也走约束），需与 `int | None` 叠加特殊处理，field_validator 显式直白且与同文件先例一致。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-12-spec-sync-rebase-guard
锚点：未记录
最近确认：f3203a38d920fa3ea9ca51cf3a87d8fb76fd4060
理由：- 最大风险：守卫扩大后，re-base 段内原本「tar 回退能自愈」的异常现在全部上抛人工裁决——但首推已 conflict 的前提下 tar 回退不是自愈而是静默覆盖（NFR-02 明文禁止），所谓自愈面本不存在，上抛是唯一正确语义；真实代价仅为冲突人工处理频次的口径更严。 - 放弃方案 A：仅给 `computeIncrementalOps` 单独套 try/catch（失败时跳过重试、维持首推 conflict 抛出）——粒度更细但留不住 onProgress 回调与未来新增语句的裸奔面，守卫区间再次漂移；整段包裹与「conflict 后不自动覆盖」不变量一一同构。 - 放弃方案 B：重算失败时降级为直接抛首推的 conflict（复用既有 `if (result.conflict) throw`）——与方案 A 同缺陷，且多一条隐式控制流路径；统一转 `SpecPushConflict` 单出口更可测。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-12-task-sweep-rpc-route-key
锚点：未记录
最近确认：a339d492bcea7f038e3715617f6004967c8f3368
理由：- 最大风险：现网若存在 `daemon_instance_id=NULL` 的 legacy runtime 行，其路由键回落 runtime_id——若 hub 恰也无该键连接，行为与修复前相同（伪离线跳过），不劣化于现状；D-007 迁移已完成（register 必绑定），存量 NULL 行按设计不可达。 - 放弃方案 A：在 `hub.send_rpc` 内做 runtime→instance 兼容映射——否，hub 是纯内存路由层，引入 DB 依赖破坏职责边界且掩盖调用方缺映射的事实；映射归调用方（`daemon_rpc.py:79` 先例）。 - 放弃方案 B：启动清扫挂 daemon 首次连接事件触发——需 hub 新增回调钩子，改动面大且首连早于多 runtime 就绪；固定 60s 延迟达成同等效果、零新耦合，常数可调。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-12-ws-ref-atomic-caret
锚点：未记录
最近确认：6199917b53ffc249caab23f350cb796e863a5a37
理由：最大风险：拦截面过宽误伤正常输入——部分重叠拒绝会让「拖选从标签中间开始的一段删除」被拒（用户需重选）；接受（行为可预期，完整覆盖整块的选区放行覆盖主路径）。放弃的方案：换 contenteditable 富文本（原子节点原生支持，但 2026-10-09 D-001 已否决——IME/退格/联想全链路回归风险大，本诉求未达「token 机制不可维护」的复潮条件）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-13-daemon-module-map
锚点：未记录
最近确认：44ce2cf6bc6bfec9d2a2ade49c3f92272b6f7451
理由：答：最大风险：手改 fr 文件违反文件头「机械解析契约勿手改」告示的字面——但迁移本身是工具 advisory 明示的 sanctioned 动作（「确认后可迁移」），且字段逐字保持 + FR-04 validate/digest 自检兜底；若未来 fr-index 重提炼按归档重放覆写，条目会以新域重新落位（我们已把域修对），重放与迁移结果一致。次风险：根图与项目图双处登记造成 paths 并集冗余——只在项目图登记避免（task-runner 模块本体在项目图）。 试过但放弃的方案：① 按告警字面把 5 条 FR 迁 fr/daemon.md（daemon 模块=daemon.ts WS 核心，测试目录登记进该模块语义错位；且登记若进 task-runner 模块则未来变更落 task-runner 域、与存量 daemon 域分裂，放弃）；② 在根图 docs/multi-agent-platform/modules/_module-map.yaml 登记（根图头部自述细粒度模块归各自项目图，task-runner 模块本体在项目图，跨图重复登记徒增并集冗余，放弃）；③ 给 tests 目录另铸新模块卡（如 task-runner-tests，新造伪模块 id 无对应域文件与语义，过度工程，放弃）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：roadmap-retire
锚点：未记录
最近确认：34fc294d4fdbac3dc4a088097220cf748f47744f
理由：最大风险：误判「无消费」——已复核：平台仓自有代码（frontend/backend/daemon src）grep 仅 daemon 注释 1 处；消费真实来自 sillyspec CLI 的通用读点（全条件化）；.claude/skills 为提示面。放弃的方案：机器化维护单行条目——lite/thin 豁免使字典永远缺主力通道数据，补齐需动 lite 归档语义，为已被四套真源覆盖的文件不值。
