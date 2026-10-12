---
id: task-05
title: 'F5b interrupted tool-call log backfill - audit tool_call emission timing on daemon interrupt/deny paths and backfill (rejection-pair result present implies tool_call row present) + tests'
title_zh: 'F5b 打断工具调用补日志——daemon 中断/拒绝路径核查 tool_call 发射时序并补发 + 测试'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-12 21:01:59
priority: P1
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/event-wire.ts
  - sillyhub-daemon/src/interactive/permission-resolver.ts
  - sillyhub-daemon/tests/event-wire.test.ts
target_files:
  - sillyhub-daemon/src/event-wire.ts
  - sillyhub-daemon/tests/event-wire.test.ts
related_tests: [sillyhub-daemon/tests/event-wire.test.ts]
goal: >
  run 中断/工具拒绝路径保证「有拒绝结果必有对应 tool_call 行」（FR-06·拒绝有痕）：
  生产实证 run27 打断的工具调用只有拒绝对结果日志、无 tool_call 行，工具调用
  不留痕。
implementation:
  - ①定位打断时 tool_call 行未发射/未提交的时序缺口（两处候选，调查确认后按证据落修）：其一 sillyhub-daemon/src/event-wire.ts:222-233 tool_use decline 分支只发 [APPROVAL:DECLINE] stderr 行、不发 tool_call JSON 行（对照 allow 路径 :267-313 双行输出）；其二 interrupt 路径 sillyhub-daemon/src/interactive/session-manager/turn-control.ts:451（:466 abortAll("session_interrupted") → sillyhub-daemon/src/interactive/permission-resolver.ts:281 abortAll 全 deny）时在途 tool_use 的 tool_call 行未补发
  - ②修复（复用 event-wire 补发）：decline 分支补发 tool_call JSON 行（工具名+入参，status 携带拒绝语义）；中断路径对在途 tool_use flush 待发 tool_call 行
  - ③复现测试：「拒绝结果存在而 tool_call 缺失」事件序列写失败测试，先红后绿——decline 分支序列复现入 sillyhub-daemon/tests/event-wire.test.ts，interrupt 路径序列复现入 sillyhub-daemon/tests/interactive/session-interrupt.test.ts（既有 spike D1 级联调先例）
  - ④更新既有 sillyhub-daemon/tests/event-wire.test.ts:187 decline 单行断言为新语义（[APPROVAL:DECLINE] 行 + tool_call 行两行）
acceptance:
  - 复现测试修复前红（拒绝对结果存在、tool_call 行缺失）、修复后绿（对应 tool_call 行在场，含工具名+入参；FR-06 场景·拒绝有痕）
  - 正常 allow 路径与 interrupt 无在途工具调用时不产生多余日志行，sillyhub-daemon/tests/interactive/session-interrupt.test.ts 既有断言零回归
verify:
  - cd sillyhub-daemon && pnpm test -- tests/event-wire.test.ts tests/interactive/session-interrupt.test.ts
constraints:
  - 只补发缺失日志行，不改 interrupt/审批语义（abortAll fail-closed deny 语义保持）
  - 零 wire 结构变更（复用既有 tool_call channel JSON 形态，status 字段扩展拒绝取值，对齐既有 "allowed" 取值模式）
  - 规则 0：只跑 verify 列相关测试，不跑全量套件
<!-- 执行期对账修正（verify 收口，与该 task review 结论一致）：target_files 移除 sillyhub-daemon/src/interactive/session-manager/turn-control.ts, sillyhub-daemon/tests/interactive/session-interrupt.test.ts —— turn-control 调查结论：abortAll 全 deny 经 approval_decision=decline 同一事件形态，补口落 event-wire decline 分支，turn-control 零改动；session-interrupt.test.ts 既有断言零回归未改动 -->

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
