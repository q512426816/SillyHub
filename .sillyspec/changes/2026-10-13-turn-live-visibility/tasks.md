---
author: flow-machine-draft
created_at: 2026-10-13T03:30:35.880Z
---
# 任务注册表（Tasks）— 2026-10-13-turn-live-visibility

- [x] task-01: 数据面扩容：use-session-tasks.buildSubagentTaskLookup 返回双索引（byToolUseId 择优逻辑不变 + byTaskId 同款择优），turn-segment-views 的 SubagentTaskLookupContext 值类型改 SubagentTaskLookup、SubagentBlockView/session-panel-page Provider 消费方同步适配。验证：pnpm typecheck 过 + turn-segment-views 既有测试绿
- [ ] task-02: FR-01 等待行渲染：parseTaskOutputWait 导出 + ToolRowView 对 TaskOutput running 特判（人话摘要「等待后台任务：任务名」/未命中回退/行尾局部走秒 tick/终态回归）。验证：turn-segment-views.test.tsx 新增三场景用例绿
- [ ] task-03: FR-02 终态收敛：reconcileTaskStatusForDisplay 单向收敛纯函数 + subagentHeaderOf 接入 + deriveTurnActivity/collectSubagents 可选 lookup 参数与 TurnStatusBar 接 context（计数收敛）。验证：turn-segment-views.test.tsx 新增收敛两场景用例绿 + 既有用例回归
- [ ] task-04: FR-03 轮边界对账接线：session-panel-page 的 turn_completed 对账点追加任务快照 refreshSignal 递增（失败静默）。验证：pnpm typecheck 过 + 接线手验说明记入 progress
- [ ] task-05: FR-04 daemon 双门限：stream-json.ts 加 _lastUsageEmitAt、text_delta 双门限（≥20 token 或 ≥500ms、零增量不推）、取消真 usage 后 text_delta 拦截、message_start/message_delta emit 基线同步。验证：sillyhub-daemon tests/adapters/stream-json.test.ts 新增用例绿（含真值覆盖后基线同步）
- [ ] task-06: 回归收口：frontend 相关测试文件全绿 + pnpm typecheck + daemon 侧 tsc/vitest 相关文件绿；确认未裹挟共享文件里其他活跃变更的 hunk（选择性暂存纪律）
