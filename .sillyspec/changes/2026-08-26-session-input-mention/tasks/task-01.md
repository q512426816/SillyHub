---
id: task-01
title: implement-session-mention-pure-utils
title_zh: 会话输入联想触发检测与选中回填纯函数及 jsdom 单测
author: qinyi
created_at: 2026-08-26 23:43:50
priority: P0
depends_on: []
blocks: [task-02]
requirement_ids: [FR-01, FR-04]
decision_ids: [D-002]
allowed_paths:
  - frontend/src/lib/session-mention.ts
  - frontend/src/lib/__tests__/session-mention.test.ts
provides:
  - contract: MentionDetection
    fields: [trigger, query, start]
  - contract: applyMentionPick
    fields: [value, caret]
goal: >
  新建 session-mention.ts 纯函数模块，提供 detectMention 词首触发检测与
  applyMentionPick 选中回填，供 task-02 浮层与 task-03 输入框接入消费。
implementation:
  - 新建 frontend/src/lib/session-mention.ts，导出 detectMention(value, caretIndex)，光标向左回看，触发字符仅行首或空格之后命中，返回含 trigger 与 query 与 start 的对象，否则返回 null
  - 从触发字符到光标的查询串含任何空白即返回 null（空白中断关浮层），非词首的 / 或 @ 不触发
  - 导出 applyMentionPick(value, mention, insertKey)，把 start 到光标片段替换为触发字符加 insertKey 加一个尾随空格，返回新文本与新光标位置
  - 新建 src/lib/__tests__/session-mention.test.ts，覆盖行首与空格后触发、非词首不触发、空白查询返回 null、/ 与 @ 回填后文本与光标位置
  - 用例含 /team 回填断言——回填后文本带尾随空格（浮层检测归零自动关闭），整条 /team 前缀仍命中既有 parseTeamCommand 拦截
acceptance:
  - detectMention 对行首与空格后的 / 或 @ 返回正确 trigger 与 query 与 start，非词首与含空白查询返回 null
  - applyMentionPick 回填带尾随空格，返回光标位于插入片段之后，@ 回填用无空格自然键
  - 回填 /team 后整条 /team 拦截兼容，既有剥离前缀语义不受影响
  - 模块零副作用，不依赖 React 与 DOM API
verify:
  - cd frontend && pnpm exec vitest run src/lib/__tests__/session-mention.test.ts
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 仅纯函数，不含 React hooks 与组件逻辑（浮层归 task-02，接入归 task-03）
  - 检测返回字段名用 start（非 startIndex），task-02 与 task-03 按此契约消费
  - 不处理 IME 与键盘事件（composition 保护归 task-03）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
