---
id: task-08
title: 'useMessageQueue unit tests'
title_zh: 'useMessageQueue 单元测试'
author: 'qinyi'
created_at: 2026-08-21 08:52:48
priority: P0
depends_on: [task-01]
blocks: [task-10]
requirement_ids: [FR-XX]
decision_ids: [D-XXX@vN]
allowed_paths:
  - frontend/src/hooks/__tests__/use-message-queue.test.ts
goal: >
  useMessageQueue hook 单元测试
implementation:
  - 新建 frontend/src/hooks/__tests__/use-message-queue.test.ts
  - 使用 @testing-library/react-hooks 或 vitest renderHook 测试
  - 测试 enqueue：添加条目后队列包含该条目
  - 测试 processQueue：成功回调后条目被移除，失败回调后条目标记 error
  - 测试 removeEntry：按 id 移除指定条目
  - 测试 retryEntry：将 error 条目重置为 pending
  - 测试 maxRetries 限制：超过最大重试次数后不再重试
  - 测试 maxQueueSize 限制：队列满时 enqueue 行为
acceptance:
  - 测试文件存在
  - 覆盖 enqueue/processQueue/removeEntry/retryEntry 核心方法
  - 覆盖 maxRetries 和 maxQueueSize 边界条件
  - vitest run 全部通过
verify:
  - cd frontend && pnpm exec vitest run src/hooks/__tests__/use-message-queue.test.ts
constraints:
  - 不修改 use-message-queue.ts 源码
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
