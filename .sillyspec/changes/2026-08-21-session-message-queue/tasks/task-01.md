---
id: task-01
title: 'useMessageQueue hook'
title_zh: '消息队列管理 Hook'
author: 'qinyi'
created_at: 2026-08-21 08:52:48
priority: P0
depends_on: []
blocks: [task-03]
requirement_ids: [FR-XX]
decision_ids: [D-XXX@vN]
allowed_paths:
  - frontend/src/hooks/use-message-queue.ts
goal: >
  新建消息队列管理 hook，提供 enqueue/processQueue/removeEntry/retryEntry 能力
implementation:
  - 新建 frontend/src/hooks/use-message-queue.ts
  - 定义 QueueEntry 类型（id, payload, status, retryCount, createdAt, error）
  - 定义 UseMessageQueueOptions 接口（onProcess 回调, maxRetries, maxQueueSize）
  - 实现 enqueue 方法：创建 QueueEntry 并加入队列，返回 entry id
  - 实现 processQueue 方法：按 FIFO 顺序调用 onProcess，成功后移除，失败后标记为 error 并可重试
  - 实现 removeEntry 方法：按 id 从队列移除条目
  - 实现 retryEntry 方法：将 error 状态的条目重置为 pending 并重新入队
  - 使用 useState/useCallback 管理队列状态
acceptance:
  - 文件存在且导出 useMessageQueue hook
  - QueueEntry 类型包含 id/payload/status/retryCount/createdAt/error 字段
  - enqueue 正确添加条目到队列
  - processQueue 按 FIFO 顺序处理，成功移除，失败标记 error
  - removeEntry 按 id 移除条目
  - retryEntry 将 error 条目重置为 pending
  - tsc --noEmit 零 error
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不加测试（测试在 task-08）
  - 不修改任何已有文件
  - 仅新建这一个文件
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
