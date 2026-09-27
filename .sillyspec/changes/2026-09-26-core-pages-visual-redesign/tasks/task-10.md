---
id: task-10
title: '会话门户中栏展示层 Primer 化（含四分支）+ 测试同步'
title_zh: '会话门户中栏展示层 Primer 化（含四分支）+ 测试同步'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-27 00:40:13
priority: P0
depends_on: ['task-09']
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-001@v1, D-003@v1]
allowed_paths:
  - frontend/src/components/daemon/session-panel/
  - frontend/src/components/sessions/sessions-portal.tsx
  - frontend/src/components/sessions/pre-session-picker.tsx
  - frontend/src/app/(dashboard)/sessions/__tests__/
related_tests:
  - frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx
target_files:
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
expects_from:
  task-02:
    needs: [StateLabel, EmptyState]
goal: >
  会话门户中栏（session-panel-page.tsx 4615 行）与 portal 四分支展示层 Primer 化：
  消息块/代码块/工具调用胶囊/输入区按原型重做；红线=只动 render 与样式类。
implementation:
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx：用户消息=浅蓝语义底圆角块右对齐、agent 消息=白底细边框块+头像+名字+引擎灰字、代码块=#f6f8fa 等价主题 token 底 mono 细边框、工具调用行=mono 胶囊「⚙ 动作 +详情」；会话头部（标题+引擎 StateLabel+操作图标组）Primer 化；输入区=细边框圆角大输入框+发送按钮（对齐原型）
  - frontend/src/components/sessions/sessions-portal.tsx 中栏四分支全覆盖：群聊面板/真会话/预会话（pre-session-picker.tsx:287 同风格化）/空门户（虚线框渐变图标引导态换 primer EmptyState）
  - 保留：消息流滚动到底、SSE/WS 数据流、运行态/恢复态文案与行为、Mobile variant 分支不动
  - 同步修 session-panel 相关既有测试断言
acceptance:
  - 中栏四分支对照原型「会话」视图中栏一致；空门户为 EmptyState
  - 状态机/props/数据流 diff 为零（仅 render 与样式类）
  - 既有测试全绿
verify:
  - cd frontend && pnpm vitest run src/components/daemon/session-panel src/components/sessions "src/app/(dashboard)/sessions"
  - cd frontend && pnpm typecheck
constraints:
  - 红线：MUST NOT 改动 props 接口/状态机/轮询/WS 消息处理（仅 render 与样式类）
  - "[data-variant=mobile] 排版块零改动（移动端已有独立规范）"
  - MarkdownText 渲染器内部零改动（仅外层容器样式）
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
