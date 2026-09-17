
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

## ql-20260916-010-560c | 2026-09-16 10:26:17 | 未加载历史轮占位骨架（翻页前显示配置行骨架，不再是隐形）
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/session-panel/page-helpers.tsx（knownPendingRunIds 轮补建轻量占位 turn）
- frontend/src/components/daemon/__tests__/session-panel-runs-request-dedup.test.tsx（新增骨架回归用例）
- .sillyspec/docs/frontend/modules/components-daemon.md（增量节）
- .sillyspec/docs/frontend/modules/components-daemon.changelog.md（变更索引）
需求：未加载历史轮占位骨架（翻页前显示配置行骨架，不再是隐形）
根因：ql-20260916-009 修复历史翻页空壳后，未加载历史轮完全不显示（隐形）——时间线出现空洞，用户不知道那里还有轮次，向上滚动时内容突然冒出体验突兀
方案：enrichDisplayTurns 对 knownPendingRunIds 中的轮改补建轻量占位 turn（whoLine 配置行 + sender 时间，复用「静默切换轮紧凑标记」渲染形态——turn-timeline 对无 prompt/output 的 completed 轮已渲染紧凑配置行，无需改渲染层），翻页到达后装配块携带内容自然替换
结果：新增回归用例（快照含未加载 run-h4-unloaded → 紧凑行渲染测试档案，跨段文本函数匹配）；session-panel 全套 211 用例绿，tsc 0，eslint 0；模块文档增量节+changelog
审计：[gate] L1（跨 0 模块 · 4 文件：1 代码/1 测试）advisory；每文件注记已全覆盖；测试增量不适用（≤1 代码文件）

## ql-20260916-011-06b3 | 2026-09-16 10:31:56 | 失败卡 unknown 根治（失败轮补可读 failure_summary）
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/run_sync/service/close_run_steps.py（失败轮补可读 failure_summary）
- backend/app/modules/daemon/tests/test_close_interactive_run_model_error.py（新增 3 用例）
- frontend/src/components/agent-log/normalize.ts（映射表补 daemon_interrupted/SERVICE_RESTART_INTERRUPTED）
- .sillyspec/docs/backend/modules/daemon.md（增量节）
需求：失败卡 unknown 根治（失败轮补可读 failure_summary）
根因：交互轮失败（agent 执行报错）时 daemon 未回传执行摘要（result_summary 空），后端不落任何可读原因，前端 buildSystemFailureItem 无 summary 无映射 → 错误卡只剩「运行失败 · unknown」光秃展示（用户实证 6e213eb3 会话 09-15 11:00 失败轮）
方案：①后端 close_run_steps._close_apply_terminal：failed 且 result_summary 空时按 error_code 补写可读中文原因到 output_redacted（经 SessionRunRead.failure_summary 透出，写前非空不覆盖防冲掉执行摘要）；映射 interactive_failed/interactive_unknown_status/interactive_interrupted/interactive_inject_send_failed；②前端 buildSystemFailureItem 映射表补 daemon_interrupted（执行端离线）/SERVICE_RESTART_INTERRUPTED（服务重启）可读文案
结果：后端新增 3 用例（无摘要补写/有摘要保留/成功轮不补）+ 既有 7 用例共 10 passed，相邻 interactive_lifecycle/apply_session_terminal 40 用例绿，ruff/mypy 过；前端 agent-log 相关 164 用例绿，tsc 0；模块文档 daemon.md 增量节
审计：[gate] L1（跨 0 模块 · 4 文件：2 代码/1 测试）advisory；每文件注记已全覆盖；测试增量已含

## ql-20260916-012-b5b2 | 2026-09-16 12:08:32 | 全路由 force-dynamic 根治部署后旧 HTML 壳一年缓存坑
状态：已完成
关联变更：（无）
文件：
- frontend/src/app/layout.tsx（根布局 force-dynamic + 坑位注释）
- frontend/src/components/daemon/__tests__/session-panel-runs-request-dedup.test.tsx（mock 类型修正）
- .sillyspec/docs/frontend/modules/app-layouts.md（增量节）
需求：全路由 force-dynamic 根治部署后旧 HTML 壳一年缓存坑
根因：Next 默认把客户端页面 static 预渲染打 s-maxage=31536000（实测全站含 /login），重新部署后浏览器/代理继续用旧壳引用旧 chunk，新代码永不生效——用户实证 /sessions 部署后无变化、后端日志 11:58 仍见旧版 200ms 内 6 条 /runs 扇出；公网 chunk 验证新代码可下载但浏览器拿旧 HTML
方案：根布局 export const dynamic = force-dynamic 一次覆盖全部路由（workbench 逐页先例的全站化）：壳 HTML 每次 SSR + no-store，/_next/static 内容哈希 immutable 不受影响；附带修 Quick E 测试 mock 类型（SessionRunRead 标注）
结果：tsc 0；dedup 测试 5 用例绿；page.test 7 失败 stash 对照证并行既有债非本次引入；已部署验证：公网 /sessions 响应头从 s-maxage=31536000 变为 private,no-cache,no-store,must-revalidate，onHeartbeat chunk 公网可下载

