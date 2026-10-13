---
author: flow-machine-draft
created_at: 2026-10-13T21:31:25.418Z
---
# 任务注册表（Tasks）— 2026-10-14-turn-anchor-cache-eviction

- [x] task-01: 写测试先行——turn-anchor.test.ts 增 3 用例（未知 id 幂等不抛 / 清理后第三锚 prevTreeSha 链到第二锚且 files 正确+零变化 deduped 恢复 / 在飞链竞态清理收尾后行为正确），先跑确认新用例红（函数未导出）
- [x] task-02: turn-anchor.ts 导出 clearTurnAnchorCache（在飞链挂收尾后 delete，无链立即 delete，幂等不抛），跑 turn-anchor.test.ts 全绿
- [x] task-03: lifecycle.ts terminateSession 第 4c 步接线调用 + import（.js 扩展名），新文件 session-manager-lifecycle-turn-anchor-eviction.test.ts 用 vi.mock 断言恰调一次，跑该测试绿
- [x] task-04: pnpm typecheck（tsc --noEmit）通过 + 复跑 turn-anchor 两测试文件全绿（15/15），交付文件显式 pathspec 提交
