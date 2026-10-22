---
author: sillyspec-fr-index
created_at: 2026-10-19T02:55:25.079Z
---

# FR 索引 — agent-skills

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/agent-skills.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-agent-skills-001 宿主机档位热跟随延迟收窄
变更：2026-10-19-host-settings-reload-latency
状态：active
摘要：主路径——切档后更快稳定；边界——语义零回退
场景正文：
- 场景：主路径——切档后更快稳定 — Given watcher 已建基线、存在本机默认宿主目录会话；；When 宿主 settings.json env 块换新档位；；Then 去抖确认窗口 ≤2 秒（两拍 × 1s），引擎重载随后完成，端到端 ≤4 秒。
- 场景：边界——语义零回退 — Given 既有 watcher 8 例 + HOST-1~6 测试面；；When 跑 tests/interactive；；Then 全绿（非 env 变化不触发/损坏容错/关闭阀/筛选矩阵行为逐字不变）。
全文：.sillyspec/changes/archive/2026-10-19-host-settings-reload-latency/requirements.md#FR-01
最近确认：ee8bc717b7b00bcc4e78a5e1da5788638735b776

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-host-settings-reload-latency:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/interactive/host-settings-watcher.test.ts「HOST_SETTINGS_POLL_INTERVAL_MS — 默认节拍单一源：默认轮询节拍为 1000ms（提速 3s→1s；注入覆盖口径不变）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-host-settings-reload-latency
  status: active

## FR-agent-skills-002 deploy 技能文档验证命令与端点行为一致
变更：2026-10-19-host-settings-reload-latency
状态：active
摘要：按文档执行即通过
场景正文：
- 场景：按文档执行即通过 — Given 部署后的 backend；；When 照改后文档命令执行；；Then 输出 `200 application/javascript`（不再 405 误导排障方向）。
全文：.sillyspec/changes/archive/2026-10-19-host-settings-reload-latency/requirements.md#FR-02
最近确认：ee8bc717b7b00bcc4e78a5e1da5788638735b776

## FR-agent-skills-003 上述两处注释改为新口径（无数据不出卡 / 后端 capability=tool_only 语义保留），不再出现「前端走『仅工具编辑』降级卡」表述
变更：2026-10-22-daemon-snapshot-report-log
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 两处注释已更新；When 全仓 grep「仅工具编辑」；Then `sillyhub-daemon/src` 下 0 命中，且注释仍说明 `capability
全文：.sillyspec/changes/archive/2026-10-22-daemon-snapshot-report-log/requirements.md#FR-01
最近确认：e135cab86ae8863568b5e46d1957f661b38fa068

## FR-agent-skills-004 每次快照上报都打一条结构化日志 turn_file_changes_reported，含 outcome=delivered|failed|enqueued|dropped、drop_reason、status、reason、file_count、collect_ms、elapsed_ms，失败另带 error
变更：2026-10-22-daemon-snapshot-report-log
状态：active
摘要：主路径（成功）；上报失败；丢弃（会话已收口 / 无 claimToken 且无 resilience）；入箱等重放
场景正文：
- 场景：主路径（成功） — Given 会话态存在、`claimToken` 非空、`notifyRunResult` resolve；When 上报快照；Then 打一条 info 级 `[daem
- 场景：上报失败 — 
- 场景：丢弃（会话已收口 / 无 claimToken 且无 resilience） — Given 会话态不存在，或 `claimToken` 空且无 resilience 可入箱；When 上报；Then 打一条 warn 级同 tag，`outcome=d
- 场景：入箱等重放 — Given `claimToken` 空但注入了 resilience；When 上报；Then 打一条 info 级同 tag，`outcome=enqueued`（后续
全文：.sillyspec/changes/archive/2026-10-22-daemon-snapshot-report-log/requirements.md#FR-02
最近确认：e135cab86ae8863568b5e46d1957f661b38fa068

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-daemon-snapshot-report-log:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/daemon-turn-snapshot-report-log.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-daemon-snapshot-report-log
  status: active

## FR-agent-skills-005 采集器既有 turn_file_changes_collected 日志与字段零变化（两条日志配对即可判「没采到」vs「采到没落库」）
变更：2026-10-22-daemon-snapshot-report-log
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 一轮跑完；When grep `turn_file_changes_collected` 与 `turn_file_changes_reported`；Then
全文：.sillyspec/changes/archive/2026-10-22-daemon-snapshot-report-log/requirements.md#FR-03
最近确认：e135cab86ae8863568b5e46d1957f661b38fa068

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-daemon-snapshot-report-log:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/interactive/turn-file-changes.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-daemon-snapshot-report-log
  status: active

## FR-agent-skills-006 daemon tsc --noEmit 退出 0；新增上报收口日志用例全绿；既有 tests/interactive/turn-file-changes.test.ts 不回归
变更：2026-10-22-daemon-snapshot-report-log
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 变更落盘；When 跑 daemon typecheck + `tests/daemon-turn-snapshot-report-log.test.ts` +
全文：.sillyspec/changes/archive/2026-10-22-daemon-snapshot-report-log/requirements.md#FR-04
最近确认：e135cab86ae8863568b5e46d1957f661b38fa068

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-daemon-snapshot-report-log:flow:测试绑定FR-04
  tests: sillyhub-daemon/tests/daemon-turn-snapshot-report-log.test.ts | sillyhub-daemon/tests/interactive/turn-file-changes.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-daemon-snapshot-report-log
  status: active
