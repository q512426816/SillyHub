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
