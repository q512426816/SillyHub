---
author: sillyspec-fr-index
created_at: 2026-10-27T23:43:41.822Z
---

# FR 索引 — spec_workspace

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/spec_workspace.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-spec_workspace-001 _CGROUP_LIMIT_FILES 候选补 /sys/fs/cgroup/memory.max（v2 在前、v1 兜底保留），模块 docstring 的 v2 文件名同步修正
变更：2026-10-28-cgroup-v2-watermark-fix
状态：active
摘要：v2 宿主读出限制并计算水位
场景正文：
- 场景：v2 宿主读出限制并计算水位 — Given 仅存在 v2 形态文件（`memory.current` 写 1000、`memory.max` 写 2000，均由 monkeypatch 注入 tmp_pa；When 调用 `log_memory_watermark()`；Then 返回 0.5，且经模块 log 符号发出 `spec_workspace.memory_watermark` info 事件（带 ratio）
全文：.sillyspec/changes/archive/2026-10-28-cgroup-v2-watermark-fix/requirements.md#FR-01
最近确认：19b14831150ba84a4e522925f5223fe05507323e

## FR-spec_workspace-002 memory.max 内容为字面量 "max"（无限制）时安全跳过：不抛错、不误告警、返回 None
变更：2026-10-28-cgroup-v2-watermark-fix
状态：active
摘要：v2 无限制容器不误告警
场景正文：
- 场景：v2 无限制容器不误告警 — Given `memory.current` 写 800、`memory.max` 内容为 `max`；When 调用 `log_memory_watermark()`；Then 返回 None，不抛错，log 符号上无 `memory_watermark_high` warning 也无 `memory_watermark` info
全文：.sillyspec/changes/archive/2026-10-28-cgroup-v2-watermark-fix/requirements.md#FR-02
最近确认：19b14831150ba84a4e522925f5223fe05507323e

## FR-spec_workspace-003 新增 pytest 用例覆盖四形态：v2 正常读取算出比例、超 0.8 阈值出告警、"max" 字面量跳过、无 cgroup 环境跳过；spec_workspace 相关测试全绿
变更：2026-10-28-cgroup-v2-watermark-fix
状态：active
摘要：超阈值告警路径
场景正文：
- 场景：超阈值告警路径 — Given `memory.current` 写 1900、`memory.max` 写 2000（比例 0.95 > 0.8）；When 调用 `log_memory_watermark()`；Then 返回 0.95，log 符号发出 `spec_workspace.memory_watermark_high` warning
全文：.sillyspec/changes/archive/2026-10-28-cgroup-v2-watermark-fix/requirements.md#FR-03
最近确认：19b14831150ba84a4e522925f5223fe05507323e