## ql-20260916-013-c032 | 2026-09-16 12:36:56 | 翻页游标块序错位根治 + 跳转空壳命中 + rAF 后台卡死（32 轮空壳三连修）
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/session-panel/session-panel-page.tsx（快照播种+锚点竞态修复）
- frontend/src/components/daemon/session-panel/page-helpers.tsx（ACTIVE_RUN_STATUSES 导出）
- frontend/src/components/daemon/session-panel/turn-state.ts（页大小 400）
- frontend/src/components/daemon/__tests__/session-panel-runs-request-dedup.test.tsx（窗口外轮用例）
- frontend/src/components/daemon/__tests__/session-panel-history-race.test.tsx（页距对齐）
- frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx（页距对齐）
- .sillyspec/docs/frontend/modules/components-daemon.md（增量）
- .sillyspec/docs/frontend/modules/components-daemon.changelog.md（索引）
需求：C:/Program Files/Git/runs 扇出线上根治 + 翻页覆盖 400/页 + prepend 锚点竞态修复（浏览器实测三连）
根因：线上浏览器实测复现三问题：①进入会话 20ms 内 36+ 条 /runs 并发（fetch 堆栈定位 onTurnCompleted——日志窗口播种只覆盖窗口内轮次，缺口同步对快照全部终态轮合成事件，6e213eb3 会话 44 轮 1.1 万条日志 37 轮未播种全通过门控；测试夹具 3 轮全在窗口内未暴露）；②滚几页只见配置行（翻页单位是日志行而显示单位是轮，50 条/页滚 220 次才能看全）；③滚到顶有时弹回下面轮次（锚点捕获与 prepend 提交间被中间 turnState 提交抢跑空消费，真 prepend 无锚可补）
方案：①establish 播种改以 runs 快照为准（非活跃即终态预标记，ACTIVE_RUN_STATUSES 导出；首版误用 runTerminalTurnStatus——completed 返回 null 漏播成功轮，被新增窗口外轮用例当场抓住）；②HISTORY_PAGE_SIZE 50→400（后端 le=1000，撤销 009 的 100→50）；③锚点 effect 高度未增不消费（保留待真 prepend 落地）+ 空页清锚防滞留误补偿
结果：浏览器终验通过：/runs 进入 39→3 条；滚动加载 400 条/页（scrollHeight 14.6k→44k，内容轮 11→24 持续变出）；连续 5 次滚顶视口稳定无弹回。测试：新增窗口外轮扇出回归用例（修复前 23 次修复后 3 次），dedup 6/6 + session-panel 全套 212 + scroll/race 9/9 绿（两测试页距常量对齐 400），tsc 0
审计：[gate] L1（跨 0 模块 · 5 文件：1 代码/2 测试）advisory；每文件注记已全覆盖；测试增量不适用（≤1 代码文件）

