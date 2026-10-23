---
author: flow-machine-draft
created_at: 2026-10-23T00:07:59.907Z
---
# 任务注册表（Tasks）— 2026-10-23-turn-file-diff-dialog

- [x] task-01: 纯映射模块 turn-file-diff.ts——AgentRunLogEntry[]+路径→按序补丁段（tool_call args.file_path 匹配、tool_use_id 配对 edit_patch、非法 JSON 占位）；vitest 单测（匹配/多段/回退/非法形状）先行并跑绿
- [x] task-02: TurnFileDiffDialog 弹窗组件——shadcn Dialog 受控形态，加载/失败（可重试）/无补丁如实说明/多段 DiffView 四态；组件测试（打开渲染 diff、多段、shell 说明、失败重试）先行并跑绿
- [x] task-03: turn-timeline 接线——新增可选 prop sessionId，文件卡挂载传 onOpenFile（闭包上抛 path），TurnTimeline 持弹窗 state 挂 TurnFileDiffDialog；接线测试（点击开弹窗、未接 sessionId 行不响应）并跑绿
- [x] task-04: 回归面验证——触及面 vitest（file-changes + turn-timeline 相关）+ `pnpm exec tsc --noEmit` 零错，记录构建证据
