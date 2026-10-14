---
id: task-03
title: '交互链路接线'
title_zh: '交互链路接线（原地展开 + 附近预取）'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-10-14 10:18:30
priority: P0
depends_on: ['task-01', 'task-02']
blocks: [task-04]
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-001@v1, D-003@v1, D-004@v1, D-005@v1]
expects_from:
  - contract: task-01
    needs: [mergePreviewIntoDisplayTurns]
  - contract: task-02
    needs: [TurnTimelineProps.expandPreview]
allowed_paths:
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
target_files:
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
related_tests:
  - frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx
  - frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx
goal: >
  页面装配层接线三件事（FR-01/02/03）：displayTurns 接归并函数让预览条目进消息流；
  handleExpandPreview 复用既有单轮直达链路实现原地展开（D-003 加载后保持完整）；
  导航跳转成功后异步预取相邻未加载轮（三重判重）。
implementation:
  - displayTurns 派生（frontend/src/components/daemon/session-panel/session-panel-page.tsx:2652）：enrichDisplayTurns 之后串联 mergePreviewIntoDisplayTurns(turnOutline, ...)，useMemo 依赖数组增补 turnOutline（outline 仅会话切换拉取一次，重派生成本可接受）
  - TurnTimeline 挂载点（同文件 :5103 附近）传 expandPreview={handleExpandPreview}
  - handleExpandPreview(runKey)：复用 handleJumpToTurn 单轮直达拉取实现（:2350 起同链路——大纲 run_id 请求 + 已加载状态判 + jumpEmptyJumpedRunIdsRef:794 幂等 + 会话纪元归属校验 + 卸载守卫），差异点仅两处：不 scrollIntoView（卡片在视口内）；成功后复用 highlightTurnKey 2.2s ring 自清（D-003 展开后保持完整不缩回）
  - 附近预取：handleJumpToTurn 直达成功后 fire-and-forget——按 turnOutline 序取目标轮前后各 1 个未加载轮 run_id 串行拉取，走同一写入通道（prepend/merge）；三重判重：已加载状态判 + 新增 previewPrefetchInflightRef（Set<string>，在飞去重，会话切换清空）+ jumpEmptyJumpedRunIdsRef 零正文幂等；预取失败静默
  - 游标一致性：直达/预取轮按既有先例把「加载更早」起点压到该轮最旧行（session-panel-page.tsx:2402 先例机制自然继承），防后续触顶翻页整轮重复（R-03/R-04）
acceptance:
  - 打开长会话消息流呈现全量轮次（已加载完整 + 未加载预览卡）；大纲拉取失败时页面降级为现状形态不报错
  - 点预览卡原地替换为完整轮块（同屏无双块）+ 2.2s 高亮；重复点击不重复请求
  - 跳转第 N 轮后前后未加载轮自动补入；在飞期间重复跳转不重复请求；既有跳转/翻页行为无回归
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/session-history-scroll.test.tsx "src/app/(dashboard)/sessions/__tests__/page.test.tsx"
constraints:
  - 不改「加载更早」翻页、跳转三抑制窗、prepend 锚钉回、SSE 流、孤儿门控、静默配置行语义（design 非目标）
  - 不派生第二个消息流数据源（D-004 单一列表源铁律）
  - 预取不引入轮询/定时器
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
