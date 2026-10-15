---
id: task-07
title: 'frontend 单聊引擎选项——session-list-panel.tsx SESSION_ENGINE_OPTIONS 加 dsh + 快照测试（FR-08）'
title_zh: 'frontend 单聊引擎选项——session-list-panel.tsx SESSION_ENGINE_OPTIONS 加 dsh + 快照测试（FR-08）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 12:45:27
priority: P0
depends_on: ['task-05']
blocks: []
requirement_ids: [FR-08]
decision_ids: []
allowed_paths:
  - frontend/src/components/sessions/session-list-panel.tsx
  - frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx
target_files:
  - frontend/src/components/sessions/session-list-panel.tsx
  - frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx
goal: >
  前端单聊引擎选项放开 dsh：SESSION_ENGINE_OPTIONS 加 dsh 选项（单一源），群聊 ENGINE_OPTIONS 不动。
implementation:
  - frontend/src/components/sessions/session-list-panel.tsx 的 SESSION_ENGINE_OPTIONS 追加 dsh 项（label/图标/值，照既有 codex/pi 项形态；caps 相关展示如 PROVIDER_SWITCH_ENGINES 由镜像自动派生不手改）
  - frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx 补断言：引擎下拉含 dsh 选项；群聊白名单不含 dsh（阶段 2 边界钉死）
acceptance:
  - 单聊创建入口可选 dsh；群聊六要素白名单不含 dsh
  - 既有页面测试零回归
verify:
  - cd frontend && pnpm exec vitest run src/app/\(dashboard\)/sessions/__tests__/page.test.tsx
constraints:
  - 不动 create-group-wizard.tsx / member-panel.tsx 的群聊白名单（ENGINE_OPTIONS/GROUP_SUPPORTED_PROVIDERS——阶段 2 范围）；样式走既有主题 token
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
