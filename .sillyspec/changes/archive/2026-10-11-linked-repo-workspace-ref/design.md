---
author: qinyi
created_at: 2026-10-11 16:53:55
generated_by: sillyspec-design-init
scale: "large"  # TODO：Step 8 规模评估落值——单上下文可吞吐=small（flow start 收编）；需 Wave 编排/上下文分片/多阶段治理=large（run plan）；拿不准 small
---

# 设计文档（Design）— 2026-10-11-linked-repo-workspace-ref

<!-- 由 sillyspec design-init 生成的骨架（2026-10-11-linked-repo-workspace-ref）——逐节填散文后删除本注释；存量手写路径不受影响 -->
<!-- 引用规范：全文源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工） -->

## 背景

关联仓功能（两前序变更）解决了「跨仓信息登记→落盘工具消费点」与「本机现状回显导入」，但登记条目仍是自由文本（名称/地址/路径）——平台上明明有对方仓的工作区（root_path/成员绑定/daemon），关联仓条目却与之毫无关系。用户诉求：关联仓与平台工作区关联上（点击可跳转/回显时自动匹配提示可挂载）。

## 设计目标

- **挂载引用**：关联仓条目可挂一个平台工作区（可空 FK ref_workspace_id）。
- **跳转**：列表条目显示对方工作区名，可点击直达对方工作区详情页。
- **回显匹配**：本机回显对照时按条目名匹配平台工作区列表，命中时提示「匹配到平台工作区 XX，可关联」。
- 不做自动写库/双向/路径复用（D-002）。

## 非目标

- 不做：自动按名字匹配写库（只提示 matched_workspace，用户手动确认挂载）。
- 不做：双向同步（A 挂 B 不自动在 B 挂 A）。
- 不做：复用对方工作区绑定路径/daemon（跨权限边界，v2 候选）。
- 不做：删除对方工作区时级联删关联仓登记行（读时降级方案：摘要层过滤软删，行与 FK 值保留）。

## 拆分判断

两任务（backend 迁移+API / frontend 下拉+跳转+提示+gen:types）串行；同域两前序变更基建齐备，纯字段扩展非批量。

## 总体方案

单一数据面扩展：workspace_linked_repos 加一列可空 FK ref_workspace_id → workspaces.id
（DB 级 ondelete=SET NULL 仅作防御性保留——平台工作区删除是纯软删除（deleted_at/status），DB 级 SET NULL 实际不触发；真实语义走读时降级：Out 摘要 join 与 matched_workspace 匹配一律 deleted_at IS NULL 过滤，软删后摘要为 null、登记行保留。Grill X-001 修正）。三端各一层薄改：

1. **backend 模型/迁移**：列 + FK + 索引；schema 扩展（Create/Update 加 ref_workspace_id，
   Out/LocalSnapshotEntry 加 ref_workspace/matched_workspace 摘要 {id,name,slug}）；
   PATCH 挂载/摘除（null 清除）；挂载校验：目标工作区存在且非软删且不等于当前工作区（422）。
   local-snapshot 对照时仅对 local_only 条目、按 key 在当前用户可见工作区集（过滤软删；
   限定可见集避免向非管理员泄露不可见工作区的 name/slug——Grill X-002 修正）name/slug
   精确匹配附 matched_workspace（只提示不写库）；多命中 tie-break：name 优先于 slug，
   仍多命中取 id 最小（确定性）。
2. **frontend**：表单下拉（数据源=GET /workspaces 可见集，排除自身工作区；选项摘要 {id,name,slug}）；列表条目已挂载→
   显示对方名+跳转图标（router push）；回显条目 matched_workspace 命中→「匹配到 XX」提示。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/workspace/linked_repos/model.py | WorkspaceLinkedRepo 加 ref_workspace_id 列（可空 FK SET NULL） |