## ql-20260916-014-53f9 | 2026-09-16 13:30:10 | 修复最近 CI 前端 22 红 + daemon hot-switch 偶发红
状态：已完成
关联变更：（无）
文件：
- frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx（importActual 透传 detectUsageProvider + 补 workspace-binding mock + 翻页夹具/断言引用 HISTORY_PAGE_SIZE 常量 + 裸时间计数适配三段显示）
- frontend/src/components/sessions/__tests__/session-list-panel.test.tsx（补 workspace-binding mock（queryFn 并拉 my-bindings 后数据源齐））
- frontend/src/components/daemon/__tests__/session-usage-panel-mount.test.tsx（第二轮终态换新 run_id（同 run 首条门控适配））
- frontend/src/lib/__tests__/daemon-session.test.ts（5s 复核用例改写为快照含 running 且窗口内完成的真实门控语义）
- sillyhub-daemon/tests/daemon-provider-config-changed-handler.test.ts（waitForCond 改等 hot_switch_rewrite 完成日志（全部文件写盘后发出，代替只轮询首文件））
需求：修复最近 CI 前端 22 红 + daemon hot-switch 偶发红
根因：五类根因叠加——①ctx-usage-bar QuotaPill 渲染期调用 detectUsageProvider 而 page.test 的 llm-providers mock 只暴露两个数据函数（渲染即崩）；②ql-20260916-006 工作区查询统一 switcher 键后 queryFn 并拉 fetchMyBindings，page.test/session-list-panel.test 未 mock，真实 fetch 失败路径的异步延迟在 CI 慢机上晚于组头名称断言（兜底当前工作区误显）；③ql-20260916-013 把 HISTORY_PAGE_SIZE 50→400 而翻页夹具/断言仍硬编码 100（满页判定不成立翻页链路全断）；④ql-20260916-005 用量刷新改同 run 首条完成门控，usage-mount 第二轮终态同 run_id 被去重不再递增；⑤同提交给 streamSession 5s 复核加 sawRunningRunAtSync 门控，旧断言（全终态也等第二次合成）失效；⑥daemon hot-switch 测试只轮询首个文件就断言后续文件+日志，观察窗口落在 mkdir→auth→config 多段 await 写盘的中间态（CI 慢机必现）
方案：测试单源对齐现状——mock 补 export/数据源、夹具引用常量、断言按新语义改写；生产代码零改动
结果：page.test 37绿、session-list-panel 105绿、usage-mount+daemon-session+list 合并 137绿、daemon hot-switch 16绿（修复前每次1-2红）、typecheck 双侧0错、lint 仅既有警告（与CI基线一致）
审计：[gate] L1（跨 0 模块 · 5 文件：0 代码/5 测试）advisory；每文件注记已全覆盖；测试增量不适用（≤1 代码文件）

## ql-20260917-001-b89b | 2026-09-17 08:38:11 | 会话面板 24h 风险审查三缺陷修复：翻页空页死循环/锚点 interval 堆积/看门狗心跳语义
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/session-panel/session-panel-page.tsx（空页关闸+锚 effect cleanup）
- frontend/src/components/daemon/session-panel/use-stream-connection-guard.ts（lastEventRef 安静门+心跳语义+停表重启）
- frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx（空页关闸+interval 不堆积 2 用例）
- frontend/src/components/daemon/__tests__/session-panel-connection.test.tsx（看门狗心跳 3 用例）
- .sillyspec/docs/frontend/modules/components-daemon.md（增量节+ql-008 条目语义修正）
- .sillyspec/docs/frontend/modules/components-daemon.changelog.md（追加条目）
需求：会话面板 24h 风险审查三缺陷修复：翻页空页死循环/锚点 interval 堆积/看门狗心跳语义
根因：①older.reduce 空数组初始值 undefined 读 .timestamp 抛 TypeError 被 catch 静默，游标不动 hasEarlier 恒真，日志总数 400 整数倍会话触顶翻页永久死循环（6e5de0347 引入，初始加载有守卫不对称）；②锚 effect 依赖 turnState 无 cleanup，流式每提交新建 watch interval 且 anchor.until 延期+apply 恒真钉死自清，interval 无界堆积强制布局风暴（74a175960 引入）；③心跳重置 lastActivityRef 使 90s 对账门在健康连接永不开——Redis publish best-effort 丢 turn_completed 时该轮永久卡运行中，且停表后注释宣称的自然重启不存在（161471394 引入）
方案：①handleLoadEarlier 对空页提前关闸（游标二元组置空+hasEarlier false+锚点作废，对齐初始加载写法）；②锚 effect 补 cleanup（rAF 双帧/watch interval/30s 硬上限/anchorPinRef 全清）；③新增 lastEventRef 只计真实事件+300s 安静门（对账双门：90s 无任何信号判死连接/300s 无真实事件兜底丢终态），心跳只重置活动时间与 stalledHint，停表后新真实事件经 watchdogRearmRef 重启计时链，注释与 hook 文档同步修正
结果：新增回归 5 用例（scroll 2+connection 3）先红后绿验证（patch 对照修复前全失败）；两测试文件 24/24 绿，相邻面 history-race/dialog/pre-session/ctx-tokens 101 用例绿，tsc 0 错误，eslint 0 错误（12 警告既有）
审计：[gate] L1（跨 0 模块 · 6 文件：2 代码/2 测试）advisory；每文件注记已全覆盖；测试增量已含

