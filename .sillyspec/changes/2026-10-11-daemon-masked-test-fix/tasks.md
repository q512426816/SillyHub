---
author: flow-machine-draft
created_at: 2026-10-11T14:47:54.562Z
---
# 任务注册表（Tasks）— 2026-10-11-daemon-masked-test-fix

- [x] task-01: tests/protocol-session-contract.test.ts MSG 总数钉 24→25（补 TOMBSTONE_CLEANUP 来历注释），定向 vitest 绿
- [x] task-02: tests/fixtures/claude-sdk-messages/golden-session.events.json 帧 7/15/29 补 usage.api_duration_ms（500/1100/400）+ 头注再生成记录 + §2 锚点两处同步，定向 vitest 绿
- [x] task-03: tests/daemon-mission-worker-artifact.test.ts 兜底代报载体 pi→codex（caps.mcp 仍 false，机制断言原样保留）+ 新增 pi 零代报钉子（自报路径防双写），定向 vitest 绿
- [x] task-04: daemon typecheck 过；不跑全量（规则 0），全量留给 CI
