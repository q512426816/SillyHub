---
id: task-09
title: 'frontend-tests-pin-rename-and-scheduled-messages'
title_zh: '前端测试（session-list-panel 补置顶/重命名用例 + scheduled-messages-bar/use-scheduled-messages 新测试）'
author: 'qinyi'
created_at: 2026-09-07 23:32:39
priority: P0
depends_on: ['task-07', 'task-08']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/components/sessions/__tests__/
  - frontend/src/components/daemon/__tests__/scheduled-messages-bar.test.tsx
  - frontend/src/hooks/__tests__/use-scheduled-messages.test.ts
target_files:
  - frontend/src/components/sessions/__tests__/session-list-panel.test.tsx
  - NEW:frontend/src/components/daemon/__tests__/scheduled-messages-bar.test.tsx
  - NEW:frontend/src/hooks/__tests__/use-scheduled-messages.test.ts
goal: >
  为 task-07/08 的前端实现补齐测试——session-list-panel 既有测试文件补置顶按钮显隐/回调/
  行内重命名/置顶徽标用例，新增 scheduled-messages-bar 组件测试与 use-scheduled-messages
  hook 测试（FR-01~05 前端侧验收锚 / D-002@v1 分组内置顶与一次性定时语义）。
implementation:
  - session-list-panel.test.tsx 补置顶用例（照既有 mock 策略 vi.mock @/lib/daemon + QueryClientProvider 包裹）——置顶/取消置顶按钮按 session.pinned_at 二选一显隐（对齐归档 hover 按钮模式）；点击分别触发 onPinSessions/onUnpinSessions 回调并携带正确 session id
  - 同文件补重命名与徽标用例——Pencil 进入行内编辑态（预填当前标题）、Enter 提交触发 onRenameSession（strip 后非空才提交）、Esc 取消不触发回调、blur 提交；置顶行标题前 Pin 徽标渲染（已置顶行有、未置顶行无）
  - 新建 scheduled-messages-bar.test.tsx——条目渲染（派发时间+内容摘要）、四状态 tag（pending/dispatched/cancelled/failed）、仅 pending 条目显示取消按钮且点击触发取消回调、空态文案
  - 新建 frontend/src/hooks/__tests__/use-scheduled-messages.test.ts（照 use-message-queue.test.ts 既有 hook 测试模式 vi.mock @/lib/daemon + renderHook）——queryKey 含 sessionId 按会话隔离、轮询拉取与会话切换重拉、cancelScheduledMessage 调用后重新拉取
acceptance:
  - 置顶按钮二选一显隐、onPin/onUnpin 回调、行内重命名 Enter 提交与 Esc 取消、置顶徽标渲染四组断言全绿（FR-01/02/03）
  - scheduled-messages-bar 条目渲染/状态 tag/pending 取消回调/空态断言全绿（FR-04）
  - use-scheduled-messages queryKey 隔离/轮询/取消后刷新断言全绿（FR-04/05）
  - session-list-panel 既有用例零回归（新用例只增不改既有断言）
verify:
  - cd frontend && pnpm exec vitest run src/components/sessions/__tests__ src/components/daemon/__tests__/scheduled-messages-bar.test.tsx src/hooks/__tests__/use-scheduled-messages.test.ts
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 纯测试任务不改产品代码（发现实现缺陷登记回 task-07/08 修，不顺手改）
  - 断言走语义查询（getByRole/data-testid），不断言主题样式细节（双主题铁律）
  - 置顶断言基于 pinned_at 二态与分组内置顶语义（D-002@v1），不做跨分组全局置顶断言
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
