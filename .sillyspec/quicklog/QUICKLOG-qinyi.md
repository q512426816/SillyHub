
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
