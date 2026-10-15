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
锚点：未记录
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
