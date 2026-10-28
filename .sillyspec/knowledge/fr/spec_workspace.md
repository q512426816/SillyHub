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

## FR-spec_workspace-001 TestComputeReparseScope 八用例改三元组解包并按新契约断言：rename/delete 入 changes/archive/<name> → (['<name>'], archive_hit=False, structural=True)；恰为 changes/archive 根 → (None, True, False) 兜底不变；纯标注/兜底/add 归档/零触发/混合去重语义不变仅改解包
变更：2026-10-28-reparse-trigger-tests-realign
状态：active
摘要：rename 入归档走 scoped+structural
场景正文：
- 场景：rename 入归档走 scoped+structural — Given op=rename（旧侧活跃区、新侧 changes/archive/<name>）；When 调用 `_compute_reparse_scope([], [该 op])`；Then 返回 `(['<name>'], False, True)`——不再全量
全文：.sillyspec/changes/archive/2026-10-28-reparse-trigger-tests-realign/requirements.md#FR-01
最近确认：00df74b42338c5d02a9cb23a385ce07761fe66e8

## FR-spec_workspace-002 TestArchivePathScoping 两用例（rename/delete 全量期望）改断言 scoped 列表；test_archive_full_reparse_still_deletes 仍过但机制描述与命名对齐 scoped 双名覆盖实际
变更：2026-10-28-reparse-trigger-tests-realign
状态：active
摘要：sync 端到端 rename 入归档
场景正文：
- 场景：sync 端到端 rename 入归档 — Given 增量同步携带 rename op（活跃 → 归档）；When 同步完成 reparse 被调度；Then mock 收到 `scope == ["2026-08-13-old"]`（scoped 而非 None）
全文：.sillyspec/changes/archive/2026-10-28-reparse-trigger-tests-realign/requirements.md#FR-02
最近确认：00df74b42338c5d02a9cb23a385ce07761fe66e8

## FR-spec_workspace-003 本文件 19 用例全绿；test_archive_scoped_reparse.py 既有契约测试回归零破坏；不改动任何 src 代码
变更：2026-10-28-reparse-trigger-tests-realign
状态：active
摘要：回归全绿
场景正文：
- 场景：回归全绿 — Given 测试文件按新契约更新完成；When 运行 spec_workspace 测试目录；Then 本文件 19 用例全绿且既有契约测试零失败
全文：.sillyspec/changes/archive/2026-10-28-reparse-trigger-tests-realign/requirements.md#FR-03
最近确认：00df74b42338c5d02a9cb23a385ce07761fe66e8

## FR-spec_workspace-001 daemon 归一化器把 system/api_retry 帧转为 status 事件（metadata 含 attempt/max_retries/retry_delay_ms/error_status/error 摘要），session-manager 分发为新 case，经 onTurnMessage 落 [MODEL_RETRY] 单行 JSON 协议行（对齐 COMPACT_STATUS 形态；error 文本截断防超长）
变更：2026-10-28-model-retry-visible
状态：active
摘要：429 限流重试帧透传；连接类重试（无 HTTP 状态）；无活动轮时丢弃
全文：.sillyspec/changes/archive/2026-10-28-model-retry-visible/requirements.md#FR-01
最近确认：265543056ebc5d72193ead562b28dec0f8d38671

## FR-spec_workspace-002 前端 session-log-assembler 新增 kind=model_retry 分类；运行中轮时间线实时显示「模型限流重试中 第N/M次」类提示（含错误摘要可读文案），终态轮不在对话正文渲染
变更：2026-10-28-model-retry-visible
状态：active
摘要：运行中轮实时可见；终态轮不渲染重试段；载荷异常兜底
全文：.sillyspec/changes/archive/2026-10-28-model-retry-visible/requirements.md#FR-02
最近确认：265543056ebc5d72193ead562b28dec0f8d38671

## FR-spec_workspace-003 纯可观测性透传：不改变 CLI/daemon 重试行为本身，不改 backend 表结构
变更：2026-10-28-model-retry-visible
状态：active
摘要：backend 零改动验证
全文：.sillyspec/changes/archive/2026-10-28-model-retry-visible/requirements.md#FR-03
最近确认：265543056ebc5d72193ead562b28dec0f8d38671

## FR-spec_workspace-004 daemon 与前端新增单测覆盖：归一化 api_retry 帧、分发落行、前端分类与渲染；相关既有测试不回归
变更：2026-10-28-model-retry-visible
状态：active
摘要：交付自证
全文：.sillyspec/changes/archive/2026-10-28-model-retry-visible/requirements.md#FR-04
最近确认：265543056ebc5d72193ead562b28dec0f8d38671
