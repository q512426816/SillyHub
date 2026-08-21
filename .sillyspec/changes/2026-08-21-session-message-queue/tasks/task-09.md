---
id: task-09
title: 'MessageQueueBar unit tests'
title_zh: 'MessageQueueBar 单元测试'
author: 'qinyi'
created_at: 2026-08-21 08:52:48
priority: P0
depends_on: [task-02]
blocks: [task-10]
requirement_ids: [FR-XX]
decision_ids: [D-XXX@vN]
allowed_paths:
  - frontend/src/components/daemon/__tests__/message-queue-bar.test.tsx
goal: >
  MessageQueueBar 组件单元测试
implementation:
  - 新建 frontend/src/components/daemon/__tests__/message-queue-bar.test.tsx
  - 使用 vitest + @testing-library/react 测试
  - 测试空队列时不渲染任何条目
  - 测试渲染 pending 状态条目，显示正确状态标签
  - 测试渲染 error 状态条目，显示错误信息和重试按钮
  - 测试点击删除按钮调用 onRemove 回调并传入正确 id
  - 测试点击重试按钮调用 onRetry 回调并传入正确 id
  - 测试多条目同时展示
acceptance:
  - 测试文件存在
  - 覆盖空队列/pending/error 渲染/按钮交互/多条目场景
  - vitest run 全部通过
verify:
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/message-queue-bar.test.tsx
constraints:
  - 不修改 message-queue-bar.tsx 源码
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
