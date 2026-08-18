---
schema_version: 1
doc_type: module-card
module_id: spec_profile
author: qinyi
created_at: 2026-08-18 01:45:00
---

# Profile 清单与冲突检测（spec_profile）

## 定位
「SillySpec Profile 清单 + 冲突检测」的**骨架模块**（如实描述现状）：无 HTTP 路由，ORM 表与策略类骨架已落地，但核心行为均为 stub——`provider.get_active_manifest` 固定返回 None（TODO 未实现），`StagePolicy / DocumentPolicy` 的 `check_*_conflict` 恒返回空冲突列表。当前它提供的是「表结构 + 数据结构 + 接口形状」，尚无真实的 manifest 加载与冲突检测能力。

## 契约摘要
- 纯 Python API，无 APIRouter。两处真实消费方：
  - `spec_workspace/router.py` import `SpecConflict` 模型 + 本模块 schema（spec-conflicts 列表/解决端点直读表）
  - `agent/context_builder.py` import `SpecProfileProvider`（拿到的实际是 stub 行为）
- 数据模型：
  - `SpecProfileManifest`（`spec_profile_manifests`）：source_path、version、`manifest_json` 全量 blob（stages/documents/gates/agent_contracts 序列化 JSON）、`is_active`（单一活跃由 service 层保证，非 DB 约束；有 is_active 索引）
  - `SpecConflict`（`spec_conflicts`）：workspace 级（FK CASCADE）+ 可选 change_id / task_id、stage、`conflict_type`、`details_json`、`status`
- 取值域（model 顶部 Literal）：
  - `conflict_type` ∈ gate / schema / path / validation
  - `status` ∈ open / approved / rejected / resolved
- `provider.ProfileManifestData`：manifest dict 的只读视图，stages/documents/gates/agent_contracts 四属性返 `list[dict]`，未强类型化
- `policy.ConflictDetail`：dataclass（conflict_type / stage / message / platform_requirement / spec_requirement）
- 测试：`tests/test_policy.py` 覆盖策略类骨架

## 关键逻辑
```
# 设计意图（当前为 stub，行为未接通）
manifests = SpecProfileProvider(source_path).get_active_manifest()   # → None（TODO）
conflicts = await StagePolicy().check_stage_conflict(platform_stages, spec_stages)    # → []
         + await DocumentPolicy().check_document_conflict(platform_docs, spec_docs)   # → []
# 设计上冲突应写 SpecConflict 行，经 spec-conflicts 端点列出/解决
```

## 注意事项
- `provider.DEFAULT_SOURCE_PATH` 是硬编码的开发机绝对路径（指向本机 sillyspec 参考实现），stub 遗留；接通前不可依赖它做发现
- `SpecConflict.conflict_type` 取值是 gate/schema/path/validation（早期资料若写 stage/document 已过时，以 model Literal 为准）
- 冲突解决（status → resolved/approved/rejected）经 spec_workspace 端点操作，本模块自身无写路径
- `get_active_manifest` 的设计注释表明未来要「查 DB 活跃 SpecProfileManifest 行并水合 ProfileManifestData」，按此方向接通
- 接手开发完成清单：①实现 provider 的 manifest 发现/加载/活跃行水合；②实现两个 policy 的真实比对逻辑；③表与 schema 无需再动

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
