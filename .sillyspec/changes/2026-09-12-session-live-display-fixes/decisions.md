---
author: qinyi
created_at: 2026-09-13 00:02:55
---

# 决策记录 — 2026-09-12-session-live-display-fixes

## D-001@v1：直播碎片气泡修复走「前端全树撤回 + 全桶前缀收编」还是改 daemon segmentId 协议？

- type: architecture
- module: frontend
- source: user
- question: pi 引擎直播碎片气泡（partial 半截气泡 + 全文气泡并存，刷新恢复）有两条修复路径：A) 前端按既有协议语义修复（revokePartialSegments 全树扫描撤回 + dropPrefixPartialReply 全桶前缀收编）；B) 改 daemon pi segmentId 加 `main:` 前缀归一路由协议。
- answer: 用户在前一轮诊断报告（含推荐修复方案）后指示「都要修复，并且要优化体验」，等于选定方案 A。理由：零协议变更、不用 daemon/backend 协同发布、立即覆盖所有引擎与存量会话；且 backend quick-0e56260f 合成撤回令箭的注释本就声明「前端据令箭按段 id 任意位置撤回」——A 是把实现补齐到协议已声明的语义，不是新协议。B 被否：需双端同步发布、跨版本窗口更长、pi 的 msg/ci 编号语义会被 main: 前缀吞掉。
- evidence: 2026-09-12 诊断会话（会话 d4c29d95 排查报告 + 用户「都要修复，并且要优化体验」指令）；backend submit_steps.py quick-0e56260f 注释；前端 session-log-assembler.ts revokePartialSegments 前缀路由实现。

## D-002@v1：纯切换轮是否跳过 turn_count 与 user_input 落库？

- type: architecture
- module: backend
- source: user
- question: 纯切换供应商轮（config_switch 且空 prompt）当前无条件写空 user_input 行 + turn_count+1，与 inject.py 既有注释「静默切换轮无 user_input 日志 → 时间线不渲染」矛盾。修法：只跳过写入/计数（run 照建），还是连 run 也不建？
- answer: 跳过 user_input 写入与 turn_count 递增，run 照建。理由：前端紧凑配置行（ql-20260818-011）与 runsMeta 对账依赖 run 行存在；不建 run 会破坏该渲染与 runs 列表语义。存量空行不迁移（项目未上线、前端已把空轮渲染为紧凑行，无用户可见危害）。
- evidence: inject.py `_inject_into_session` user_input 无条件落库段与其上方 ql-20260817-010 注释；page-helpers.tsx orphanTurns 静默切换 run 消费链。

## D-003@v1：失败卡 code 误显修复口径

- type: architecture
- module: sillyhub-daemon
- source: user
- question: daemon extractCode 第 3 兜底（裸三位数字当 HTTP 码）误抓 `[silent stream truncation] ...（api_calls=116, ...）` 的 116。收紧方式：A) 删除裸数字分支（保留 4 个上下文锚定模式：括号/HTTP 前缀/status:/http=）；B) 仅加 `api_calls=` 负向断言。
- answer: A（裸数字分支替换为 HTTP 原因短语锚定分支 (\d{3})\s+[A-Z][a-z]——复审升级：纯删除会破 401/502 既有断言，替换方案零破坏），另对 `[silent stream truncation]` 签名给专属中文文案（「上游输出流中断」），ModelError.type 维持 provider_error 不动（backend auto-recovery TRANSIENT_ERROR_TYPES 判定依赖，零分类学变更）。理由：裸数字分支本身无锚定、任何含三位数的正文都可能误报，B 只堵单个实例。
- evidence: daemon model-error/classifier.ts extractCode 实现；agent_runs.error_detail 实测（code "116" 与 api_calls=116 同源）；backend auto_resume.py TRANSIENT_ERROR_TYPES。

## D-004@v1：自动续跑链到上限停跑时是否给用户可感知提示？

- type: architecture
- module: backend
- source: user
- question: 2026-09-12 15:11 会话 d4c29d95 续跑链第 2 次被静默断流打断，backend auto_recover_nudge_chain_limit 按防循环守卫（G7 链上限 2）停跑交回用户——用户只见「供应商异常」失败卡，不知道为何不再自动续、该做什么。是否补用户提示？
- answer: 补。chain-limit 分支对刚终态 run 覆写 error_detail.hint 为明确指引文案 + auto_resume_stopped=true 标记；type/code/raw 原值不动（auto-recovery 判定与既有断言零影响）；前端失败卡已渲染 hint，零前端改动。未到上限路径不写。
- evidence: auto_resume.py chain-limit 分支（auto_recover_nudge_chain_limit 后纯 return）；当日生产日志实证；backend log 2× auto_recover_enqueued vs 1× chain_limit。
