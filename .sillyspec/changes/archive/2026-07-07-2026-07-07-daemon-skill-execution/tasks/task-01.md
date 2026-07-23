---
author: qinyi
created_at: 2026-07-07 13:35:00
goal: 在 backend AgentSpecBundle 加 stage_meta 字段并改造 _build_stage_bundle 改为构造 stage 元数据而非拼完整 prompt
implementation: 修改 backend/app/modules/agent/base.py 给 AgentSpecBundle（约 base.py:57）加 stage_meta 可选字段；修改 backend/app/modules/agent/service.py 的 _build_stage_bundle() 改为构造 StageDispatchMeta（{change_id, stage, skill_name, workspace_id, spec_root_ref}）填入 bundle.stage_meta，不再拼完整 stage prompt；移除对 verify.md 等 stage 模板的引用点
acceptance: AgentSpecBundle.stage_meta 字段存在且可序列化；_build_stage_bundle 产出的 bundle 携带 stage_meta；不再拼接 stage prompt 模板内容
verify: uv run pytest backend/tests/modules/agent -q（stage_meta 构造单测 + bundle 序列化断言）
constraints: 不改 AgentSpecBundle 既有字段（向后兼容，stage_meta 可选）；stage_meta 字段对齐 design §7 跨任务契约；复用 base.py 既有 dataclass 序列化机制，不引新框架
depends_on: []
covers: [FR-01, D-001@V1, D-006@V1, D-007@V1]
---

# task-01: backend stage_meta 数据结构 + _build_stage_bundle 改造

## 验收标准

A. backend/app/modules/agent/base.py 的 AgentSpecBundle 新增 stage_meta 可选字段（类型为 StageDispatchMeta 字典或 dataclass，含 change_id/stage/skill_name/workspace_id/spec_root_ref 五字段），既有字段保持不变，序列化往返不丢字段。
B. backend/app/modules/agent/service.py 的 _build_stage_bundle() 改为构造 stage 元数据填入 bundle.stage_meta，不再读取/拼接 verify.md 等 stage prompt 模板内容，单测断言 bundle.stage_meta.skill_name 等于对应 stage 的 sillyspec skill 名（如 verify → "sillyspec-verify"）。
C. backend 全量 `uv run pytest -q` 绿，新增的 stage_meta 构造与序列化单测通过，且不破坏既有 AgentSpecBundle 相关测试（零回归）。
