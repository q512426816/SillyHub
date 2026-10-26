---
author: flow-machine-draft
created_at: 2026-10-26T07:01:45.648Z
---
# 任务注册表（Tasks）— 2026-10-26-turn-phase-orphan-fallback

<!-- 工作分解契约：每行=可独立完成并当场验证的一步；成功标准在 requirements -->

- [x] task-01: applyTurnPhase 回退分支实现——未命中 run_id 且 currentRunId 指向活跃轮时写入该轮（只写 currentRunId 轮，不扫描猜测）；无活跃轮维持原样返回；验证：新增单测过
- [x] task-02: 测试三场景落盘——session-stream-turn-phase.test.ts 补竞态回退/无活跃轮丢弃/排队轮不接三组用例 + turn-state.test.ts 补 replacePlaceholderTurn 保留 currentPhase 锁定；验证：pnpm -C frontend test 两文件全绿（含既有用例零回归）
- [x] task-03: 收尾核验——tsc 零错 + 既有 turn-status-bar/turn-timeline 相关测试零回归；验证：聚焦套件绿