## ql-20260917-002-a5c0 | 2026-09-17 09:10:24 | 手机端群聊页样式优化（用户截图四问题）。根因：grid 隐式行 auto 高度不受 min-h-0 flex-1 约束致长时间线整列溢出（输入区出视口、消息穿…
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/group-chat/group-chat-panel.tsx（grid-rows minmax(0,1fr) 锁行高治溢出 + 顶栏 flex-1 标题块/窄屏短摘要/群id钮 md 起显 + self 头像顶对齐）
- frontend/src/components/ui/markdown-text.tsx（hr 锁 1px 主题色细线（compact/reading 两档））
需求：手机端群聊页样式优化（用户截图四问题）。
根因：grid 隐式行 auto 高度不受 min-h-0 flex-1 约束致长时间线整列溢出（输入区出视口、消息穿 TabBar）；顶栏固定宽元素 390px 挤爆标题块至 0 宽逐字竖排；self 行 items-end 头像吊右下；markdown hr 库 light 变量反超成亮白粗条。
方案：根 grid 加 grid-rows-[minmax(0,1fr)]；标题块 flex-1+去 spacer+窄屏短摘要+群id钮 md 起显+gap 收紧；self 头像 self-start；MarkdownText 两档补 hr 锁 1px bg-border。
结果：tsc 0，group-chat 123+markdown-text 13 用例全绿，eslint 0 error（5 warning 既有），已暂存待提交部署

## ql-20260917-003-42be | 2026-09-17 09:36:09 | 群聊输入框要固定在最下方（上轮 grid-rows 修复后仍未生效）。根因：群聊视图面板父级 wrapper 是 block div…
状态：已完成
关联变更：（无）
文件：
- frontend/src/app/m/workspaces/[id]/sessions/page.tsx（群聊视图 wrapper block→flex-col，面板 flex-1 生效+grid-rows 锁行高=输入区常驻视口底部）
需求：群聊输入框要固定在最下方（上轮 grid-rows 修复后仍未生效）。
根因：群聊视图面板父级 wrapper 是 block div，面板根 flex-1 无 flex 上下文是死代码，面板高度塌到内容高溢出视口——输入区被顶出屏幕；预会话视图同结构却正常，因 SessionPanel 根用 h-full（百分比定高生效）而面板用 flex-1（需 flex 上下文）。
方案：群聊视图 wrapper 改 flex min-h-0 flex-1 flex-col——面板 flex-1 生效拿满剩余高度，配合上轮面板根 grid-rows-[minmax(0,1fr)] 锁行高，时间线 min-h-0 flex-1 列内自滚、输入区 flex-none 常驻视口底部（pb-28 之上、悬浮 TabBar 之下）。
结果：tsc 0，m-sessions+group-chat 134 用例全绿；按用户要求未部署，桌面悬浮宿主同款 block wrapper 隐患已记录待后续

## ql-20260917-004-d437 | 2026-09-17 09:52:27 | 变更文件预览四修——scope-audit.json/apply-manifest/verify-facts/scope-audit.patch 结构化可视化、…
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/change/service.py（_TEXT_SUFFIXES 补 .log/.patch/.diff（is_text 判定修复））
- frontend/src/components/files/structured-views.tsx（新增 JsonView 折叠树 + DiffView 红绿视图（内联与全屏共享））
- frontend/src/components/files/wheel-scroll-unlock.ts（新增 radix 滚轮锁解锁（捕获段手动滚动））
- frontend/src/components/files/preview-registry.ts（增 json/patch/text 三 RendererKey）
- frontend/src/components/files/file-preview-modal.tsx（RENDERER_MAP 接线 + 挂载滚轮解锁 + 弹窗根类标记）
- frontend/src/components/files/previewers/json-previewer.tsx（新增 JSON 渲染器（非法 JSON 回落纯文本））
- frontend/src/components/files/previewers/patch-previewer.tsx（新增 unified diff 渲染器）
- frontend/src/components/files/previewers/text-previewer.tsx（新增纯文本渲染器（.log/.txt））
- frontend/src/components/files/previewers/index.ts（导出三新渲染器）
- frontend/src/components/change-file-tree.tsx（内联预览接 json/diff 分支）
- frontend/src/components/__tests__/change-file-tree.test.tsx（软归属·同模块测试，未声明）
- frontend/src/components/files/__tests__/file-preview-modal.test.tsx（软归属·同模块测试，未声明）
- frontend/src/components/files/__tests__/preview-registry.test.ts（软归属·同模块测试，未声明）
- frontend/src/components/files/__tests__/structured-views.test.tsx（软归属·同模块测试，未声明）
- frontend/src/components/files/__tests__/wheel-scroll-unlock.test.ts（软归属·同模块测试，未声明）
需求：变更文件预览四修——scope-audit.json/apply-manifest/verify-facts/scope-audit.patch 结构化可视化、.log 误判非文本、全屏文本类落 fallback、全屏 MD 滚轮失效。
根因：后端 _TEXT_SUFFIXES 白名单缺 .log/.patch/.diff；preview-registry 无 json/patch/text 渲染器；antd 全屏弹窗叠 radix Dialog 时 react-remove-scroll 在 document 冒泡段 preventDefault 掉弹窗内全部滚轮/触摸滚动（实测 body data-scroll-locked=1、scrollTop 恒 0）。
方案：structured-views 共享视图（JsonView 递归折叠树+DiffView 红绿行复用 parseUnifiedDiff）+ 三渲染器接入 registry/弹窗/文件树内联；wheel-scroll-unlock 捕获段手动滚动+preventDefault（无锁零介入）；后端白名单补三后缀。
结果：7 测试文件 102 用例绿，tsc 0，eslint 0 error（1 既有 warning），ruff 过，后端 change-file 2 用例绿；dev 栈浏览器实测 json 树/diff 红绿/log 纯文本/MD 全屏滚轮 0→240px 全部验收通过
审计：[gate] L1（跨 0 模块 · 17 文件：10 代码/5 测试）advisory；每文件注记缺失（--file-notes 覆盖变更文件全集）；测试增量已含
审计：🔍 软归属：5 个窗口内未声明同模块测试文件已补入文件行（若属并行会话改动请手工剔除）：frontend/src/components/__tests__/change-file-tree.test.tsx（+75/-0）, frontend/src/components/files/__tests__/file-preview-modal.test.tsx（+42/-0）, frontend/src/components/files/__tests__/preview-registry.test.ts（+32/-0）, frontend/src/components/files/__tests__/structured-views.test.tsx（+95/-0）, frontend/src/components/files/__tests__/wheel-scroll-unlock.test.ts（+107/-0）

