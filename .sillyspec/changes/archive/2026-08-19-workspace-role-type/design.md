---
author: qinyi
created_at: 2026-08-18 22:58:00
change: 2026-08-18-workspace-role-type
scale: large
test_strategy: module
risk_level: unit-sufficient
---

# 设计文档（Design）— 工作区角色类型

## 1. 背景

工作区与 PPM 项目的关联（2026-07-28-ppm-project-link-workspace A 阶段）落地后，关联表只回答了"项目和哪些工作区有关"，没有回答"这个工作区是项目里的**什么**"——是前端代码、后端代码、业务文档还是某个模块。用户的目的是：后续会话能按项目直接定位到对应角色的工作区，agent 执行时有据可查。

现状事实（源码核对，2026-08-18）：
- `Workspace` 表已有 `component_key`(String 100) / `type`(String 50) / `role`(String 100) 三个组件元数据字段（ADR-07 从 ProjectComponent 吸收，`backend/app/modules/workspace/model.py:65-77`），但创建/更新 API 虽接受它们，前端从未暴露，实际数据基本为 NULL。
- 模型无 description/用途字段。
- 工作区列表页类型筛选下拉只有"全部类型 / Daemon 客户端"两项，`daemon-client` 是已废弃旧值（service.py:369 注释确认 path_source 语义，精确匹配无命中）。
- `projects/*.yaml` 拓扑解析（parser.py:243 `raw.get("type")`）把 yaml 组件的 `type` 原样透传进 `Workspace.type`，与用户语义各自为政。
- 项目→工作区接口返回 `WorkspaceBrief { workspace_id, name, status, type }`（schema.py:289-295），前端 LinkWorkspaceDialog 已展示 `w.type` 原始字符串（LinkWorkspaceDialog.tsx:157-159）。

## 2. 设计目标

- FR-01 工作区类型受控词表：`type` 收成 8 值之一（`frontend-code`/`backend-code`/`fullstack`/`business-doc`/`submodule`/`deploy-ops`/`design-asset`/`other`），后端常量 + Pydantic Literal 校验，进 OpenAPI 枚举。
- FR-02 新建工作区时必填类型（添加工作区弹窗加下拉）；`role` 保留自由文本（≤100 字符，如"订单模块"）。
- FR-03 新增 `description` 字段（Text 可空），工作区用途说明。
- FR-04 工作区列表页：卡片显示类型徽标；类型筛选下拉换成新词表；"未分类"用专用查询参数 `?unclassified=true`（`type IS NULL` 谓词，`?type=` 等值匹配表达不了 NULL），移除废弃 `daemon-client` 项。
- FR-05 工作区详情页可编辑 type/role/description（PATCH）。
- FR-06 PPM 项目侧"关联工作区"列表（LinkWorkspaceDialog 已关联区）按新词表渲染类型徽标，并在可选工作区列表里透出类型信息，辅助选择。
- FR-07 yaml 拓扑组件的 type 在**组件目录展示层**按映射规则归一到新词表（parser 产物只供 component_catalog 只读展示，不落 Workspace 表——2026-07-06-component-readonly-split 已切断落库路径）；yaml 的 `role`/`description` 随 ParsedWorkspace 透传，ComponentRead 响应补 `description` 字段供目录展示。
- FR-08 `WorkspaceBrief` 补 `role` + `description` 字段，项目侧拿到完整定位信息。

## 3. 非目标

- ❌ 不做"项目会话按工作区角色选择工作区"的会话入口（属下一个变更"跨工作区团队执行"的地基消费方）。
- ❌ 不在关联表 `ppm_project_workspace` 上加任何元数据（维持 2026-07-28 变更 Non-Goal 决策：类型放工作区本体，同一工作区跨项目同类型）。
- ❌ 不做旧值自动迁移兼容到逐值保真——项目未上线允许重置数据；存量非空 type 里映射不上的**显示原值不崩**即可。
- ❌ 不改 daemon / 会员绑定 / spec 同步链路（type 对它们无语义）。
- ❌ 不做移动端新功能（类型编辑等新 UI 不加移动端页面）；但移动端**既有**的列表筛选与创建调用点必须最小同步修齐（见 §5.6），否则后端必填/422 化会造成被动回归——这不是移动端适配，是破坏面收口。

