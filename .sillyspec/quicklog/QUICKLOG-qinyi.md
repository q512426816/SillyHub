
## ql-20260916-001-5852 | 2026-09-16 00:18:54 | docs gate 基线下调锁住棘轮成果（上一轮部署会话清偿 426→339）
状态：已完成
关联变更：（无）
文件：（见实际改动）
需求：docs gate 基线下调锁住棘轮成果（上一轮部署会话清偿 426→339）
根因：基线仍为旧值 379，未锁住清偿成果——后续若回升到 379 以内 gate 不拦，成果可能被蚕食
方案：sillyspec docs gate --init-baseline 重置基线 379→339（.sillyspec/docs-check-baseline 为 gitignore 本地文件，按设计不随 git 提交，各克隆各自初始化）
结果：gate --against HEAD 复跑 339=339 放行；无代码改动、无测试面；QUICKLOG 轮转归档文件随本提交带上

## ql-20260916-002-491a | 2026-09-16 00:20:45 | 会话轮次时间三段显示（开始/结束/持续）+运行中状态条开始时刻
状态：已完成
关联变更：2026-09-15-subagent-three-pane-display
文件：
- frontend/src/components/daemon/turn-timeline.tsx（完成轮时间行三段化+formatTurnTimeSec/formatTurnDuration 两助手）
- frontend/src/components/daemon/turn-status-bar.tsx（运行中状态条加开始时刻（与走秒门槛解耦））
- frontend/src/components/daemon/__tests__/turn-time-display.test.tsx（新增 5 用例）
需求：会话轮次时间三段显示（开始/结束/持续）+运行中状态条开始时刻
根因：完成轮原来只显示结束时间的分钟粒度小字，运行中状态条只有走秒，开始时间与持续时长无处可见；悬浮对话与门户会话共用 TurnTimeline/TurnStatusBar 内核，一处修改两宿主生效
方案：turn-timeline.tsx 新增 formatTurnTimeSec（HH:MM:SS/跨天带日期）与 formatTurnDuration（mm:ss），完成轮时间行升级为开始·结束·历时三段（无开始锚点旧数据回退单显结束时间）；turn-status-bar.tsx 状态词后补开始 HH:MM:SS（锚点存在即显示，与走秒 15 秒门槛解耦）
结果：turn-time-display.test.tsx 新增 5 用例全绿，timeline 相关 38 用例回归全绿，tsc 0 错、eslint 0 警告
审计：[gate] L1（跨 0 模块 · 4 文件：2 代码/1 测试）advisory；每文件注记缺失（--file-notes 覆盖变更文件全集）；测试增量已含

## ql-20260916-003-63ee | 2026-09-16 05:59:33 | daemon 码页探测解码器 GBK 流式回退死代码修复——StringDecoder.write 从不抛错致切换分支不可达
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/spawn-env.ts（CodepageDetectorDecoder 重写+utf8CompletePrefixLen/makeGbkStreamDecoder 新增）
- sillyhub-daemon/tests/spawn-env.test.ts（GBK 流式 9 新用例）
- sillyhub-daemon/src/task-runner/spawn-stream.ts（decodeStream 注释对齐实现）
- backend/app/modules/daemon/session/service/read_model.py（before 游标 docstring 修 <=）
- .sillyspec/docs/SillyHub/modules/daemon.md（增量勘误节）
- .sillyspec/knowledge/known-issues.md（勘误条目）
- .sillyspec/docs/sillyhub-daemon/scan/INTEGRATIONS.md（spawn-env 行号校准 152→371）
需求：daemon 码页探测解码器 GBK 流式回退死代码修复——StringDecoder.write 从不抛错致切换分支不可达
根因：0b05fc0f5 的 CodepageDetectorDecoder 依赖 StringDecoder.write 抛错切 GBK，但 Node StringDecoder 对非法/GBK 字节从不抛错（直接替换 U+FFFD 返回，v24.15.0 本机实证 D6D0CEC4→乱码），catch 死代码；task-runner stdout 与 pi/cursor LfLineFramer 的 GBK 输出仍乱码落库，且原切换分支 utf8.end() 丢弃返回值会丢缓冲字节
方案：重写为自管字节缓冲+utf8CompletePrefixLen 增量严格 UTF-8 校验（未决尾字节≤3 字节跨 chunk 续接不误切，E0/ED/F0/F4 首连续字节收紧对齐 WHATWG），非法字节切 TextDecoder('gbk') 流式并把未决尾字节一并重解，small-icu 构造兜底非致命 utf-8；spawn-env.test.ts 新增 GBK 流式 9 用例；顺修 spawn-stream.ts decodeStream 与 read_model.py before 游标两处注释漂移，INTEGRATIONS.md 行号校准，daemon.md/known-issues 增量勘误
结果：spawn-env 50/50 绿（新增 9 例）+pi-rpc-driver 90+task-runner 72 回归绿；daemon tsc 0；backend ruff check/format 过
审计：[gate] L1（跨 0 模块 · 7 文件：3 代码/1 测试）advisory；每文件注记已全覆盖；测试增量已含