## ql-20260917-005-b065 | 2026-09-17 10:59:13 | doRefresh 刷新请求无超时，网络僵死时单飞 Promise 永久挂起致 apiFetch 401 收口与调用方永久加载。根因…
状态：已完成
关联变更：（无）
文件：
- frontend/src/lib/token-refresh.ts（doRefresh 增 15s AbortController 超时）
- frontend/src/lib/__tests__/token-refresh.test.ts（新增用例 5b/5c）
需求：doRefresh 刷新请求无超时，网络僵死时单飞 Promise 永久挂起致 apiFetch 401 收口与调用方永久加载。
根因：POST /api/auth/refresh 无 signal 无超时，apiFetch 的 GET 30s 超时不覆盖刷新等待。
方案：15s AbortController 超时抛 ApiError(timeout) 交既有 catch 链展示，不清会话不强制跳登录，网络异常传播不变。
结果：token-refresh 11 用例绿（5b 先红后绿）+ api.test 12 零回归 + tsc 0 + eslint 0 error（3 既有 warning）

## ql-20260917-006-1380 | 2026-09-17 15:57:08 | 会话对话区隐藏上下文压缩续接摘要，压缩中实时提示
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/session-log-assembler.ts（classify 新增 compact/compact_status 段识别；TurnSegment 增两成员；装配器平铺+投影零影响）
- frontend/src/components/daemon/turn-segment-views.tsx（新增 CompactSegmentView（进度折叠卡）/CompactStatusRowView（压缩三态行）/CompactNoticeChip（对话短提示））
- frontend/src/components/daemon/turn-timeline.tsx（isConversationSegment 纳 compact；compact_status 运行中过滤；segmentTsOf 补两成员）
- frontend/src/components/daemon/turn-status-bar.tsx（segmentTs 穷尽 switch 补 compact/compact_status）
- sillyhub-daemon/src/interactive/claude-events.ts（system/status 压缩帧事件化 status/context_compacting）
- sillyhub-daemon/src/interactive/session-manager/events.ts（dispatchStatusEvent context_compacting case 落 [COMPACT_STATUS] stdout 行）
- sillyhub-daemon/src/types.ts（AgentStatusSubtype 增 context_compacting）
- sillyhub-daemon/src/agent-event-schema.ts（zod 枚举 7→8）
- frontend/src/components/daemon/__tests__/session-log-assembler.test.ts（+4 用例（分类/状态行/投影空/历史实时一致））
- frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx（+3 用例（折叠交互/三态+坏 JSON/短提示））
- sillyhub-daemon/tests/interactive/claude-events.test.ts（+1 用例（三事件+requesting 丢弃+zod））
- sillyhub-daemon/tests/agent-event-schema.test.ts（枚举闭合 7→8）
- .sillyspec/docs/SillyHub/modules/daemon.md（ql-20260917-006 增量）
- .sillyspec/docs/multi-agent-platform/modules/frontend.md（ql-20260917-006-1380 变更索引）
需求：会话对话区隐藏上下文压缩续接摘要，压缩中实时提示
根因：CLI 自动 compaction 后把续接摘要当 assistant 文本块注入新窗口，被前端 classifySessionLog 归 reply 渲染成大段气泡刷屏（线上会话 6e213eb3 两天 16 次实证）；SDK system/status 压缩帧被 daemon 归一化器静默丢弃，前端无任何压缩过程信号（用户要求压缩中回显「上下文正在重新压缩」）。
方案：前端 session-log-assembler classify 新增 compact/compact_status 两 kind 与 TurnSegment 两成员（装配器平铺独立过程段，兼容投影零影响）；turn-segment-views 新增 CompactSegmentView（进度区折叠卡）/CompactStatusRowView（compacting 实时提示/failed 警示/success 静默）/CompactNoticeChip（对话区一行短提示），turn-timeline isConversationSegment 纳 compact+compact_status 运行中过滤，segmentTsOf/turn-status-bar segmentTs 补穷尽分支；sillyhub-daemon claude-events 归一化器 system/status 帧事件化 status/context_compacting（types+zod 枚举同步），session-manager/events dispatchStatusEvent 落 [COMPACT_STATUS] stdout 协议行（backend 零改动）。
结果：frontend daemon 组件 67 文件 978 用例绿+tsc 0+eslint 0 error（3 warning 既有）；daemon typecheck 0+相关测试 35 绿+全量 4305 绿（1 failed 为 daemon-status-root-persistence 计时并发用例单跑 9 绿，与本改动无关）；模块文档 daemon.md/frontend.md 增量已更；未部署（daemon/前端需重启生效）。遗留：压缩完成由 compact 摘要段承担完成语义；非 claude provider 无压缩帧来源。
审计：[gate] L1（跨 0 模块 · 16 文件：9 代码/5 测试）advisory；每文件注记缺失（--file-notes 覆盖变更文件全集）；测试增量已含
审计：⚖️ 归属切分：2 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：backend/app/modules/workspace/router.py, backend/app/modules/workspace/tests/test_platform_grant_list.py

