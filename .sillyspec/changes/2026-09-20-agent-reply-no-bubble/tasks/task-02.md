---
id: task-02
title: 'De-bubble legacy-path agent reply in turn-timeline'
title_zh: '旧路径同步——turn-timeline 旧数据答复气泡换同款无框容器'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-20 17:51:06
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1, D-002@v1, D-005@v1]
allowed_paths:
  - frontend/src/components/daemon/turn-timeline.tsx
target_files:
  - frontend/src/components/daemon/turn-timeline.tsx
goal: >
  把旧数据回退路径的 agent 答复气泡（frontend/src/components/daemon/turn-timeline.tsx:696 的
  .turn-bubble 卡片）换成与 v2 主路径同款的 seg-text-body 无框容器，保持行尾时间戳尾随内容
  边缘的既有节奏（容器不取 w-full，内容自适应宽度），实现双路径视觉形态一致。
implementation:
  - 修改 frontend/src/components/daemon/turn-timeline.tsx:696 旧路径答复容器——类名 turn-bubble 换 seg-text-body，样式由 max-w-[82%] rounded-2xl rounded-tl-md border bg-card px-4 py-2.5 shadow-sm 换为 max-w-[min(100%,48rem)]（无框无内边距，不取 w-full，保持 flex 行内与行尾时间戳并排的自适应宽度语义）
  - 保持外层 flex items-start gap-2.5 头像行与 flex items-end gap-1.5 时间戳行结构不动，HugeOutputBlock / 流式光标 .sh-stream-caret / askuser 纯标记分支逻辑全部不动
  - 注释同步——:687 旧路径单气泡注释与 :548 附近 turn-bubble 相关注释改为「turn-bubble 仅用户气泡」语义，ql-20260915-009 的 mobile 定位说明按新类名口径改写
acceptance:
  - 旧路径答复容器存在 .seg-text-body 类且不含 border / bg-card / shadow / rounded-2xl / px-4 py-2.5
  - 行尾时间戳（turn.replyAt）仍渲染在答复内容右侧同行尾随（不被推到行右缘）
  - 用户气泡（frontend/src/components/daemon/turn-timeline.tsx:550）的 .turn-bubble 类名与样式字符串零改动
  - turn-timeline.tsx 内除用户气泡外无 .turn-bubble 残留
verify:
  - cd frontend && pnpm exec vitest run "src/app/(dashboard)/sessions/__tests__/page.test.tsx"
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 只动旧路径答复气泡容器与相关注释，不改 SegmentedTurnBody / 用户气泡 / 引导消息三态气泡 / AskUser 卡 / 文件卡
  - 不改 HugeOutputBlock 与 isLiveTurn 逻辑
  - sessions page.test 断言用户气泡 .turn-bubble（frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx:976），改后必须仍绿（不在此改测试，测试文件归 task-03 权限面之外除非断言失效）
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
