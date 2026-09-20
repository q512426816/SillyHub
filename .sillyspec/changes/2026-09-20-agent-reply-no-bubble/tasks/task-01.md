---
id: task-01
title: 'De-bubble v2 TextSegmentView via seg-text-body'
title_zh: 'v2 主路径去气泡——TextSegmentView 换无框 seg-text-body 容器并删子代理透明化补丁'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-20 17:51:06
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1, D-004@v1, D-005@v1]
allowed_paths:
  - frontend/src/components/daemon/turn-segment-views.tsx
target_files:
  - frontend/src/components/daemon/turn-segment-views.tsx
goal: >
  把 v2 段模型文本段容器（TextSegmentView 的 .seg-text-bubble 卡片气泡）换成无框正文容器
  .seg-text-body（无边框/底色/阴影/内边距，max-width min(100%,48rem)），使 agent 回复铺在
  时间线背景上；同时删除 SEGMENT_ANIMATION_CSS 中子代理透明化覆盖（去气泡后天然无框，冗余）。
implementation:
  - 修改 frontend/src/components/daemon/turn-segment-views.tsx:509 TextSegmentView 容器类名与样式——由 group relative max-w-[80%] self-start rounded-2xl rounded-tl-md border border-border/60 bg-card px-4 py-2.5 shadow-sm 换为 group relative w-full max-w-[min(100%,48rem)] self-start（类名 seg-text-bubble 改 seg-text-body）
  - 删除同文件 SEGMENT_ANIMATION_CSS 内 .seg-subagent-body .seg-text-bubble 透明化规则块（frontend/src/components/daemon/turn-segment-views.tsx:107-113），文件头「与原型的两处已知偏差」说明第 2 条同步改写（子代理文本现天然无框，不再是偏差）
  - 相关注释同步——组件 docstring「文本段 markdown 气泡」措辞改为「无框正文」，保留 CopyButton 与 .seg-caret 挂载逻辑不动
acceptance:
  - 渲染含 text 段的 turn 时容器存在 .seg-text-body 类且不含 border / bg-card / shadow / rounded-2xl / px-4 py-2.5 任意一个
  - 容器 max-width 为 min(100%,48rem)（w-full + max-w 工具类组合）
  - CopyButton（aria-label 复制）与流式光标 .seg-caret 挂载行为与改前一致
  - 全文件 grep 无 .seg-text-bubble 残留（含 SEGMENT_ANIMATION_CSS 与注释）
verify:
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/turn-segment-views.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不改 turn-segment-views.tsx 内其它段组件（思考行/工具行/子代理块结构不动）
  - 不动 CopyButton 组件本身与 .seg-caret 样式定义
  - 用户气泡相关代码不在本文件，禁止顺手改
  - 测试断言更新归 task-03，本 task 只保证既有测试不因容器类名变化而误伤（turn-segment-views.test 未直接断言容器类名，预计零改动）
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