## ql-20260916-004-c365 | 2026-09-16 07:49:25 | known-issues 登记 hasBackgroundTaskGrace 无界宽限观察项（R-01 复审存档）
状态：已完成
关联变更：2026-09-16-background-task-grace-timeout
文件：
- .sillyspec/knowledge/known-issues.md（新增 hasBackgroundTaskGrace 无界宽限观察项（四要素+R-01 溯源））
需求：known-issues 登记 hasBackgroundTaskGrace 无界宽限观察项（R-01 复审存档）
根因：2026-09-16 风险审查发现 bg-task 写通道宽限无界 vs stale-flip 60min 有界的暴露差，前作 R-01 已接受但未文档化，用户裁决不改代码（D-001@v1）仅登记观察项备未来重议
方案：known-issues.md 末尾新增观察条目：四要素（暴露差含代码锚 types.ts:452/缓解链四条/重估触发两条件/未来修复首选双窗兜底 60min+4h）+登记溯源
结果：纯文档动作零源码改动（git status 核对仅 .sillyspec 文件）；四要素 grep 可检索（hasBackgroundTaskGrace/STALE_RUN_WRITE_GRACE_MS）

## ql-20260916-005-0fc5 | 2026-09-16 08:39:52 | 会话页进入 /runs 请求扇出收敛（重放终态不扇出 + 快照注入 + 复核门控）
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/session-panel/session-panel-page.tsx（轮终态新完成判定门控+错误详情共享+runsPromise 注入）
- frontend/src/lib/daemon/session-stream.ts（runsSnapshot 注入缺口同步+5s 复核门控）
- frontend/src/components/daemon/session-panel/session-panel-dialog.tsx（错误详情 in-flight 共享）
- frontend/src/components/daemon/__tests__/session-panel-runs-request-dedup.test.tsx（回归 4 用例（新增））
- frontend/src/lib/daemon.test.ts（lib 回归 3 用例）
- .sillyspec/docs/frontend/modules/components-daemon.md（增量节+变更索引）
- .sillyspec/docs/frontend/modules/lib-daemon.md（增量节+变更索引+过时「无自动重连」bullet 修正）
需求：会话页进入 /runs 请求扇出收敛（重放终态不扇出 + 快照注入 + 复核门控）
根因：首连缺口同步与 5s 复核对每个历史终态 run 合成 turn_completed 重放，页面每条事件无条件拉一次 listSessionRuns（T 轮历史即 2T 条并发），失败轮再逐 run 各拉一次全量列表（F 条），首屏基线 4 条又各自独立拉取——用户实测进入瞬间约 20 条
方案：三层收敛——①page/dialog 增加 completedSideEffectRunIdsRef（历史回灌终态轮按 realRunId 播种），onTurnCompleted 刷新类副作用改同 run 首条门控，状态更新保持幂等、断线缺口补合成的轮照常触发；②失败轮错误详情改 in-flight 共享（同批收敛 1 条，settle 置空保新鲜）；③streamSession 新增 runsSnapshot 选项（宿主 runsPromise 注入首连缺口同步复用）+ 5s 复核按 sawRunningRunAtSync 门控（全终态快照跳过）
结果：新增回归 7 用例全绿（page 4 + lib 3），相关面 230 用例绿，tsc 0 错，eslint 0 警告（dialog connGuard 为既有）；空闲会话进入 /runs 由 4+2T+F 收敛为 2 条、活跃 3-4 条；已知可接受降级——快照→订阅亚秒窗口内新建且瞬完的 run 不再被 5s 复核兜底（无轮可挂，日志重放/重连自愈）
审计：📎 文档引用失效：2/0 处 file:line 失效（sillyspec docs check 可复现）
审计：   ❌ [docs/sillyspec/execute-concurrent-done-skips-next-wave.md:0]  → 文档不存在
审计：   ❌ [docs/sillyspec/verify-sandbox-overlay-partial-state-importerror.md:0]  → 文档不存在
审计：[gate] L1（跨 0 模块 · 13 文件：3 代码/2 测试）advisory；每文件注记缺失（--file-notes 覆盖变更文件全集）；测试增量已含
审计：⚖️ 归属切分：4 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：docs/sillyspec/execute-concurrent-done-skips-next-wave.md, docs/sillyspec/verify-sandbox-overlay-partial-state-importerror.md, docs/sillyspec/finished/execute-concurrent-done-skips-next-wave.md, docs/sillyspec/finished/verify-sandbox-overlay-partial-state-importerror.md

