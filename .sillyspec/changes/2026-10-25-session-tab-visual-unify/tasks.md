---
author: flow-machine-draft
created_at: 2026-10-25T05:16:46.963Z
---
# 任务注册表（Tasks）— 2026-10-25-session-tab-visual-unify

- [x] task-01: turn-segment-views.tsx 与 turn-timeline.tsx 中 agent 反馈信息块限宽统一为 max-w-[calc(100%-120px)]，并同步 turn-segment-views.test.tsx 宽度断言（当场验证：该测试文件跑绿）
- [x] task-02: 进度视图两处 AskUser 渲染换 DialogQaBlock（v2 timeline + 旧回退 TurnDetailsList），DialogQaBlock 去 ml-9 加统一限宽，删 AskUserToolCard，同步 session-input-bar / dialog-inplace 测试断言与注释（当场验证：两测试文件跑绿）
- [x] task-03: session-change-files-hover.tsx 按钮文案「变更文件」→「变更」，补测试断言（当场验证：该测试文件跑绿）
