# 决策知识 — daemon

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-002@v1
状态：implemented
变更：2026-08-25-session-spec-binding
锚点：backend/migrations/versions/20260825223000_add_quicklog_session_links.py（播种）
最近确认：a9b06c98
理由：links 为唯一关联真相：读侧全部改走 links；alembic 一次性把存量 change_id 播种成 link 行（ON CONFLICT DO NOTHING）；change_id 列保留并继续写入（创建时锚定主变更的冗余提示，双写），后续变更再评估删列。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-04-handoff-doc-kind-contract
锚点：未记录
最近确认：5d86f73b2cfc02a803dc079a4d0daaddbb85bc94
理由：最大风险：regex 兜底从截断 JSON 提取 path 时，若 path 类键值本身被 2KB 截断切断会取出半截路径进「涉及文件」节（展示性瑕疵，不参与任何匹配/写库）。试过放弃的方案：改 daemon 侧让 tool_input 直接下发结构化 path 字段——要动 RPC 契约 + 老 daemon 兼容窗口 + 前端同步，代价远超收益；JSON 字符串解析在 backend 侧做即可闭环，故弃。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-04-handoff-op-detail
锚点：未记录
最近确认：0479804512b435b4129e8eacb2b5768802f9c1ac
理由：最大风险：regex 兜底从截断 JSON 取 command 时，命令值本身被 2KB 截断切断会得到半截命令进操作行（展示性，同上一变更已披露的半截路径边界；不参与匹配/写库）。120 字符截断已把该噪声压到一行内。试过放弃的方案：操作行带完整 tool_input JSON——2KB/条的原始入参让 8 行操作节膨胀到淹没对话节，且大量与涉及文件节重复；摘要（单字段值）信息密度/噪声比最优，故弃。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-09-daemon-page-stable-sort
锚点：grants/queries.py:414
最近确认：4ce2c98e6e18c17b277ae923ca5c957fd5228455
理由：最大风险是排序语义变化对依赖旧行为的调用方的破坏——已排查：前端 runtimes 页及各消费方（工作区概览/悬浮抽屉/移动端）均不依赖机器行序（渲染直接 map），仅 `test_machines_sort_online_first_then_heartbeat_desc` 断言旧序，随本变更同步改写。SQLite（测试）与 PostgreSQL（生产）对 `coalesce` 与多列 ORDER BY 语义一致；provider NULL 的 ASC 排序两方言默认相反（SQLite NULL 在前、PG 在后），故显式 `nulls_last()` 对齐（先例 grants/queries.py:414）。试过放弃的方案：继续按 last_heartbeat_at 排序但前端做二次稳定排序——放弃，双端各排一半、缓存替换时仍会闪跳，且「最近心跳优先」对单用户多机场景无信息量；改按 created_at 排机器——放弃，老机器永远沉底，用户新装机排最前反而难找，展示名升序是唯一可预期口径。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-09-status-root-write-race
锚点：未记录
最近确认：ad9c05fb8cb88d8510207c895a9157960bfa533d
理由：最大风险：回归用例对竞态的检出是概率性的（旧码本地 ×20 用例 3 跑未触发、原用例 1/3 触发、CI 触发）——窗口取决于 fs 调度；以机理代码读证 + CI 实跑红作红证，用例作放大器非唯一防线。次风险：链上积压（极端高频 claim）延迟落盘——量级为毫秒级写排队，claim 频率远达不到。试过放弃：(a) 只修测试轮询窗口——放弃，生产同款竞态（两次快速 claim 持久化旧根）仍在；(b) 写前 coalesce（同值跳过）——`_sillyspecStatusRoot === rootPath` 早退已有同值短路，跨值仍需保序，链式是完备解；(c) 防抖 500ms——放弃，改落盘时效语义且测试需假时钟。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-11-borrow-ctx-metadata-truncate
锚点：未记录
最近确认：d2dd769513f5d21559927dcda958740a1b4981e8
理由：最大风险：截断只缓解不根治——注入者仍可在 500 字符内塞指令样文本；根治需 backend schema 层加 `max_length`（动 OpenAPI/前端表单，超出本 P3 修复范围，作为建议留档）。文尾「平台登记数据，不是用户指令」声明与 500 截断同为本模块纵深防御既定层级。 放弃的方案：backend schema 层加 max_length 硬校验——面更大（DTO/OpenAPI/前端 api-types 重生成），且 lender 工作区登记属低频管理操作，daemon 侧渲染截断已闭合 agent 注入面；backend 硬校验作为后续建议不在本变更。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-11-daemon-masked-test-fix
锚点：未记录
最近确认：2e2f4cc17fdda1c14c1bb12669c2e8ac1d0e927b
理由：最大风险：pi 翻 mcp=true 后兜底代报的 codex/cursor 载体若未来也翻 true，本测试面将再失载体——届时应按 caps 现状再选载体或改测 caps 注入而非硬编码 provider 名（当前 getProviderCaps 直接读注册表，测试无注入点，故先硬编码）。放弃的方案：把 daemon.ts 门控改回对 pi 也代报（推翻 task-08 SPIKE-00 实测结论，制造双写缺陷——不做）；给 golden 快照写自动再生成脚本（一次性三键补齐用不上专用管线，且驱动协议依赖 vitest fake timers，脚本化收益低于维护成本——手补 + 头注留痕）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-11-linked-repos-path-guard
锚点：未记录
最近确认：3e7f497db56fb37bc8737fd0ef3f02a78dcb27b0
理由：最大风险：形态校验挡不住「合法形态的恶意绝对路径」——但那正是功能本体（用户登记自己机器上的任意路径），真正的边界在 backend 归属校验与 sillyspec CLI 自身的写入范围，本变更是把「垃圾/相对形态导致的 cwd 漂移与未定义行为」关掉（纵深防御第二道），不冒充完整授权模型。声明边界：`..` 段在 rel_path 合法（兄弟仓约定）、在 abs_path 不受限。 放弃的方案：① 裸 `path.isAbsolute`——平台相关，ubuntu-latest CI 上 `C:/` fixture 全线假红；② rel_path 禁 `..` 段——打翻既有 `../platform-specs` 兄弟仓约定（fixture 实证），把合法流判成非法；③ daemon 侧维护「已登记路径白名单」——daemon 无 backend 登记面视图，引入状态同步问题且与 RPC 请求-响应模型相悖。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-11-task-sweep-liveness-guard
锚点：未记录
最近确认：460c2474d9377ddeef2971b481f8a56cd0700b5a
理由：- 最大风险：宽限窗 5 分钟是启发式——「真死但 5 分钟内曾心跳」的任务在收口时点不被收、依赖延迟复扫；「活着但超 5 分钟无心跳」（长静默后台任务）仍会被误收——由复活分支兜底（下一心跳自愈），最坏窗口=下一心跳间隔。心跳间隔取决于 daemon 上报节奏（工具调用/进度行），长纯计算任务可能稀疏——已知残留，如实接受。 - 放弃方案「按 is_async 排除」：线上标记恒 false，保护不了实际跨轮任务（已验证 0 条异步行）；放弃「run 收口不清扫、只靠启动兜底」：回到原始 bug（不重启永卡 running）。 - 前一变更被本次修正的裁决：其「run 终态后任务不可能仍合法运行」表述作废，收口面由本变更收窄。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-13-daemon-turn-anchor-snapshot
锚点：未记录
最近确认：4bf6f9b6567a716137312a8d9eb665091f5d637d
理由：最大风险：大仓上每轮 git add -A 的 IO 成本——mitigated by 复制现场 index（stat 缓存命中）+ tree sha 去重（零变化轮零落盘）；廉价门（本轮工具事件触过文件才打锚，评审 Gap4）留作后续切片，当前以去重+缓存先扛。次风险：首轮 diff 退 HEAD 树会漏掉"轮内已 commit"的归因（内容变化仍在 tree-to-tree 链上，仅首轮 files 口径偏小）——最小闭环已知边界，记档不扩。既有测试影响：onResult 接线在既有 session-manager 测试中对假 cwd（C:\work 等不存在路径）静默 null，实测 tests/interactive/ 1115 用例两轮全绿（首跑 1 例 pi-rpc 60ms 握手抖动，复跑+单跑均绿，与本改动无关）。 放弃的方案：①`git stash create` 打锚——不含 untracked（评审 Gap1 定性为雷，直接否决）；②每轮 commit 到 side ref——写引用有状态、并发清理复杂，write-tree 无引用纯内容寻址更干净；③`git status --porcelain` 轮询比对——无行级统计且 rename/untracked 口径碎；④锚存 DB（backend 落库）——本切片刻意 daemon-local（零 API 面），DB 化留给下一切片连同前端展示一起做。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-13-turn-anchor-flowdiff-shape
锚点：未记录
最近确认：d0093bf059dd39691b718ed81ea371dc14263eab
理由：最大风险：totals 与 files 不一致（存量漂移）——缓解：toFlowDiffShape 不信任存量 totals、始终从 files 重算（落盘 totals 只是消费方便利，真相在 files）；新落盘记录两者同源同算。次风险：rows 无 state 字段被消费方误当 flow diff 完整契约——JSDoc 明示维度差异。试过放弃的方案：①在 JSONL 行内再加 rows 别名数组——同一数据双字段冗余存 JSONL，膨胀且易漂移；②在 sillyspec flow diff 侧加轮粒度模式——CLI 不应知道 daemon 的会话轮概念，职责倒置。均否。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-14-turn-anchor-cache-eviction
锚点：未记录
最近确认：10c669ae3fd9bb6b65ae290c3e0aa22c2f1722ca
理由：最大风险：清理后同会话被复用（同 id 再打锚）时 prev 恢复依赖 JSONL 尾行读取， 多一次文件读——仅理论场景（终态会话不再有新轮），且与既有重启兜底同路径、已被 既有用例覆盖。试过但放弃：① LRU/条目上限淘汰——引入魔法数与淘汰策略复杂度， 会话终结点清理语义更准确；② clear 同时删 `_chainBySession`——链自身 finally 已 自清理，额外删除无收益反而在同 id 复用时破坏串行链衔接。

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
