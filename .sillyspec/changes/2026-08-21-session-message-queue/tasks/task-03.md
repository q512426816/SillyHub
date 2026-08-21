---
id: task-03
title: 'sessions/page.tsx integrate message queue'
title_zh: 'sessions 页面集成消息队列'
author: 'qinyi'
created_at: 2026-08-21 08:52:48
priority: P0
depends_on: [task-01, task-02]
blocks: [task-06]
requirement_ids: [FR-XX]
decision_ids: [D-XXX@vN]
allowed_paths:
  - frontend/src/app/(dashboard)/sessions/page.tsx
goal: >
  在 sessions 页面集成 useMessageQueue + MessageQueueBar，实现消息排队
implementation:
  - 在 sessions/page.tsx 中导入 useMessageQueue 和 MessageQueueBar
  - 调用 useMessageQueue hook，配置 onProcess 回调（发送消息到 session）
  - 在页面顶部或消息输入区附近渲染 MessageQueueBar 组件
  - 将消息发送逻辑改为先 enqueue，由 processQueue 统一调度
  - 处理发送失败时自动进入 error 状态供重试
acceptance:
  - sessions 页面能正常渲染 MessageQueueBar
  - 发送消息时先进入队列再由 processQueue 处理
  - 消息发送失败后在队列中显示 error 状态
  - 可从队列中删除或重试失败消息
  - tsc --noEmit 零 error
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 仅修改 sessions/page.tsx 一个文件
  - 不改变现有消息发送的业务逻辑
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