## 4. 拆分判断

单功能横切 backend schema/migration/parser + frontend 五个界面点，无独立可交付的多模块拆分价值，一个 change 内按 Wave 组织（backend → gen:types → frontend → 测试收口）。不需要批量模式（非"模板×数据"形态）。

## 5. 总体方案

### 5.1 词表（单一事实源）

`backend/app/modules/workspace/constants.py`（新建）：

```python
WORKSPACE_TYPE_VALUES = (
    "frontend-code", "backend-code", "fullstack", "business-doc",
    "submodule", "deploy-ops", "design-asset", "other",
)
WorkspaceTypeLiteral = Literal[
    "frontend-code", "backend-code", "fullstack", "business-doc",
    "submodule", "deploy-ops", "design-asset", "other",
]
# yaml 拓扑组件 type → 新词表映射（仅收编明确映射，映射不上保留原值）
YAML_TYPE_NORMALIZE_MAP = {
    "frontend": "frontend-code", "frontend-app": "frontend-code",
    "web": "frontend-code",
    "backend": "backend-code", "backend-api": "backend-code", "api": "backend-code",
    "service": "backend-code",
    "fullstack": "fullstack", "monorepo": "fullstack",
    "docs": "business-doc", "doc": "business-doc", "documentation": "business-doc",
    "module": "submodule", "submodule": "submodule",
    "deploy": "deploy-ops", "infra": "deploy-ops", "devops": "deploy-ops",
    "design": "design-asset",
}
```

中文标签与徽标配色放前端常量（`frontend/src/lib/workspace-types.ts`），key 与后端词表逐字对齐（gen:types 生成 Literal 后 tsc 保证）。

### 5.2 数据模型

- `Workspace` 新增 `description: str | None`（`Column(Text, nullable=True)`）。
- `type` 列宽 String(50) 不变（最长值 `frontend-code` 13 字符，宽裕）。
- Migration：add `description` 列 + 一条存量收编 UPDATE（`UPDATE workspaces SET type = CASE` 按 YAML_TYPE_NORMALIZE_MAP 的可映射子集；映射不上的保持原值）。

### 5.3 后端 schema / service

- `WorkspaceCreate.type: WorkspaceTypeLiteral` **必填**（默认值不设——显式必填，OpenAPI required + enum）；`description: str | None = None`（max 2000）。
- `WorkspaceUpdate.type: WorkspaceTypeLiteral | None`——语义为 **omit=不改 / null=清空**（与现有 exclude_unset 实现一致：显式传 null 即清除该值，与 default_agent 字段模式相同）。`role`/`description` 同语义：omit 不改、传 null 清空。
- `WorkspaceRead` 补 `description`。
- `WorkspaceBrief` 补 `role` / `description`。
- 列表接口 `?type=` 查询参数改为 `WorkspaceTypeLiteral | None` 校验（传非法值/旧值 422），新增 `?unclassified: bool = False`（true 时过滤 `type IS NULL`，与 type 参数互斥——同时传 422）。调用点修齐见 §5.6。
- parser.py `_parse_workspace`：`type_` 经 `YAML_TYPE_NORMALIZE_MAP.get(type_, type_)` 归一 + `raw.get("description")` 透传（KNOWN_COMPONENT_KEYS 同步加 `description` 键，避免落进 extra）；ParsedWorkspace dataclass 加 `description` 字段。**归一与透传只到 parser 产物/组件目录展示层（component_catalog_service 读 ParsedWorkspace 构建 ComponentRead），不落 Workspace 表**（readonly-split 后 parser 与 Workspace 写路径已解耦）；ComponentRead 补 `description` 字段。

