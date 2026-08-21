---
id: task-02
title: 'MessageQueueBar component'
title_zh: '消息队列展示组件'
author: 'qinyi'
created_at: 2026-08-21 08:52:48
priority: P0
depends_on: [task-01]
blocks: [task-03]
requirement_ids: [FR-XX]
decision_ids: [D-XXX@vN]
allowed_paths:
  - frontend/src/components/daemon/message-queue-bar.tsx
goal: >
  新建消息队列展示组件，展示排队条目并支持删除/重试
implementation:
  - 新建 frontend/src/components/daemon/message-queue-bar.tsx
  - 定义 MessageQueueBarProps 接口（entries, onRemove, onRetry）
  - 组件渲染队列条目列表，每条显示 payload 摘要 + status badge
  - error 状态条目显示错误信息和重试按钮
  - pending 状态条目显示等待中状态
  - 提供删除按钮移除条目
  - 使用 antd 组件（Tag, Button, Space 等）保持风格一致
acceptance:
  - 文件存在且导出 MessageQueueBar 组件
  - 接受 entries/onRemove/onRetry props
  - 渲染队列条目列表，区分 pending/error 状态
  - error 条目有重试按钮，pending 条目有删除按钮
  - tsc --noEmit 零 error
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不加测试（测试在 task-09）
  - 仅新建这一个文件
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
