
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
