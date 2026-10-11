---
author: flow-machine-draft
created_at: 2026-10-11T14:47:54.562Z
---
# 需求规格（Requirements）— 2026-10-11-daemon-masked-test-fix

## 功能需求

### FR-01: tests/protocol-session-contract.test.ts MSG 总数钉 24→25（补 TOMBSTONE_CLEANUP 来历注释），定向 vitest 绿

- 协议 MSG 常量计数钉子必须与 protocol.ts 实际常量数一致：`Object.keys(MSG))` 断言必须为 25（0b09d1555 增 SILLYSPEC_TOMBSTONE_CLEANUP 后的实际值），用例标题与注释必须写明该常量来历，该文件定向 vitest 必须全绿。

#### 场景：主路径

- Given：protocol.ts MSG 含 SILLYSPEC_TOMBSTONE_CLEANUP（共 25 键）。
- When：运行「MSG 总数」计数钉子用例。
- Then：断言 25 通过，无键值回归。

### FR-02: tests/fixtures/claude-sdk-messages/golden-session.events.json 帧 7/15/29 补 usage.api_duration_ms（500/1100/400）+ 头注再生成记录 + §2 锚点两处同步，定向 vitest 绿

- golden 事件流快照必须与 ClaudeEventNormalizer 当前产出逐字段一致：帧 7/15/29 partial 的 usage 必须携带 api_duration_ms 500/1100/400（live-token-speed FR-01/FR-04 新产出键），fixture 头注必须记录再生成来历，测试 §2 帧 7/15 两处 usage 锚点断言必须同步含该键，golden 文件定向 vitest 必须全绿。

#### 场景：主路径

- Given：normalizer 自 live-token-speed 起 usage 产出 api_duration_ms，快照停在该变更前。
- When：按快照驱动协议（假时钟 +100ms/帧、帧 4/26 推 500ms、帧 22/37 onTurnEnd）跑 §1 逐字段对照。
- Then：三处 usage 补键后全帧一致，§2/§3/§4 语义锚不回归。

### FR-03: tests/daemon-mission-worker-artifact.test.ts 兜底代报载体 pi→codex（caps.mcp 仍 false，机制断言原样保留）+ 新增 pi 零代报钉子（自报路径防双写），定向 vitest 绿

- mission_worker 兜底代报测试的载体 provider 必须与现行 caps 契约匹配：caps.mcp===false 的门控/容错/多轮机制断言必须改用仍为 mcp=false 的 codex 载体（断言原样保留），并必须新增 pi 零代报钉子（7bd743230 翻值后 pi 走 worker_done MCP 自报路径，daemon 代报会双写 artifacts），该文件定向 vitest 必须全绿（19 例）。

#### 场景：主路径

- Given：pi caps.mcp=true（7bd743230 / all-engines-mcp-injection task-08）、codex 仍 false。
- When：mission_worker + codex 成功轮 onTurnResult。
- Then：兜底代报恰一次、顺序在 notifyRunResult 后；pi 同场景零代报。

### FR-04: daemon typecheck 过；不跑全量（规则 0），全量留给 CI

- 本变更必须只跑定向面（3 个测试文件 vitest + daemon tsc --noEmit），禁止跑全量测试套件，全量验证留给 CI。

#### 场景：主路径

- Given：CLAUDE.md 规则 0。
- When：本变更各任务验证。
- Then：仅定向面被执行。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/protocol-session-contract.test.ts「MSG 总数 = 25」
FR-02: sillyhub-daemon/tests/interactive/golden/claude-events-golden.test.ts「逐帧 partials+events 与 golden-session.events.json 逐字段一致」+「关键语义锚点抽查」
FR-03: sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts「mission_worker + codex(mcp=false) + success + 全文非空 → 恰一次代报」+「pi（caps.mcp false→true 自 7bd743230）→ 零代报」
FR-04: 不适用：流程约束条款（禁止跑全量），无独立测试面——由各定向测试命令范围本身佐证