## ql-20260917-007-7cec | 2026-09-17 16:33:05 | 工作区列表平台级授权口径对齐——持平台级 workspace:read/platform:admin 的用户全量可见
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/workspace/router.py（list_workspaces 非管理员分支加平台级授权判定，全量/工作区级两分支）
- backend/app/modules/workspace/tests/test_platform_grant_list.py（新建 5 用例：平台级 read 全量/platform:admin 全量/工作区级成员仅见本区/无读权限平台角色 403/无角色 403）
- backend/app/modules/workspace/tests/test_workspace_admin_management.py（FR-02 旧边界用例改锁新语义 sees_empty→sees_all）
- .sillyspec/docs/multi-agent-platform/modules/backend.md（变更索引 ql-20260917-007-7cec 条目）
需求：工作区列表平台级授权口径对齐——持平台级 workspace:read/platform:admin 的用户全量可见
根因：180593 持平台级 super_admin 角色：通知广播收件人查找（rbac 段2）与端点鉴权（has_permission 段2）都认平台级授权，唯独 GET /workspaces 只查工作区级绑定，造成「列表看不到却能收通知、进内容」的三处口径割裂；旧 FR-02「平台级 read 也见空列表」边界作废
方案：list_workspaces 非管理员分支先查 collect_permissions_platform，持 workspace:read 或 platform:admin 时 allowed_workspace_ids=None 全量返回（对齐 is_platform_admin 分支），否则维持原工作区级限定；新增 test_platform_grant_list.py 5 用例，既有 test_workspace_admin_management 边界用例改锁新语义；backend.md 变更索引加条目
结果：workspace+notification+auth(rbac) 三套件 518 passed（1 skip=Windows symlink 特权既有、2 xfail 既有），ruff check/format/mypy 全 0；未部署
审计：[gate] L1（跨 0 模块 · 6 文件：1 代码/2 测试）advisory；每文件注记缺失（--file-notes 覆盖变更文件全集）；测试增量不适用（≤1 代码文件）

