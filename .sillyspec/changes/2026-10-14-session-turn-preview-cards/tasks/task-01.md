---
id: task-01
title: '归并纯函数与类型扩展'
title_zh: '归并纯函数与类型扩展（preview-merge.ts）'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-10-14 10:18:30
priority: P0
depends_on: []
blocks: [task-02, task-03]
requirement_ids: [FR-01, FR-02, FR-04]
decision_ids: [D-004@v1, D-002@v1]
provides:
  - contract: task-02
    fields: [SessionTurnView.preview, mergePreviewIntoDisplayTurns]
  - contract: task-03
    fields: [mergePreviewIntoDisplayTurns]
allowed_paths:
  - frontend/src/components/daemon/session-panel/preview-merge.ts
  - NEW:frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts
  - frontend/src/components/daemon/turn-timeline.tsx
target_files:
  - NEW:frontend/src/components/daemon/session-panel/preview-merge.ts
  - NEW:frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts
  - frontend/src/components/daemon/turn-timeline.tsx
goal: >
  建立单一数据源归并层：把 turn-outline 大纲条目与已加载真实轮归并为消息流统一列表（D-004 方案 A），
  未加载轮合成带 preview 摘要的预览条目；纯函数外提可独立单测，为渲染层与交互层提供数据基座。
implementation:
  - 'frontend/src/components/daemon/turn-timeline.tsx SessionTurnView 接口新增可选字段 preview（promptSummary/answerSummary 两可选串，仅类型不动渲染）'
  - 'NEW:frontend/src/components/daemon/session-panel/preview-merge.ts 导出 mergePreviewIntoDisplayTurns(outline, turns)：大纲 items seq 升序为骨架；已加载轮按 realRunId ?? runId 索引命中透传原引用（口径同 session-panel-page.tsx:293 mergeTurnNavEntries loadedByKey）；未加载轮合成 SessionTurnView 形状预览条目（runId=item.run_id、status 经 mapRunStatus、whoLine/sender 从大纲字段构造、preview 摘要、prompt/output 置空串）；孤儿轮（turns 有大纲无）尾部追加（同 mergeTurnNavEntries:316 口径）；outline 为 null/空 → 原样返回 turns（FR-04 降级）'
  - '先写 NEW:frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts 再实现：轮序与大纲 seq 一致 / 已加载命中透传原引用 / 加载后同键原位替换无双块 / 孤儿尾部追加 / 空大纲降级 / preview 字段缺省形状'
acceptance:
  - mergePreviewIntoDisplayTurns 全部单测绿：轮序/替换/孤儿/降级/缺省五组用例
  - turn-timeline.tsx 仅新增类型字段，既有渲染路径零改动（digest diff 审查确认）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/components/daemon/session-panel/__tests__/preview-merge.test.ts
constraints:
  - 不修改 backend/ 与 sillyhub-daemon/（D-002）
  - 不引入新网络请求；归并函数纯函数无副作用
  - 不改 mergeTurnNavEntries 既有实现（导航列链路零回归）
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
