---
author: flow-machine-draft
created_at: 2026-10-29T02:11:51.669Z
---
# 任务注册表（Tasks）— 2026-10-29-edit-diff-stat-badge

- [x] task-01: tool-diff.tsx 新增 diffStatFromPatch 纯函数（复用 parseStructuredPatch 数 add/del，多 hunk 累计，`\` 行天然跳过）+ 新建 agent-log/__tests__/tool-diff.test.tsx 用例（正常计数 / 多 hunk 累计 / 非法 JSON / 空 hunks / 零改动 0/0 → null）——vitest 该文件绿
- [ ] task-02: 新建 daemon/diff-stat-badge.tsx 共享徽标组件（+N 绿 emerald、-M 红 destructive，removed=0 只显示 +N 不显示 -0）——组件最小、无状态
- [ ] task-03: 跑马灯接入：LiveMarqueeEntry 增 diffStat 可选字段 + collectEntries tool 分支派生（status=ok 且 editPatch 存在双门控）+ MarqueeItemView 完成态耗时区前渲染 + turn-live-marquee.test.tsx 用例（完成态显示 +N -M / Write 全增只 +N / 运行中与 deny 不显示 / 无 editPatch 不显示）——vitest 绿
- [ ] task-04: ToolRowView 接入：useMemo 按 editPatch 解析缓存 + 行尾状态徽标后时长前渲染同款徽标 + turn-segment-views.test.tsx 用例（完成态显示 / running 不显示）——vitest 绿
- [ ] task-05: 相关测试面全量回归：turn-live-marquee / turn-segment-views / tool-diff 三个测试文件全绿（既有用例零回归）
- [ ] task-06: frontend tsc --noEmit 0 error + eslint 触及文件 0 error