## ql-20260917-008-48e5 | 2026-09-17 16:49:56 | 会话执行中直接切换供应商/模型/思考档/档案，下一轮生效
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/session/service/queue.py（纯切换覆盖合并入队（逐字段 last-wins）+model 快照落列+派发重放透传）
- backend/app/modules/daemon/session/service/thinking_level.py（忙轮 409 改覆盖暂存 queued 响应+apply_pending_thinking_level 轮末应用）
- backend/app/modules/daemon/run_sync/service/close_run_steps.py（run 终态钩子并列 fire 暂存思考档应用）
- backend/app/modules/daemon/schema.py（SessionThinkingLevelResponse 加 queued 字段）
- backend/app/modules/agent/model.py（queued_messages 加 model 列+sessions 加 pending_thinking_level 列）
- backend/migrations/versions/20260917160000_add_queued_model_and_pending_thinking_level.py（两列迁移）
- frontend/src/components/sessions/session-config-bar.tsx（canSwitch 放宽 !ended+排队态提示行+toast 分态+信号分态）
- backend/openapi.json + frontend/src/lib/api-types.ts（gen:types 同步（queued 字段））
- backend/app/modules/daemon/tests/test_session_queue.py（+4 用例（覆盖合并/双向不合并/派发重放 model））
- backend/app/modules/daemon/tests/test_session_thinking_level_endpoint.py（忙轮 409 用例改 queued 契约+覆盖 last-wins 新增）
- frontend/src/components/sessions/__tests__/session-config-bar.test.tsx（存量 5 用例改写+新增 2 用例（running 排队提示））
- .sillyspec/docs/SillyHub/modules/daemon.md + .sillyspec/docs/multi-agent-platform/modules/frontend.md（ql-20260917-008 增量）
需求：会话执行中直接切换供应商/模型/思考档/档案，下一轮生效
根因：切换生效机制是 turn 边界 daemon reload（子进程 env 启动烧死，D-002），前端 running 全置灰只是展示层旧契约——后端 inject 路由 queue_when_busy=True 早已受理忙轮切换（落排队表轮末自动派发）；实际缺口三处：排队行无 model 快照（忙轮切模型派发静默丢失）、连续切换排多条切换轮、思考档忙轮 409。用户拍板：执行中允许直接切换、下一轮生效、重复切换覆盖（最后一次为准）。
方案：后端：①agent_session_queued_messages 加 model 快照列（迁移 20260917160000），入队落列+派发重放成对；②queue.py 纯切换覆盖合并——新请求纯切换（空 prompt/无附件/带配置维度）且同发送者已有 pending 纯切换行则逐字段覆盖（None 不动，按维度最后一次为准），不新建行 position 不变，普通消息双向不合并；③思考档忙轮 409 改覆盖式暂存 agent_sessions.pending_thinking_level（同迁移）返回 queued=true，close_run_steps run 终态钩子与排队派发并列 fire apply_pending_thinking_level（独立 session 复用 _set_via_rpc，成功清列失败保留）；schema 加 queued 字段+gen:types/openapi 同步。前端 session-config-bar：canSwitch 放宽 !ended（运行中可点）；底部锁提示改 ⏱「运行中切换将于本轮结束后生效」信息行；四控件 title/toast 分态（running 排队提示）；providerOpenSignal running 不再吞（ended 才吞）。
结果：后端 queue 23 绿（新增合并 4 用例）+thinking endpoint 24 绿（忙轮 409 用例改 queued 契约+覆盖 last-wins 新增）+inject/switch_config/queue_actions 等相关套件共 100 绿+ruff/mypy 0+迁移 offline SQL 校验过；前端 sessions 8 文件 346 绿+session-panel 3 文件 28 绿+新增 2 用例+存量 5 用例按新契约改写+tsc 0+eslint 0 error（8 warning 既有回调形参）；模块文档 daemon.md/frontend.md 增量已更；未部署（后端迁移+前端构建需部署生效）。遗留：会话 end 时暂存思考档不再应用（fail-loud 日志）；provider_caps/provider-caps.ts 行尾重写假 M 未提交（.gitattributes 根治待办）。
审计：📝 文档欠账（D-8）：12 个源码文件改动未同步任何模块文档（涉及模块：backend · frontend）
审计：[gate] L2（跨 0 模块 · 12 文件：9 代码/3 测试）advisory；模块文档认领不适用（无可认领模块）；风险命中 1 处（migration←backend/migrations/versions/20260917160000_add_queued_model_and_pending_thinking_level.py）需运行时证据
审计：⚖️ 归属切分：2 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：backend/openapi.json, frontend/src/lib/api-types.ts

