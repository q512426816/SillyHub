---
schema_version: 1
doc_type: module-card
module_id: spec_profile
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:09:00
---
# spec_profile

## 定位
SillySpec profile 的发现、加载与冲突检测的基础设施层。定义 profile manifest 与 spec conflict 两张表的模型，提供 Provider（manifest 发现/加载）与 Policy（阶段/文档冲突检测）两层抽象。当前 Provider/Policy 为 stub，冲突的 CRUD 由 spec_workspace 暴露。无独立 router。

## 契约摘要
- 无对外 HTTP 端点；SpecConflict 的列表/解决经 spec_workspace router 暴露
- `SpecProfileProvider.discover_manifests/load_manifest/get_active_manifest`（stub，返回空）
- `StagePolicy.check_stage_conflict` / `DocumentPolicy.check_document_conflict`（stub）
- 模型：`SpecProfileManifest`（spec_profile_manifests 表）、`SpecConflict`（spec_conflicts 表）
- `ProfileManifestData`：stages / documents / gates / agent_contracts 四组数据

## 关键逻辑
```
# 设计中的冲突检测（未来实现）：
StagePolicy.check_stage_conflict(platform_stages, spec_stages)
  → 比较阶段定义、gate 兼容性、顺序约束 → ConflictDetail[]
DocumentPolicy.check_document_conflict(platform_docs, spec_docs)
  → 比较文档 schema、路径约定、验证规则 → ConflictDetail[]
→ 写入 spec_conflicts 表
```

## 注意事项
- SpecConflict 字段：workspace_id / change_id? / task_id? / stage / conflict_type(gate|schema|path|validation) / details_json / status(open|approved|rejected|resolved)
- SpecProfileManifest 同一时间仅允许一个 `is_active=True`，唯一性靠 service 层保证（DB 层有 `ix_spec_profile_manifests_is_active` 但非部分唯一索引）
- `conflict_type` 用 Literal 约束，新增类型需改两处
- SpecConflict 表 workspace 删除级联删冲突；spec_workspace 的 resolve 端点直接操作 session
- Provider 的 `DEFAULT_SOURCE_PATH` 硬编码为开发机本地路径，生产需配置注入
- 整体为 placeholder 状态，接口已定义待填充，上下游（spec_workspace）已按接口对接

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