### 5.4 前端

- 新建 `frontend/src/lib/workspace-types.ts`：`WORKSPACE_TYPE_OPTIONS`（value+中文 label+badge class 8 项 + `UNCLASSIFIED` 展示项）、`workspaceTypeBadge(type)`（未知值/NULL → 灰色"未分类"，非空未知 → 原值灰徽标）。
- 添加工作区弹窗（workspace-scan-dialog.tsx）：daemon-client 创建路径加"工作区类型"必选下拉 + "描述"选填 textarea；`createWorkspace` 入参补 `type`/`description`。
- 工作区列表页（workspaces/page.tsx）：类型筛选下拉换 `WORKSPACE_TYPE_OPTIONS` + 全部/未分类；WorkspaceCard 显示类型徽标（复用 badge helper）。
- 工作区详情页：新增"基本信息"编辑区（类型下拉/角色输入/描述 textarea），PATCH 保存（复用现有 updateWorkspace client，`frontend/src/lib/workspaces.ts` 的 Create/Update Input 补字段）。
- PPM 项目关联弹窗（LinkWorkspaceDialog.tsx）：已关联列表 `w.type` 从原始字符串改为徽标渲染 + title 里带 role/description 摘要；可选工作区列表项补类型徽标。
- 工作区侧"关联项目"区块（LinkedProjectsSection.tsx）不动（展示的是项目信息，无工作区类型信息需求）。

### 5.5 类型生成

后端 schema 改完 → `pnpm gen:types`（先确认前端 node_modules 健康）→ `api-types.ts` + `backend/openapi.json` 同 change 提交。

### 5.6 移动端与其它调用点收口（破坏面清单， Grill P0-C）

