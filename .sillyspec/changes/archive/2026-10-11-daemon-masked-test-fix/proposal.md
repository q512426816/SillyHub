---
author: flow-machine-draft
created_at: 2026-10-11T14:47:54.562Z
---
# 提案书（Proposal）— 2026-10-11-daemon-masked-test-fix

## 动机

任务原话转写：动机：上一变更清偿 daemon-ci drift 门后，被其遮蔽的 Test 步首次真正执行，暴露 3 个测试文件 8 例存量失败（协议 MSG 计数钉 24 实 25、golden 快照缺 api_duration_ms 三处、mission_worker 兜底代报 6 例用 pi 当 mcp=false 载体而 task-08 已翻 true）——全部为测试面滞后于有意生产行为，生产代码零缺陷。

成功标准：
- tests/protocol-session-contract.test.ts MSG 总数钉 24→25（补 TOMBSTONE_CLEANUP 来历注释），定向 vitest 绿
- tests/fixtures/claude-sdk-messages/golden-session.events.json 帧 7/15/29 补 usage.api_duration_ms（500/1100/400）+ 头注再生成记录 + §2 锚点两处同步，定向 vitest 绿
- tests/daemon-mission-worker-artifact.test.ts 兜底代报载体 pi→codex（caps.mcp 仍 false，机制断言原样保留）+ 新增 pi 零代报钉子（自报路径防双写），定向 vitest 绿
- daemon typecheck 过；不跑全量（规则 0），全量留给 CI

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. tests/protocol-session-contract.test.ts MSG 总数钉 24→25（补 TOMBSTONE_CLEANUP 来历注释），定向 vitest 绿
2. tests/fixtures/claude-sdk-messages/golden-session.events.json 帧 7/15/29 补 usage.api_duration_ms（500/1100/400）+ 头注再生成记录 + §2 锚点两处同步，定向 vitest 绿
3. tests/daemon-mission-worker-artifact.test.ts 兜底代报载体 pi→codex（caps.mcp 仍 false，机制断言原样保留）+ 新增 pi 零代报钉子（自报路径防双写），定向 vitest 绿
4. daemon typecheck 过；不跑全量（规则 0），全量留给 CI

## 成功标准（可验证）

1. tests/protocol-session-contract.test.ts MSG 总数钉 24→25（补 TOMBSTONE_CLEANUP 来历注释），定向 vitest 绿
2. tests/fixtures/claude-sdk-messages/golden-session.events.json 帧 7/15/29 补 usage.api_duration_ms（500/1100/400）+ 头注再生成记录 + §2 锚点两处同步，定向 vitest 绿
3. tests/daemon-mission-worker-artifact.test.ts 兜底代报载体 pi→codex（caps.mcp 仍 false，机制断言原样保留）+ 新增 pi 零代报钉子（自报路径防双写），定向 vitest 绿
4. daemon typecheck 过；不跑全量（规则 0），全量留给 CI
