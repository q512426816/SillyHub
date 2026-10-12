---
id: task-02
title: 'F2b message fragment coalescing - NEW message-coalescer.ts (buffer by message id, TTL/cap flush) + event-wire integration + segment_id residual cleanup audit + unit tests'
title_zh: 'F2b 消息碎片合并——NEW message-coalescer.ts（message id 缓冲/TTL 冲刷）+ event-wire 接入 + segment_id 残留核查 + 单测'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-12 21:01:59
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-004@v1]
allowed_paths:
  - NEW:sillyhub-daemon/src/agent-log/message-coalescer.ts
  - NEW:sillyhub-daemon/tests/agent-log/message-coalescer.test.ts
  - sillyhub-daemon/src/event-wire.ts
  - sillyhub-daemon/tests/event-wire.test.ts
  - backend/app/modules/daemon/run_sync/service/submit_steps.py
target_files:
  - NEW:sillyhub-daemon/src/agent-log/message-coalescer.ts
  - NEW:sillyhub-daemon/tests/agent-log/message-coalescer.test.ts
  - sillyhub-daemon/src/event-wire.ts
  - sillyhub-daemon/tests/event-wire.test.ts
  - backend/app/modules/daemon/run_sync/service/submit_steps.py
related_tests: [sillyhub-daemon/tests/event-wire.test.ts]
goal: >
  同一助手消息最终只落一行完整内容：daemon wire 层按 message id 缓冲合并流式
  delta，消息完结时输出单行，消除生产会话 47e2ff1a 实证的「同一助手消息拆成
  十几个重复/截断片段行 + THINKING 重复」。
implementation:
  - ①新增 NEW:sillyhub-daemon/src/agent-log/message-coalescer.ts：纯函数缓冲器，按 message id 缓冲连续 assistant/thinking 流式 delta（缓冲键取事件实际携带的消息/段标识，以 sillyhub-daemon/src/adapters/stream-json.ts parseAssistant/parseStreamEvent 实际字段为准、接入时核查），message 完结事件到达时输出单行完整内容
  - ②防泄漏（design R-02）：无完结事件的缓冲达 TTL 或缓冲上限时按序冲刷为独立行（宁可碎片不丢内容）；turn/message 边界隔离清理
  - ③sillyhub-daemon/src/event-wire.ts 接入：:149-156 流式分支现原始 delta 直发（碎片化根因落点），改经缓冲器输出；不重构 stream-json adapter 事件模型（design 非目标）
  - ④核查 backend/app/modules/daemon/run_sync/service/submit_steps.py segment_id partial→final 覆盖链路（:239-253 [THINKING_OVERRIDE] 信号 + st.completed_segments 去重、:754 _override_marker_content / :764 _override_marker_exists）在 claude 流式路径的覆盖面，补删残留 partial 行
  - ⑤新增 NEW:sillyhub-daemon/tests/agent-log/message-coalescer.test.ts（delta 序列→单行；无完结 TTL 冲刷不丢内容；跨消息隔离）
acceptance:
  - 同一 message id 的 3 个流式 delta（"A"/"B"/"C"）+ 完结事件 → wire 输出恰 1 条 content="ABC" 完整行，无独立 delta 行残留（FR-03 场景·delta 合并）
  - 某 message 只有 delta 无完结事件且缓冲达 TTL → 已缓冲内容按序输出为独立行，内容零丢失（FR-03 场景·缓冲不丢失）
  - 两个不同 message id 的 delta 序列互不串缓冲；daemon 既有 golden（sillyhub-daemon/tests/event-wire.test.ts）零回归或断言更新与新语义一致
verify:
  - cd sillyhub-daemon && pnpm test -- tests/agent-log/message-coalescer.test.ts tests/event-wire.test.ts
constraints:
  - 纯函数请求内缓冲，不引入长驻进程/外部资源（design R-08 生命周期面不适用）；合并在 wire 转换层做，不动 adapter 协议
  - 任何异常序列（乱序/完结缺失/TTL 边界）下不丢内容，至多退化为碎片行
  - 规则 0：只跑 verify 列相关测试，不跑全量套件
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