## ql-20260916-006-48e2 | 2026-09-16 09:34:10 | 会话页周边请求缓存键去重（providers/workspaces 统一键）
状态：已完成
关联变更：（无）
文件：.sillyspec/docs/frontend/modules/components-sessions.md（+7/-1）, frontend/src/components/sessions/session-config-bar.tsx（+3/-1）, frontend/src/components/sessions/session-list-panel.tsx（+13/-2）, frontend/src/components/sessions/sessions-portal.tsx（+5/-1）, frontend/src/components/workspace-switcher.tsx（+4/-1）
需求：会话页周边请求缓存键去重（providers/workspaces 统一键）
根因：listProviders 裸调用两处（sessions-portal/session-config-bar）按场景名分键缓存不命中各发一次；workspaces limit=100（session-list）与 switcher 裸调用不同源各发一次——用户截图实测会话页进入 machines/workspaces/llm-providers 各重复 2 次
方案：①listProviders 裸调用统一 queryKey [llmProviders,basic]（容量类消费方 ctx-usage-bar quota-pill 保持独立键）；②workspaces 统一 [workspace-switcher-list] 键，queryFn 统一 items+my-bindings 超集、limit=100 对齐原 session-list 口径。machines 双份属设计内分离（门户含会话计数 vs 面板裸列表，ql-20260909-013）不动
结果：sessions 组件测试 353 用例绿，tsc 0 错，eslint 0 错误（config-bar 8 个 unused-args 警告为既有测试桩，非本次引入）；会话页进入 llm-providers 2→1、workspaces 2→1，machines 维持 2（设计内）
审计：[gate] L1（跨 0 模块 · 5 文件：4 代码/0 测试）advisory；每文件注记缺失（--file-notes 覆盖变更文件全集）；测试增量缺失（4 个代码文件无测试改动）