| 新增 | NEW:backend/migrations/versions/20261011020000_add_linked_repo_ref_workspace.py | 加列+FK+索引 |
| 修改 | backend/app/modules/workspace/linked_repos/schema.py | Create/Update 加 ref_workspace_id；Out 加 ref_workspace 摘要；LocalSnapshotEntry 加 matched_workspace |
| 修改 | backend/app/modules/workspace/linked_repos/service.py | create/update 支持挂载摘除；list_repos 返回 ref 摘要；local-snapshot 匹配逻辑 |
| 修改 | backend/app/modules/daemon/linked_repos_sync.py | fetch_local_snapshot 对照时附 matched_workspace（在工作区列表内匹配） |
| 修改 | backend/app/modules/workspace/linked_repos/router.py | PATCH body 扩展（ref_workspace_id: str|None 可选） |
| 修改 | backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py | 挂载/摘除/SET NULL/匹配/权限用例 |
| 修改 | frontend/src/components/workspace/linked-repos-card.tsx | 表单下拉/列表跳转/回显匹配提示 |
| 修改 | frontend/src/components/workspace/linked-repos-form.tsx | 下拉选工作区（排除自身） |
| 修改 | frontend/src/lib/linked-repos.ts | 类型扩展 |
| 修改 | frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx | 挂载跳转/匹配提示/下拉交互用例 |
| 重新生成 | frontend/src/lib/api-types.ts | pnpm gen:types |
| 重新生成 | backend/openapi.json | gen:types 同源 |

## 接口定义

既有端点字段扩展（零新端点）：
- POST/PATCH body 加 `ref_workspace_id?: string | null`（挂载/摘除；校验：目标存在且非软删且不等于当前工作区，错误 422 REF_WORKSPACE_INVALID；null=摘除）
- GET 列表 items[] 加 `ref_workspace?: { id, name, slug } | null`
- GET local-snapshot entries[] 加 `matched_workspace?: { id, name, slug } | null`（按 key 在平台工作区 name/slug 精确匹配，只提示不写库）

## 生命周期契约表

本变更无生命周期契约变更（纯 CRUD 字段扩展，无 session/lease/daemon/heartbeat 行为变化；背景段 daemon 一词仅引前序变更域，非本变更触点）。

## 数据模型

workspace_linked_repos 加列：
- `ref_workspace_id: UUID | null`（FK → workspaces.id，ondelete=SET NULL，索引）
- 语义：挂载引用（一条关联仓最多挂一个平台工作区）；对方工作区软删后行保留、读时摘要降级为 null（Grill X-001：平台无硬删路径，DB 级 SET NULL 为防御性兜底不依赖）。

## 兼容策略（brownfield 必填）

- 存量行 ref_workspace_id 全 null（add nullable column 无 default）——老条目零影响。
- 协议 additive：新字段全 optional，老前端遇新字段忽略。
- openapi/api-types 再生成对老消费方无 breaking（optional 字段）。
- matched_workspace 仅 local_only 条目、both 条目恒 null（不改变三态对照语义）。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 软删工作区残留引用（FK 值在库指向死行） | P1 | 读时降级：摘要 join 与匹配一律 deleted_at IS NULL 过滤；挂载校验拒软删目标（Grill X-001） |
| R-02 | matched_workspace 全表匹配泄露不可见工作区名/slug | P1 | 匹配范围限定当前用户可见工作区集（Grill X-002）；可见集为空则 matched 恒 null |
| R-03 | 前端下拉数据源分页截断（工作区多时漏选项） | P2 | 下拉带搜索（按名过滤），后端列表端点已有 query 支持 |
| R-04 | UI 原型跳过 | P3 | 本变更是既有卡片内增量（下拉/跳转图标/提示条标准 antd 形态），不另出原型——自审声明 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | 设计目标/总体方案/接口定义（挂载+跳转+匹配） | 已覆盖 |
| D-002@v1 | 非目标四条/数据模型（不落库）/风险登记 R-02 | 已覆盖 |

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale）
- [x] 引用所有当前版本 D-xxx@vN
- [x] 涉及生命周期关键词时含「生命周期契约表」或紧邻豁免短语
- [x] UI 原型分级核对（R-04 跳过理由在风险登记）（涉前端文件时变更目录应有 prototype-*.html 或跳过原因记入风险登记）
- [x] 不确定的问题标注（无存疑项）「⚠️ 自审存疑」
