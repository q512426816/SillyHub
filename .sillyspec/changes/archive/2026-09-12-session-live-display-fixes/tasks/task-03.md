---
id: task-03
title: '运行中轮计时锚点优先 run 快照（FR-4.1/4.2）'
title_zh: '运行中轮计时锚点优先 run 快照（FR-4.1/4.2）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-13 00:24:41
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-4.1, FR-4.2]
decision_ids: []
allowed_paths:
  - frontend/src/components/daemon/session-panel/page-helpers.tsx
  - frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx
target_files:
  - frontend/src/components/daemon/session-panel/page-helpers.tsx
  - frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx
goal: >
  修复运行中轮 elapsed 计时锚点漂移（窗口派生锚点压过 run 快照）：enrichDisplayTurns.enrichOne 对活跃态轮强制采用 runsMeta 快照 started_at，重连/窗口滑动后计时不重置。
implementation:
  - page-helpers.tsx enrichOne（约 L195-225）：计算 snapshotAnchor = parseRunStartedAt(meta.started_at)；当 meta.status 属活跃词表 {running, pending, pending_approval} 且 snapshotAnchor 非 null 时 turnStartedAt 取 snapshotAnchor（覆盖本地值）；否则维持现有 t.turnStartedAt ?? snapshotAnchor 链。
  - 身份稳定守卫（changed 比对）保持：仅值真正变化才产出新对象。
  - 注释说明覆盖语义（窗口派生锚点不可靠根因：logsToTurns firstLogTimestampMs 受 limit 窗口截断）与终态轮不覆盖的理由。
  - 测试：running 轮 + 快照 started_at 则锚点取快照（本地窗口锚点被覆盖）；pending 且 started_at null 则不覆盖；终态轮 ?? 链不变；快照值稳定时引用不变（memo 守卫）。
acceptance:
  - running/pending_approval 轮计时锚点恒等于 run 快照 started_at（可解析时）。
  - 终态轮/占位轮行为零回归；引用稳定性用例绿。
verify:
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/runtime-session-helpers.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不改 logsToTurns 的 firstLogTimestampMs（历史轮锚点语义保留）。
  - 活跃词表以 backend agent/model.py 状态词表为准（running/pending/pending_approval）。
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
