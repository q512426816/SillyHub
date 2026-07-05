---
author: qinyi
created_at: 2026-07-04T19:05:30
---

# Decisions — 修复前端类型对齐 5 处分叉

## D-001@v1 scan-docs 走"后端补字段保留 UI"
**背景**：scan-docs 徽章恒 undefined，前端类型声明 5 个后端不返字段。
**选项**：A 删前端幽灵字段+UI / B 后端补字段保留 UI / C 只删 conflict_count 保留 source_member_id。
**决策**：B（用户选）。
**理由**：保留"来源成员/冲突数"产品能力；后端 model 已有 `source_*` 字段（暴露成本低）；`conflict_service.list_history` 已存在可复用算 conflict_count；conflicts 端点补齐只读历史能力。
**影响**：W1-2 后端 schema+service+router；FR-001/FR-002/FR-007。

## D-002@v1 runtime 删 alias 改 snake_case
**背景**：DTO `Field(alias=camelCase)` + `response_model_by_alias=False` 致 OpenAPI camelCase 与运行时 snake 不一致。
**选项**：A 后端删 alias / B 改 `by_alias=True` + 前端改 camelCase / C 不迁移。
**决策**：A。
**理由**：项目其他 DTO 普遍纯 snake 无 alias；运行时本就 snake（`by_alias=False`），删 alias 行为不变；前端字段访问零改动；单文件改动 + service 构造参数同步（Grill 抓到 service.py:178-185 用 alias key 构造的依赖）。
**影响**：W1-1（schema.py + router.py + service.py:178-185）；FR-003。

## D-003@v1 audit details_json 前端改 string
**背景**：后端 `details_json` 是 JSON 字符串（Text 列，`audit_hooks` 用 `json.dumps`），前端类型写成 object 且 `JSON.stringify` 二次序列化。
**选项**：A 前端改 string+JSON.parse / B 后端改 dict 返回。
**决策**：A。
**理由**：生成类型已对齐 string（OpenAPI ground truth）；DB 审计表存原始 JSON 字符串是合理设计（避免 schema 漂移）；纯前端单文件修复；`spec-workspaces.ts` 的 `SpecConflictRead.details_json: string | null` 是同项目范式参照。
**影响**：W3 audit.ts + page.tsx；FR-004。

## D-004@v1 workspace-binding 删 router try/except 走全局处理器
**背景**：三端点无 response_model；router.py:104-108 的 try/except + dict 返回会与 response_model 冲突。
**决策**：删 router.py:104-108 try/except；service.py:52 已 `raise AppError(http_status=403, code="daemon_not_owned")` 走全局处理器（`errors.py:344` 用 `exc.http_status`）。三端点加 `response_model=MemberBindingView`（schema 已存在于 router.py:45-55）。
**理由**：与其他端点错误路径一致；消除 response_model 冲突；body 格式由全局处理器统一。
**影响**：W1-3；FR-005。

## D-005@v1 workspaces 机械迁移
**背景**：9 类型字段与生成类型一致，仅 2 类机械分叉（枚举少 pending + 类型重命名）。
**决策**：机械迁移到生成类型，~10 文件 import 改名，字段访问零改动。
**理由**：分叉根因最干净（无孤儿类型/dict 退化/后端重构）；改动半径可控；为 daemon/changes 后续迁移铺路。不迁移 daemon/changes/admin（负收益，留后续）。
**影响**：W3 workspaces.ts + import 文件；FR-006。
