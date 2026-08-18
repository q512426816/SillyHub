---
schema_version: 1
doc_type: module-card
module_id: spec_profile
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 规范档位骨架（spec_profile）

## 定位

SillySpec profile（规范档位）manifest 与 spec 冲突的**骨架模块**。定义两张表模型 +
Provider / Policy 两层抽象，但实质加载与冲突检测均为 **stub 占位**（provider 返回
None、policy 返回空列表，待后续 change 填充）。无 router、无 HTTP 端点；冲突的读取
端点在 spec_workspace 模块。

## 契约摘要

- 无对外 HTTP 端点
- `SpecProfileProvider.get_active_manifest()` → stub 恒返回 `None`（TODO：查库取
  active `SpecProfileManifest` 行并水合成 `ProfileManifestData`）
- `StagePolicy.check_stage_conflict` / `DocumentPolicy.check_document_conflict` →
  placeholder 恒返回空 `ConflictDetail[]`
- `ProfileManifestData`：manifest dict 的只读视图（stages / documents / gates /
  agent_contracts 四组 property）
- 表 `spec_profile_manifests`：`source_path`、`version`、`manifest_json`（全量 blob）、
  `is_active`（唯一性靠 service 层保证，DB 仅普通索引）
- 表 `spec_conflicts`：`workspace_id` FK CASCADE、`change_id`/`task_id` 可空、`stage`、
  `conflict_type`（gate/schema/path/validation Literal）、`details_json`、
  `status`（open/approved/rejected/resolved，默认 open）

## 关键逻辑

```
设计意图（未实现）:
  provider.get_active_manifest() → ProfileManifestData
  StagePolicy/DocumentPolicy.check_*_conflict(platform, spec) → ConflictDetail[]
  → 写 spec_conflicts 表（workspace 级冲突记录）
现状: 三个入口全为 stub，链路未通电
```

## 注意事项

- **如实认知现状**：agent/context_builder.py import 了 `SpecProfileProvider`，拿到
  None 即走后续兜底——上游不依赖 stub 返回真数据
- spec_workspace 的 `GET /spec-conflicts` 端点直接读 `spec_conflicts` 表（model +
  schema 从本模块 import）；表结构是真实落库的，不要因 provider stub 误判整模块无效
- `conflict_type` / `status` 是 Literal 双处约束（model + schema），加类型需同步两处
- Provider 的 `DEFAULT_SOURCE_PATH` 硬编码开发机本地路径，实现时须改为配置注入
- 实现 manifest 加载时须处理 is_active 唯一性（当前无 DB 约束兜底）

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
