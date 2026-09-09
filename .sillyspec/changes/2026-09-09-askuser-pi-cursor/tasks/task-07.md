---
id: task-07
title: 'askuser-marker-card-turn-timeline'
title_zh: 'AskUserMarkerCard + turn-timeline 渲染接入 + 已答态 best-effort 判定 + 单测'
author: 'qinyi'
created_at: 2026-09-09 23:09:21
priority: P0
depends_on: ['task-06']
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-003@v2]
allowed_paths:
  - frontend/src/components/ask-user-marker-card.tsx
  - frontend/src/components/ask-user-marker-card.test.tsx
  - frontend/src/components/daemon/turn-timeline.tsx
  - frontend/src/components/daemon/__tests__/turn-timeline-attachment-markers.test.tsx
  - frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx
  - frontend/src/components/daemon/__tests__/turn-timeline-dialog-minimize.test.tsx
  - frontend/src/components/daemon/__tests__/turn-timeline-scroll.test.tsx
  - frontend/src/components/daemon/__tests__/turn-timeline-session-input-bar.test.tsx
target_files:
  - NEW:frontend/src/components/ask-user-marker-card.tsx
  - NEW:frontend/src/components/ask-user-marker-card.test.tsx
  - frontend/src/components/daemon/turn-timeline.tsx
expects_from:
  task-06:
    - contract: parseAskUserMarker
      needs: [parseAskUserMarker, AskUserMarkerPayload]
related_tests:
  - frontend/src/components/daemon/__tests__/turn-timeline-attachment-markers.test.tsx
  - frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx
  - frontend/src/components/daemon/__tests__/turn-timeline-dialog-minimize.test.tsx
  - frontend/src/components/daemon/__tests__/turn-timeline-scroll.test.tsx
  - frontend/src/components/daemon/__tests__/turn-timeline-session-input-bar.test.tsx
goal: >
  新增 AskUserMarkerCard 提问卡并接入 turn-timeline 文本段渲染（命中即原位渲染卡片并隐藏标记原文，含持久化历史文本），已答态本地 best-effort 判定，提交组装答案经既有发送链路作下一条用户消息续轮。
implementation:
  - '新建 frontend/src/components/ask-user-marker-card.tsx（视觉对齐原型场景三 ask-card：提问徽章 + 引擎副行「本轮结束，你的回答将作为下一条消息自动发送」+ 问题行 + 选项列表 + 提交并发送按钮；allowCustom 或 input/editor 形态带文本输入；recommendResponders 渲染推荐 @条，样式对齐原型场景二）'
  - 'turn-timeline.tsx 双路径接入：旧路径 turn.output 气泡与 v2 路径 SegmentedTurnBody 对话视图 text 段（textSegments.map 处）均先过 parseAskUserMarker——命中则该气泡原位渲染 AskUserMarkerCard 并以 textBefore 替换正文（标记原文不显示）；解析返回 null 按普通文本渲染零变化'
  - 已答态 best-effort 判定：该 marker 轮之后已存在用户消息（后续 turn 有 prompt，会话日志既有数据，无后端状态）即渲染已答关闭态；启发式仅展示层语义，不区分回答与无关插话（design §Wave B.3）
  - '提交组装（design §Wave B.4）：select→所选 label（自定义时用输入文本）、confirm→是/否、input/editor→输入文本，经既有 onResend 发送链路发出（cursor --resume 续轮天然生效），发送后卡片转已答态'
  - 新建 ask-user-marker-card.test.tsx（渲染/提交组装/已答态/解析 null 降级不渲染卡）；turn-timeline 系列既有测试若断言文本段渲染结构需同步适配（related_tests 五文件）
acceptance:
  - 带 ```askuser 尾块的消息（流式与历史同一解析器）渲染为提问卡且标记原文不可见；无标记消息渲染零变化
  - marker 轮之后存在用户消息时卡片呈已答关闭态；提交按 kind 正确组装答案并触发 onResend
  - 新增测试与 turn-timeline 适配测试全绿
verify:
  - cd frontend && pnpm vitest run src/components/ask-user-marker-card.test.tsx
  - cd frontend && pnpm vitest run src/components/daemon/__tests__/turn-timeline-attachment-markers.test.tsx src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx src/components/daemon/__tests__/turn-timeline-dialog-minimize.test.tsx src/components/daemon/__tests__/turn-timeline-scroll.test.tsx src/components/daemon/__tests__/turn-timeline-session-input-bar.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不经后端 dialog 管道（无 pending 行/答题端点/PERMISSION_RESPONSE 依赖），答案只走既有发送消息链路
  - 不改 turn-segment-views.tsx 与 session-log-assembler（marker 接入收敛于 turn-timeline.tsx 渲染层）；spike 不达标仍交付（协议资产不删）
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
