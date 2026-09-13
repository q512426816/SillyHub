---
id: task-02
title: 'dropPrefixPartialReply 全桶前缀收编 + F7 cell 失效（FR-1.2/1.3/1.4）'
title_zh: 'dropPrefixPartialReply 全桶前缀收编 + F7 cell 失效（FR-1.2/1.3/1.4）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-13 00:24:41
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-1.2, FR-1.3, FR-1.4]
decision_ids: [D-001@v1]
depends_on: [task-01]
allowed_paths:
  - frontend/src/components/daemon/session-log-assembler.ts
  - frontend/src/components/daemon/__tests__/session-log-assembler.test.ts
target_files:
  - frontend/src/components/daemon/session-log-assembler.ts
  - frontend/src/components/daemon/__tests__/session-log-assembler.test.ts
goal: >
  修复完整回复行只收编桶尾单个 partial 的缺陷（pi 消息 THINKING 行先到把 partial 挤开导致前缀碎片气泡存活）：dropPrefixPartialReply 扩为全桶扫描收编，并附 F7 增量投影 cell 失效硬约束（审查 P1-1），保证直播装配与历史装配等价。
implementation:
  - dropPrefixPartialReply（session-log-assembler.ts 约 L1583）改全桶扫描：applyToBucket 内遍历全部 children，凡 kind===text 且 segId 非空且 fullText.startsWith(text) 的段移除并逐个 onSeal(segId)；非前缀（内容分叉/丢窗口胶水段）保留由 task-01 令箭撤回兜底；返回值附带「是否实际移除」信号（如返回 {segments, removedCount} 或由调用方比较桶长度）。
  - applyLogToSegments reply 分支（约 L1231-1258）：接住移除信号，实际移除大于 0 时使该 turn 的 F7 增量 cell 失效（本条 log 走全量重投影：prevCell 视为 null），防御「中位 partial 移除后增量路径产出含已删文本的 stale output」（触发序 [partialB(s1), fullX] + fullB）。
  - 更新函数注释与 design R1.2 对应关系（含 F7 约束引用）。
  - 测试：桶尾被 thinking 段隔开时前缀 partial 仍被收编用例；pi 三行序（THINKING-OVERRIDE-ASSISTANT）直播装配 vs 历史装配等价集成用例；F7 对拍用例——中位移除后增量投影 output 与 segmentsToLegacy 全量重投影逐字节一致。
acceptance:
  - pi 三行序场景直播产物与历史产物等价（无重复/碎片 text 段）。
  - F7 对拍用例绿（增量值 === 全量重投影值）。
  - 既有 dropPrefixPartialReply 尾位用例与 quick-9f86d2c3 反向收编用例零回归。
verify:
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/session-log-assembler.test.ts
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 仅收编 segId 非空的流式派生段；完整行段（segId null）与用户消息不参与判定。
  - 不改 appendStreamText 的 merge 纯度规则（ql-20260820-011 语义保持）。
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
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
