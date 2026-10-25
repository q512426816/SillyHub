---
author: flow-machine-draft
created_at: 2026-10-24T16:08:34.422Z
---
# 任务注册表（Tasks）— 2026-10-24-trajectory-context-rows

- [x] task-01: `from-turn-views.ts`——rowKindOf 把 turn_trigger → system（行构造置 meta.contextEvent）+ segmentStart 统一「先 startedAt 再 ts」；验证：`from-turn-views.test.ts` 新增 turn_trigger/user_msg 用例全绿
- [ ] task-02: 回归验证——轨迹目录既有用例零回归（含 system_event 既有用例）+ `pnpm exec tsc --noEmit` 退出 0；验证：vitest 输出零失败