## ql-20260916-007-df22 | 2026-09-16 09:40:05 | 会话页空闲降频（队列轮询 5s→30s + 活性灯条件轮询）
状态：已完成
关联变更：（无）
文件：
- frontend/src/hooks/use-message-queue.ts（队列轮询 5s→30s）
- frontend/src/hooks/use-session-liveness.ts（新增 opts.enabled 条件轮询）
- frontend/src/components/sessions/session-list-panel.tsx（传 hasActiveSessions 派生值）
- frontend/src/hooks/__tests__/use-message-queue.test.ts（两用例按 30s 口径重写）
- .sillyspec/docs/frontend/modules/hooks-message-queue.md（增量节）
- .sillyspec/docs/frontend/modules/components-sessions.md（活性灯条目）
需求：会话页空闲降频（队列轮询 5s→30s + 活性灯条件轮询）
根因：消息队列兜底轮询固定 5s——队列实时性主链本是 SSE queue_changed 事件驱动即时刷新，5s 轮询纯兜底，空闲会话每 5s 白打一次；会话列表活性小灯 useSessionLiveness 固定 30s 轮询，但全空闲列表灯无渲染意义（行不命中 map 不亮）仍白拉 agent-logs
方案：①use-message-queue POLL_INTERVAL_MS 5s→30s（SSE 事件驱动为主链、重连 resync 自带对账，30s 兜底足够；非 active 不轮询/后台跳 tick 语义保留）；②useSessionLiveness 新增 opts.enabled（缺省 true 零回归），session-list-panel 按列表数据派生 hasActiveSessions 传入——全空闲停 30s 轮询。测试按 30s 口径重写两用例（29s 零轮询/满 30s 恰一次/后台 61s 零轮询）
结果：hooks+session-list-panel+message-queue-bar 相关 164 用例绿，tsc 0 错，eslint 0 错误（use-message-queue 6 个 unused-args 警告为既有接口定义行）；空闲会话队列请求频率 5s→30s（降 83%）、全空闲列表省 30s 一次的 agent-logs 轮询
审计：[gate] L1（跨 0 模块 · 6 文件：3 代码/1 测试）advisory；每文件注记已全覆盖；测试增量已含

## ql-20260916-008-407e | 2026-09-16 09:50:10 | 看门狗心跳存活 + 对账轮次上限（僵尸 running 轮不再无限轮询）
状态：已完成
关联变更：（无）
文件：
- frontend/src/lib/fetch-sse.ts（commentSeen 解析+onHeartbeat 连接字段）
- frontend/src/lib/daemon/session-stream.ts（wireConnection 透传+dispatch 防御路径）
- frontend/src/lib/daemon/session-sse.ts（SessionStreamHandlers.onHeartbeat 可选回调）
- frontend/src/components/daemon/session-panel/use-stream-connection-guard.ts（wrapped.onHeartbeat 注入+MAX_ROUNDS 上限）
- frontend/src/lib/daemon.test.ts（捕获桩补 onHeartbeat 字段）
- .sillyspec/docs/frontend/modules/lib-daemon.md（增量节+变更索引）
- .sillyspec/docs/frontend/modules/components-daemon.md（connGuard 条目）
- docs/sillyspec/finished/sillyspec-quick-concurrent-change-audit.md（并行会话文件（审计放行，非本 quick 产物））
- frontend/src/lib/fetch-sse.ts（commentSeen 解析+onHeartbeat 连接字段）
- frontend/src/lib/daemon/session-stream.ts（wireConnection 透传+dispatch 防御路径）
- frontend/src/lib/daemon/session-sse.ts（SessionStreamHandlers.onHeartbeat 可选回调）
- frontend/src/components/daemon/session-panel/use-stream-connection-guard.ts（wrapped.onHeartbeat 注入+MAX_ROUNDS 上限）
- frontend/src/lib/daemon.test.ts（捕获桩补 onHeartbeat 字段）
- .sillyspec/docs/frontend/modules/lib-daemon.md（增量节+变更索引）
- .sillyspec/docs/frontend/modules/components-daemon.md（connGuard 条目）
需求：看门狗心跳存活 + 对账轮次上限（僵尸 running 轮不再无限轮询）
根因：①backend 每 25-30s 发 :keepalive 注释帧，fetch-sse 不解析注释、handler onmessage 永不触发，看门狗仅 handler 事件推进活动时间——健康空闲连接 90s 后必触发对账，每 30s 白拉 getAgentSession+listSessionRuns；②对账无轮次上限，stale run（daemon 崩溃/锁死遗留 running）对账永远查不出终态，每 30s 无限轮询永不停止
方案：①fetch-sse parseSseChunk 新增 commentSeen（识别 : 注释行）+ FetchSseConnection.onHeartbeat 字段 + 消费循环注释帧先回调（与 frames 派发互斥）；streamSession wireConnection 透传 handler.onHeartbeat，dispatch 对 parse 成功无 event 帧防御路径同步回调；SessionStreamHandlers.onHeartbeat 可选回调零回归；connGuard tapStreamHandlers 注入 wrapped.onHeartbeat（重置活动时间+连续轮次+清 stalledHint，较对账重置更轻）——心跳视为连接存活证据，死连接仍走 onerror 重连+对账兜底。②TURN_WATCHDOG_MAX_ROUNDS=12（约 6min）——同一 running 轮连续 12 轮对账无终态即停表只留 stalledHint，新事件/心跳/换轮重置 roundsRef 后经常驻 setTimeout 自然重启
结果：tsc 0 错，eslint 0 错误（25 警告与基线 stash 对照一致全既有）；连接相关 52 用例 + stream 依赖面板 16 用例绿；daemon.test 捕获桩补 onHeartbeat 字段（FetchSseConnection 类型扩展）
审计：[gate] L1（跨 0 模块 · 10 文件：5 代码/1 测试）advisory；每文件注记缺失（--file-notes 覆盖变更文件全集）；测试增量已含
审计：⚖️ 归属切分：2 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：docs/sillyspec/finished/sillyspec-quick-concurrent-change-audit.md, frontend/src/app/(dashboard)/ppm/_components/record-attachments.tsx

