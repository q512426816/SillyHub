---
id: task-04
title: 'diff analysis'
title_zh: '差异分析'
author: 'qinyi'
created_at: 2026-08-21 08:52:48
priority: P0
depends_on: []
blocks: [task-05]
requirement_ids: [FR-XX]
decision_ids: [D-XXX@vN]
allowed_paths:
  - .sillyspec/changes/2026-08-21-session-message-queue/diff-analysis.md
goal: >
  对比 sessions/page.tsx 与 interactive-session-panel.tsx，输出 diff 文档和 SessionPanel props 清单
implementation:
  - 阅读 sessions/page.tsx 和 interactive-session-panel.tsx 完整源码
  - 逐段对比两文件中与 session 展示/交互相关的逻辑
  - 提取共同部分（消息展示、输入框、连接状态等）
  - 提取差异部分（sessions 页面特有的 context/scope 选择、panel 特有的运行时绑定等）
  - 输出 diff-analysis.md，包含：共同逻辑清单、差异清单、建议的 SessionPanel props 接口草案
acceptance:
  - diff-analysis.md 文件存在且内容完整
  - 列出两文件的共同逻辑和差异逻辑
  - 给出 SessionPanel props 接口草案（含类型定义）
  - props 清单覆盖两页面所有差异点
verify:
  - cat .sillyspec/changes/2026-08-21-session-message-queue/diff-analysis.md | head -5（文件存在即可）
constraints:
  - 只读分析 + 写 diff-analysis.md，不修改任何源码文件
  - 源码文件仅用于阅读分析
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