`Create.type` 必填 + `?type=` 422 化影响的所有调用点，同 change 内最小修齐（不加移动端新功能）：
- 移动端列表筛选 `frontend/src/app/(dashboard)/m/workspaces/page.tsx:130` 附近（现传 daemon-client 旧值）→ 换新词表下拉或退化为纯状态筛选（最小改：删类型筛选项）。
- 移动端创建 `createWorkspace` 调用点（同页 :548 附近）→ 提交体补 `type`（默认 `other` 或加简易选择，取最小实现）。
- 桌面端 workspaces/page.tsx 筛选（§5.4 已列）。
- 后端存量测试 `backend/tests/modules/workspace/test_workspace_admin_management.py:262/268`（用 `?type=daemon-client`/`web` 断言）→ 改用新词表值重写断言。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | backend/app/modules/workspace/constants.py | 词表单一事实源：WORKSPACE_TYPE_VALUES + WorkspaceTypeLiteral + YAML_TYPE_NORMALIZE_MAP。producer=本常量 → consumer=schema 校验 / service 列表过滤 / parser 归一 / migration 收编 UPDATE |
| 修改 | backend/app/modules/workspace/model.py | Workspace 加 description 列（Text, nullable） |
| 新增 | backend/migrations/versions/20260818150000_workspace_role_type.py | add description 列 + 存量 type 收编 UPDATE；down_revision=20260817100000（当前唯一 head） |
| 修改 | backend/app/modules/workspace/schema.py | Create.type 必填枚举+description；Update.type 枚举+role/description；Read/Brief 补 description（Brief 另补 role）；list type 参数枚举校验。数据流：producer=前端表单/daemon-client create → schema 校验（Literal）→ service 落库 → consumer=Read/Brief 响应（OpenAPI 枚举）→ 前端 api-types.ts 生成 |
| 修改 | backend/app/modules/workspace/router.py | list 路由：type Query 参数枚举化 + unclassified 参数 + 与 type 同传 422（AppError HTTP_422_WORKSPACE_TYPE_UNCLASSIFIED_CONFLICT） |
| 修改 | backend/app/modules/workspace/service.py | create/update 透传 description；parser 归一后的 type 落库不变（沿用现有字段写入路径）；list type 过滤签名改 Literal + unclassified IS NULL 谓词 |
| 修改 | backend/app/modules/workspace/parser.py | _parse_workspace：type 经 YAML_TYPE_NORMALIZE_MAP 归一 + description 透传 + KNOWN_COMPONENT_KEYS 加 description。数据流：producer=projects/*.yaml 组件 type/description → parser 归一（map.get(v,v)）→ ParsedWorkspace → consumer=component_catalog_service（组件目录只读展示，ComponentRead 补 description），不落 Workspace 表 |
| 修改 | backend/app/modules/workspace/component_catalog_service.py | ComponentRead 构造补 description（读 parser 产物） |
| 修改 | backend/app/modules/workspace/link_service.py | WorkspaceBrief 构造补 role/description（读现有列，无新查询） |
| 新增 | frontend/src/lib/workspace-types.ts | 前端词表/徽标 helper（key 对齐后端） |
| 修改 | frontend/src/lib/workspaces.ts | CreateWorkspaceInput 加 type/description（type 必填）；UpdateWorkspaceInput 加 type/role/description |
| 修改 | frontend/src/components/workspace-scan-dialog.tsx | 类型必选下拉 + 描述 textarea，提交体带两字段 |
| 修改 | frontend/src/app/(dashboard)/workspaces/page.tsx | 类型筛选下拉换新词表+未分类（unclassified=true 参数，删 daemon-client 项）；WorkspaceCard 传类型徽标 |
| 修改 | frontend/src/app/m/workspaces/page.tsx | 移动端最小收口：类型筛选旧值处理 + createWorkspace 提交体补 type（见 §5.6） |
| 修改 | frontend/src/components/workspace-card.tsx | 卡片渲染类型徽标（组件实际在 components 根目录，非 workspace/ 子目录） |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/page.tsx | 基本信息编辑区（type/role/description PATCH） |
| 修改 | frontend/src/components/workspace/LinkWorkspaceDialog.tsx | 已关联/可选列表类型徽标 + title 摘要 |
| 修改 | frontend/src/lib/workspace.ts | 手写 Brief 镜像类型补 role/description（与后端 WorkspaceBrief 对齐，供项目侧消费） |
| 再生成 | frontend/src/lib/api-types.ts | pnpm gen:types（enum+新字段自动进类型） |
| 再生成 | backend/openapi.json | pnpm gen:types 同步产出 |

涉及测试（新增/修改）：backend workspace 模块 tests（schema 枚举校验、parser 归一、component_catalog description 透传、link Brief 字段）；backend/app/modules/workspace/tests/test_workspace_admin_management.py:262/268 旧值断言改新词表；frontend 相关组件 vitest（scan-dialog 提交体、列表筛选、LinkWorkspaceDialog 徽标、详情编辑 PATCH）。

## 7. 接口定义

```python
# constants.py
WORKSPACE_TYPE_VALUES: tuple[str, ...]          # 8 值
WorkspaceTypeLiteral = Literal["frontend-code", "backend-code", "fullstack",
                               "business-doc", "submodule", "deploy-ops",
                               "design-asset", "other"]
YAML_TYPE_NORMALIZE_MAP: dict[str, str]         # yaml type → 词表值

# schema.py
class WorkspaceCreate(BaseModel):
    ...
    type: WorkspaceTypeLiteral                    # 必填
    role: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=2000)

class WorkspaceUpdate(BaseModel):
    ...
    type: WorkspaceTypeLiteral | None = None      # omit=不改 / null=清空
    role: str | None = None
    description: str | None = None

class WorkspaceBrief(BaseModel):
    workspace_id: uuid.UUID
    name: str
    status: str
    type: str | None = None
    role: str | None = None
    description: str | None = None

# GET /api/workspaces?type= → Query[WorkspaceTypeLiteral | None]
# GET /api/workspaces?unclassified=true → type IS NULL（与 type 互斥，同传 422）
```

API 端点不变（POST /api/workspaces、PATCH /api/workspaces/{id}、GET /api/ppm/projects/{id}/workspaces），只变请求/响应体字段。

## 7.5 生命周期契约

不适用 lifecycle contract——本变更不涉及 session/lease/agent_run/daemon 生命周期事件，无状态机变化（纯字段+校验+UI）。

## 8. 数据模型

```sql
ALTER TABLE workspaces ADD COLUMN description TEXT NULL;
-- 存量收编（幂等，可重跑）：
UPDATE workspaces SET type = CASE type
    WHEN 'frontend' THEN 'frontend-code' WHEN 'frontend-app' THEN 'frontend-code'
    WHEN 'web' THEN 'frontend-code' WHEN 'backend' THEN 'backend-code'
    WHEN 'backend-api' THEN 'backend-code' WHEN 'api' THEN 'backend-code'
    WHEN 'service' THEN 'backend-code' WHEN 'fullstack' THEN 'fullstack'
    WHEN 'monorepo' THEN 'fullstack' WHEN 'docs' THEN 'business-doc'
    WHEN 'doc' THEN 'business-doc' WHEN 'documentation' THEN 'business-doc'
    WHEN 'module' THEN 'submodule' WHEN 'submodule' THEN 'submodule'
    WHEN 'deploy' THEN 'deploy-ops' WHEN 'infra' THEN 'deploy-ops'
    WHEN 'devops' THEN 'deploy-ops' WHEN 'design' THEN 'design-asset'
    ELSE type END
WHERE type IS NOT NULL;
```

## 9. 兼容策略

- 存量 type 为 NULL：前端统一显示"未分类"灰徽标，不强制回填。
- 存量 type 非空且映射不上：migration 保留原值；schema 读路径不校验存量（WorkspaceRead.type 仍是 `str | None`，仅写入路径 Literal 校验）；前端徽标 helper 未知值 → 原值灰徽标，不崩。
- `?type=` 查询参数：旧值从此 422（§5.6 列出全部调用点同 change 修齐，含移动端与后端存量测试）。
- Update 语义：omit=不改 / 显式 null=清空（与现有 exclude_unset 行为一致，description 可清空，type 清空后前端显示"未分类"）。
- migration 存量收编 UPDATE 只影响 Workspace 表；组件目录（parser 产物）的归一在读取时动态做，无存量迁移问题。
- daemon 创建工作区路径（service.create 内部调用）：~~补 type 默认 `other`，不炸内部调用方~~（execute 实测修正：生产代码零 WorkspaceCreate 内部构造——scan_generate 直建 Workspace 不经 Create schema，type 留 NULL 显示"未分类"，语义自洽；移动端/测试调用点按 §5.6 收口补 type。QA P3 备注，不改代码）。
- 回退路径：migration 有 downgrade（drop description 列；type 收编不回滚——原值已被 CASE 覆盖，回滚无意义，downgrade 里注明）。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 词表满足不了未来场景，频繁加值 | P2 | 加值=改 constants.py 一处 + 前端词表镜像 + gen:types，成本可控；词表设计已留 `other` 兜底 |
| R-02 | yaml 收编映射规则漏判（组件 type 千奇百怪） | P2 | 只收编明确映射；映射不上保留原值 + 前端灰徽标兜底，不丢数据 |
| R-03 | Create.type 改必填破坏内部调用方（测试/脚本里裸建 workspace） | P1 | execute 时全仓 grep `WorkspaceCreate(` 修齐；daemon 内部路径默认 other |
| R-04 | `?type=` 422 影响非桌面前端消费方 | P1 | §5.6 破坏面清单已列（移动端 m/workspaces 筛选+创建、后端存量测试），execute 逐项修齐后全仓 grep 复核 |
| R-07 | 移动端最小收口改动引入回归 | P1 | 只做"筛选旧值移除 + 提交体补 type"两处最小改，不动移动端布局；vitest 无移动端组件测试则以后端契约测试兜底 |
| R-05 | gen:types 撞 node_modules 半坏报假错 | P2 | 按 CLAUDE.md 规程先 `pnpm exec tsc --version` 验健康，坏则 `pnpm install --force` |
| R-06 | description 长文本撑坏列表卡片布局 | P2 | 列表/弹窗只显截断单行（line-clamp），全文进详情页与 title |

## 11. 决策追踪

- D-001@v1：类型语义放工作区本体，不放 ppm_project_workspace 关联表（同一工作区跨项目同类型）。覆盖 FR-01/FR-06；延续 2026-07-28-ppm-project-link-workspace 的 Non-Goal"关联表不存元数据"决策。
- D-002@v1：type 必选受控词表（方案 A），拒绝自由文本（B）与父子两层（C）。覆盖 FR-01/FR-02。用户 2026-08-18 对话确认。
- D-003@v1：yaml 拓扑 type 收编采用"仅明确映射"策略，映射不上保留原值。覆盖 FR-07/R-02。设计自定（用户授权按推荐落地）。
- D-004@v1（Grill 追加）：parser 产物不落 Workspace 表（2026-07-06-component-readonly-split 已解耦），FR-07 收敛为组件目录展示层归一 + ComponentRead 补 description。覆盖 FR-07/§5.3。来源 Design Grill P0-A。
- D-005@v1（Grill 追加）：Update 语义 omit=不改 / null=清空（对齐现有 exclude_unset 实现），"未分类"筛选走专用 `?unclassified=true` 参数。覆盖 FR-04/§5.3/§9。来源 Design Grill P0-B/P1。
- D-006@v1（Grill 追加）：移动端既有调用点最小收口（筛选旧值+创建补 type），不做移动端新功能。覆盖 §5.6/R-04/R-07。来源 Design Grill P0-C。

## 12. 自审（Self-Review）

- ✅ 章节齐全（背景/目标/非目标/总体方案/文件清单/接口/数据模型/兼容/风险/决策/自审）。
- ✅ 生命周期关键词命中检查：正文含 daemon（词面）——已按规则写明 7.5 豁免（不涉及 session/lease/agent_run/daemon 生命周期事件，无状态机）。
- ✅ 字段数据流闭环核对：Workspace.type/description 从 producer（表单）→ schema Literal 校验 → service 落库 → Read/Brief → OpenAPI 枚举 → 前端 gen:types → 徽标渲染；yaml 组件 type/description → parser 归一 → 组件目录 ComponentRead 展示（不落库）。每跳在 §5/§6 标注，无 dormant 字段。
- ✅ Create.type 必填的破坏面已列 R-03/§5.6 并给对策；`?type=` 消费面已列 R-04/§5.6（含移动端与后端存量测试）。
- ✅ 与 2026-07-28-ppm-project-link-workspace 决策无冲突（其 Non-Goal"关联元数据"由本变更在**本体侧**承接，不推翻其"关联表纯净"决策）。
- ✅ Grill 交叉审查（独立子代理）发现的 3 P0 + 1 P1 + 1 P2 已全部修订落进本版：P0-A→D-004/FR-07 改述、P0-B→unclassified 参数/D-005、P0-C→§5.6 破坏面清单/D-006、P1→Update omit/null 语义、P2→测试清单补 admin_management 旧值断言。plan 阶段 postcheck 对账时已把 2 处路径笔误改为真实路径（§5.6/§6：移动端页 frontend/src/app/m/workspaces/page.tsx、测试 backend/app/modules/workspace/tests/）。
- ⚠️ 自审存疑 1：WorkspaceCard 组件实际文件名/props 未逐行核（design 按调研结论假定 `workspace-card.tsx`），execute task 开头先核对，路径不对就修正引用，不视为设计漂移。
- ⚠️ 自审存疑 2：yaml 实际数据里组件 type 用词未抽样统计（R-02 兜底策略覆盖），execute 时抽 1-2 个真实 projects/*.yaml 验证映射命中率。