## ql-20260916-009-ac60 | 2026-09-16 10:15:15 | 历史翻页空壳修复（翻「加载更早」不再只显示配置行）
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/session-panel/page-helpers.tsx（knownPendingRunIds 参数+稳定排序）
- frontend/src/components/daemon/session-panel/session-panel-page.tsx（装配块真实 runId+knownPendingRunIds 派生）
- frontend/src/components/daemon/session-panel/turn-state.ts（HISTORY_PAGE_SIZE 100→50）
- frontend/src/components/daemon/__tests__/session-panel-history-race.test.tsx（新增回归用例）
- .sillyspec/docs/frontend/modules/components-daemon.md（增量节）
- .sillyspec/docs/frontend/modules/components-daemon.changelog.md（变更索引）
需求：历史翻页空壳修复（翻「加载更早」不再只显示配置行）
根因：「加载更早」装配块 runId 保留 #e 伪 id → enrichDisplayTurns 按 realRunId ?? runId 查快照双 miss → 同 run 被孤儿轮补建成只有 whoLine 配置行的空壳占位块（runsMeta 全量快照 vs 日志 100 条窗口，未加载轮次内容缺失）；叠加 displayTurns 按快照 finished_at 重排丢失 prepend 位置——用户实证 6e213eb3 会话翻历史只见一堆配置行
方案：①enrichDisplayTurns 新增 knownPendingRunIds 参数（翻页路径按装配块 realRunId 播种 Set 传入），孤儿补建跳过已知未加载轮——翻页到达后装配块自然携带内容出现，未加载期间不渲染空壳；②翻页装配块 runId 改真实 runId#e 页码后缀（快照正常认领合并 whoLine/失败状态，#e 仅作 React key，realRunId 保持原值不影响 SSE 匹配）；③displayTurns 排序稳定兜底（同快照时间保持数组序，prepend 自然位置优先，运行中无时间戳维持末尾语义）；④HISTORY_PAGE_SIZE 100→50 减半单 run 大窗口跨页丢弃概率（触顶/自动补拉链不受限）
结果：新增回归用例（翻页同 run 内容渲染）通过；session-panel 全套 + history-scroll + runtime-session-helpers 249 用例绿；tsc 0 错；eslint 0 错误（2 警告为测试 fixture 既有）；翻页后历史轮次正常显示问答内容，未加载轮次不再渲染配置行空壳
审计：[gate] L1（跨 0 模块 · 6 文件：3 代码/1 测试）advisory；每文件注记已全覆盖；测试增量已含
