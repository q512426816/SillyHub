---
schema_version: 1
doc_type: module-card
module_id: spec_profile
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:36
---
# spec_profile

## 定位
SillySpec「Profile 清单 + 冲突检测」的内部支撑模块，无 HTTP 路由。负责从文件系统发现并加载 spec profile manifest（定义 stages / documents / gates / agent_contracts），持久化到 `SpecProfileManifest`，并在 manifest 叠加时做 stage 级与 document 级冲突检测，结果落 `SpecConflict` 表。是 spec_workspace 的策略底座。

产品视角：spec profile 定义了「这套规范要求哪些阶段、哪些文档、哪些门禁、agent 拿什么契约」。当多个 profile 在同一工作区叠加时，本模块检测 stage/document 冲突并记录，供前端冲突列表展示与人工解决。它是 spec 工作流可配置化的根基——换 profile 即换工作流形态，无需改代码。

## 契约摘要
- 无 APIRouter，纯 Python API，供 `spec_workspace` 调用
- 数据模型：
  - `SpecProfileManifest`（name / version / profile_data JSON / source_path 等元数据）
  - `SpecConflict`（conflict_type Literal[stage,document] / resource / details / resolved 标志）
- Schema：`SpecProfileManifestCreate|Read|ListResponse` / `SpecConflictRead|ListResponse|Resolve`
- 三层职责：
  - `provider.SpecProfileProvider`：发现（`discover_manifests`）/ 加载（`load_manifest`）/ 取活跃（`get_active_manifest`）
  - `policy.StagePolicy` / `DocumentPolicy`：冲突检测策略类，输出 `ConflictDetail`
  - `ProfileManifestData`：manifest 数据结构，属性 stages/documents/gates/agent_contracts 返回 `list[dict]`
- 依赖：`core`、`models`（BaseModel）；被 `spec_workspace` 用于 `/spec-conflicts` 列表/解决端点
- 跨组件协作：spec_workspace.bootstrap 触发验证 → 冲突写 SpecConflict → 前端 spec-conflicts 列表展示 → 解决

## 关键逻辑
冲突检测与 profile 加载：
```
manifests = provider.discover_manifests()        # 扫描 source_path 下 JSON
active = provider.get_active_manifest()           # 取当前活跃清单
conflicts = StagePolicy().check_stage_conflict(existing_stages, new_stages)
         + DocumentPolicy().check_document_conflict(existing_docs, new_docs)
# 冲突写 SpecConflict 行，供 spec-conflicts 端点列出/解决
```
- `ProfileManifestData` 的 stages/documents/gates/agent_contracts 属性返回 `list[dict]`，尚未强类型化
- `SpecConflict.conflict_type` 用 Literal 区分 stage/document
- `ConflictDetail` 是 dataclass，承载冲突资源标识与差异描述
- policy 类采用策略模式，可独立单测与替换，不耦合 service

### Manifest 数据结构
`ProfileManifestData` 承载一个 profile 的完整定义：
- `stages`：工作流阶段定义（名称、顺序、进出条件）
- `documents`：该 profile 要求的文档类型清单
- `gates`：阶段间质量门禁规则
- `agent_contracts`：agent 执行契约（工具权限、上下文模板等）
- 由 `SpecProfileProvider.load_manifest` 从 JSON 文件解析填充
- `get_active_manifest` 按优先级/标记取当前生效的 profile

## 注意事项
- 模块无路由，所有能力经 Python API 暴露，改动时注意 import 路径稳定性
- `SpecProfileProvider(source_path=None)` 为 None 时用默认路径（.sillyspec profile 目录）
- `StagePolicy` / `DocumentPolicy` 有完整单测（`tests/test_policy.py`），策略可独立替换
- 冲突解决后不自动重验，需 spec_workspace 侧再次触发 bootstrap
- profile 定义在 .sillyspec 目录（文件系统），DB 仅做缓存与冲突记录
- manifest 的 stages/documents/gates/agent_contracts 字段未来宜强类型化，当前是 dict
- 冲突检测是叠加多个 manifest 时触发，单 manifest 无冲突概念
- `ConflictDetail` 含冲突资源路径与差异描述，供前端冲突列表展示
- SpecConflict.resolved 标志冲突是否已处理，解决后置 true
- spec_workspace 的 /spec-conflicts 端点直接读 SpecConflict 表
- profile_data JSON 字段存原始 manifest，避免 schema 演进丢字段
- StagePolicy 检查阶段名/顺序冲突，DocumentPolicy 检查文档类型冲突
- discover_manifests 扫描 source_path 下所有 manifest JSON，不递归子目录外
- StagePolicy.check_stage_conflict 比对已有/新 stage 名与顺序
- DocumentPolicy.check_document_conflict 比对文档类型清单重叠
- ConflictDetail 含 resource 标识 + 差异描述，前端按此渲染冲突项
- spec_workspace 的 resolve 端点把 SpecConflict.resolved 置 true
- provider.load_manifest 解析失败返回 None，调用方需判空
- profile_data JSON 存原始 manifest 全量，schema 演进不丢字段
- SpecConflict 的 conflict_type Literal 限定取值，防脏数据
- provider 的 source_path 默认指向 .sillyspec/profiles 目录
- StagePolicy/DocumentPolicy 无状态，可单例复用
- profile version 用于检测 manifest 升级冲突
- SpecProfileManifest 的 source_path 记 manifest 文件来源
- Policy 类返回空 ConflictDetail 列表表示无冲突

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