## ql-20260917-009-7220 | 2026-09-17 21:44:30 | agent_run_logs 入库剥 NUL 字节防 PG CharacterNotInRepertoireError 丢单条日志（daemon 上报 Wind…
状态：已完成
关联变更：（无）
文件：backend/app/modules/agent/model.py（+61/-8）, backend/app/modules/agent/tests/test_agent_run_log_nul.py（+121/-0）, backend/app/modules/agent/tests/test_group_chat_models.py（+8/-1）
需求：agent_run_logs 入库剥 NUL 字节防 PG CharacterNotInRepertoireError 丢单条日志（daemon 上报 Windows 命令 UTF-16 宽字符残段含 \x00）。
根因：PG VARCHAR/TEXT/JSON 不接受 U+0000，整条 INSERT 拒收。
方案：NulSafeStr/NulSafeText/NulSafeJSON TypeDecorator 挂 8 列 bind 参数层剥 \x00（照 ConstraintsJSON 先例；SQLModel table 模型不走 pydantic 验证故 field_validator 无效已弃）；impl 不变 DDL 零变化无迁移。
结果：6 新用例 + agent 全量 1248 绿 + ruff 过；已提交 03a4667b9 推送 origin。

## ql-20260917-010-5b44 | 2026-09-17 21:50:31 | 变更文件预览三改进——diff 去 5000 硬顶改懒加载、去掉变化比对按钮、三个固定结构 json 表格化。根因：DiffView 渲染上限截断大 diff…
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/files/structured-views.tsx（DiffView 增量懒加载+knownJsonView 三表格视图分发）
- frontend/src/components/files/previewers/json-previewer.tsx（全屏接 knownJsonView 分发）
- frontend/src/components/change-file-tree.tsx（内联 json 分发+变化比对按钮与 changeKey 移除）
- frontend/src/components/changes/detail/change-files-card.tsx（changeKey prop 移除）
- frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx（ChangeFilesCard 调用去 changeKey）
需求：变更文件预览三改进——diff 去 5000 硬顶改懒加载、去掉变化比对按钮、三个固定结构 json 表格化。
根因：DiffView 渲染上限截断大 diff；变化比对按钮按用户要求移除（prop 链三层）；折叠树对固定结构报告可读性差。
方案：DiffView 首屏 2000 行+触底 600px 预载+点击兜底续渲（无总量上限）；changeKey prop 链整体删除（ScopeFileDiffModal 组件与快速修复抽屉入口保留）；knownJsonView 按文件名+结构特征分发三个表格视图（scope-audit 裁决徽章+文件表/apply-manifest 哈希清单/verify-facts 探针·测试·一致性·移交），不命中回落折叠树，内联与全屏共用。
结果：6 测试文件 107 用例绿，tsc 0，eslint 0 error（1 既有 warning）；浏览器实测内联+全屏四视图、按钮消失、2604 行 patch 点击续渲至全量、哨兵消失全通过
审计：[gate] L1（跨 0 模块 · 9 文件：5 代码/3 测试）advisory；每文件注记缺失（--file-notes 覆盖变更文件全集）；测试增量已含
审计：⚖️ 归属切分：1 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：backend/app/modules/agent/tests/test_group_chat_models.py

## ql-20260917-011-8ddc | 2026-09-17 22:11:31 | 部署窗口 5xx/网络错误风暴两层防护（此前 recreate 窗口用户页签被 ERR_INSUFFICIENT_RESOURCES 打废）。根因…
状态：已完成
关联变更：（无）
文件：
- frontend/src/lib/api-circuit.ts（新增全局熔断模块（阈值/冷却/半开/订阅））
- frontend/src/lib/api.ts（apiFetch 接线（开闸短路非 auth、成败上报、5xx/4xx 分型））
- frontend/src/lib/notifications.ts（SSE 重连对齐熔断冷却+到期复查）
- frontend/src/components/circuit-banner.tsx（新增熔断横幅（订阅开合））
- frontend/src/components/app-shell.tsx（挂载横幅）
需求：部署窗口 5xx/网络错误风暴两层防护（此前 recreate 窗口用户页签被 ERR_INSUFFICIENT_RESOURCES 打废）。
根因：中断窗口内查询重试+SSE 重连滚雪球占满浏览器连接池，服务恢复后也不自愈。
方案：①api-circuit 全局熔断——连续 5 次系统性失败（网络错/超时/5xx，4xx 不计）开闸 15s 冷却，开闸期 apiFetch 短路非 auth 请求（不发网络）、SSE 重连对齐冷却、顶部横幅提示，半开探测成功自动恢复；②部署操作指引落 sillyhub-docker-deploy 技能文档（本地 .zcode 不入库，改动已生效）。
结果：熔断 5 文件 49 用例绿（状态机/短路/auth 放行/SSE 对齐/横幅），壳层回归 48 用例绿，tsc 0，eslint 0 error
审计：[gate] L1（跨 0 模块 · 12 文件：5 代码/4 测试）advisory；每文件注记缺失（--file-notes 覆盖变更文件全集）；测试增量已含
