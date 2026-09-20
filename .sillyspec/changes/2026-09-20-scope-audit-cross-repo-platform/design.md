---
author: qinyi
created_at: 2026-09-20 19:45:52
generated_by: sillyspec-design-init
scale: large
---

# 设计文档（Design）— 2026-09-20-scope-audit-cross-repo-platform

<!-- 引用规范：全文源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工） -->

## 背景

平台变更中心的「范围对账（scope-audit）」卡经 平台链路（GET /sillyspec/scope-audit → daemon RPC `sillyspec_scope_audit` → 本机 CLI `sillyspec scope-audit --change <c> --json`）出对账表。工具侧（sillyspec 仓变更 2026-09-20-scope-audit-cross-repo，已归档）已把 `--json` 契约升级为 v2：跨仓行从「⊘ 本表不含（恒 untouched）」升级为按仓真实对账（行级 `crossRepo` + 真实三态/行数），信封新增 `repos[]`（每仓锚点档/三态计数/降级原因）。实证案例 workspace f85a6650（EHS_BACK 多仓变更，主仓 20 / sub-grid-security 13 / spdemo 9）：现状平台对账卡显示「⚠️ 计划未动 22」，恰为 22=13+9 两个跨仓段全部文件——用户无法判断跨仓文件到底做没做，跨仓真实状态在平台上不可见。完整复盘见 docs/sillyspec/finished/scope-audit-cross-repo-blindness.md。

平台链路现状（v1 消费面）：daemon `auditTable` 投影（sillyhub-daemon/src/sillyspec-manager.ts:1521-1600）只透传 8 个行级字段，CLI 已产出的 `crossRepo`/`facility`/`suspectedForeignDone` 行级标注与 note 在投影层被丢弃；backend `ScopeAuditRow`（backend/app/modules/change/schema.py:692-704）无对应字段；前端卡片（frontend/src/components/changes/scope-audit-command-card.tsx:119-130,245-254,306-356）只按三态 verdict 聚合、note 完全不渲染。

上游契约权威源：sillyspec 仓 `.sillyspec/changes/archive/2026-09-20-scope-audit-cross-repo/design.md`「接口定义」节（--json 契约 v2，主仓行形状逐字段不变，additive）。

## 设计目标

1. daemon 投影消费契约 v2：行级 `cross_repo` + 信封 `repos[]`（每仓 key/锚点档/三态计数/降级），`repoPath` 不出 daemon（D-001）。
2. backend change 模块 schema 增量透传（`ScopeAuditRow.cross_repo` + `ScopeAuditRepo` 族），OpenAPI 同步（gen:types）。
3. 前端对账卡按仓分组：全表合计行 + 每仓一段（主仓首位，锚点档 + 三态 chips 计数取 `repos[].totals`），degraded 仓降级文案；明细弹窗按仓分节 + 跨仓行仓标徽章；note 顶到摘要层（D-003）。
4. 全链 additive 兼容：旧 CLI（无 repos 键）/旧 daemon（不投影）/旧 backend（无字段）→ 前端回退现状单段渲染，零版本门禁（D-002）。
5. 验收（任务书原文）：workspace f85a6650 类多仓变更对账卡显示主仓段 + 各跨仓段真实三态与锚点档。

## 非目标

- 不改 CLI（工具侧已在 sillyspec 仓独立变更交付；本变更纯平台消费方）。
- 不改 RPC method 名（`sillyspec_scope_audit`）、端点路径（GET /api/workspaces/{wid}/sillyspec/scope-audit）、权限模型（WORKSPACE_READ）、错误映射族（scope_audit.py 既有 AppError 族不动）。
- 不做跨仓仓维度的平台侧 git 逻辑（锚点/git 单一源在工具，平台零自研——D-003 同源原则）。
- 不改 quick 模式链路（quick 无跨仓概念，无 repos 输出，卡片 quick 分支渲染不动）。
- 不做移动端专属布局（mobile-change-detail.tsx:494 import 复用本卡自动继承，仅跑回归）。
- 存量旧快照（无 repos、跨仓行恒 untouched）不做平台侧回算——「快照说什么是什么」，旧快照在前端自然走无 repos 回退分支。

## 拆分判断

单一纵向功能（一条数据链三跳的 additive 投影 + 消费端分组渲染），不拆分、不批量：三子项目改动是同一条 RPC 链的串联环节、消费同一份契约 v2，拆成多变更需要对两次契约接口；变更内按依赖分 3 个 Wave（daemon → backend+gen → frontend）。

## 总体方案

### Wave 1：daemon 投影（sillyhub-daemon）

`sillyspec-manager.ts` `auditTable()`（:1521-1600）投影增量：

1. 行级：`raw.crossRepo`（string）→ `cross_repo`（asStr 归一，无键/非字符串 → null），追加进现有 rows.push 白名单（:1558-1567）。
2. 信封：`parsed.repos` 非数组 → `repos: null`（旧 CLI 回退档）；是数组 → 逐条防御投影（isRecord + key 为非空 string 否则整条跳过）：
   - `anchor: { source, base, head, label }` 四字段 asStr；
   - `anchor_label`：`/^[0-9a-f]{7,40}$/.test(anchor.base)` → `base.slice(0,7)`，否则 null（与信封 anchor_label 短化同款规则，D-004）；
   - `totals`：files/additions/deletions/planned/unplanned/untouched 全走 asCount（null 容忍）；
   - `degraded`（boolean）、`degraded_reason`（asStr）；
   - **不投影 `repoPath`**（D-001：本地路径隐私，ql-20260911-003-355a 先例——daemon 侧信息含本机路径不随 RPC result 下发客户端）。
3. 类型面：`SillySpecAuditRow` 增 `cross_repo?: string | null`；新增 `SillySpecAuditRepoAnchor` / `SillySpecAuditRepoTotals` / `SillySpecAuditRepo` 接口；`SillySpecAuditTable` 增 `repos: SillySpecAuditRepo[] | null`（接口注释更新契约 v2 说明）。

### Wave 2：backend schema + 透传 + OpenAPI（backend）

1. `backend/app/modules/change/schema.py`：`ScopeAuditRow` 增 `cross_repo: str | None = None`；新增 `ScopeAuditRepoAnchor`（source/base/head/label 四个 `str | None`）、`ScopeAuditRepoTotals`（files/additions/deletions/planned/unplanned/untouched 全 `int | None`）、`ScopeAuditRepo`（key/anchor/anchor_label/totals/degraded/degraded_reason）；`ScopeAuditResponse` 增 `repos: list[ScopeAuditRepo] = []`。
2. `backend/app/modules/change/scope_audit.py` `get_scope_audit()`（:358-436）：rows 循环补 `cross_repo` 投影（isinstance str 守卫，同 declared/attribution 风格）；`result.get("repos")` 为 list 时逐条防御构造 `ScopeAuditRepo`（非法条目跳过，同 rows 风格），否则 `repos=[]`。错误映射/绑定解析/RPC 超时零改动。
3. `backend/openapi.json` 重新导出（`pnpm gen:types` 链路产物，随变更提交——规则 21）。

### Wave 3：前端消费（frontend）

1. `pnpm gen:types` 重生成 `frontend/src/lib/api-types.ts`（gen 前按规则 21 确认 node_modules 健康：`pnpm exec tsc --version` 可跑）。
2. `frontend/src/components/changes/scope-audit-command-card.tsx`：
   - **卡面**：`audit.repos` 非空数组且 `mode==='full-flow'` → 渲染分组形态（原型 prototype-scope-audit-cross-repo.html）：顶部全表合计行（锚点/文件数/+−/仓数）保留，其下每仓一段——段头 = 仓标识（`key==='main'` → 「主仓」brand 色，否则 repo key）+ 锚点档 chip（`anchor.label` 文案 + `anchor_label` 短 hash）；段身 = 三态 chips（计数取 `repos[].totals.planned/unplanned/untouched`，不前端重算）+ 该仓 files/+−；`degraded=true` 的仓段不渲染 chips，整段降级为 ⚠️ `degraded_reason` 文案；卡尾 `note` 顶到摘要层（muted 单行）。
   - **明细弹窗**：rows 按 `cross_repo` 分桶（无 `cross_repo` 行归主仓桶），桶序 = `repos[]` 序（main 首位，桶外孤儿 repo 按首现顺序尾随），每桶粘性小节头（仓标识 + 该仓锚点档），跨仓行加仓标徽章（brand 色小标签，同 quick attribution 徽章形态）；行点击 diff 联动不变（`ScopeFileDiffModal` 的跨仓路由由 CLI `--file` 侧处理，平台透传零改动）。
   - **回退**：`repos` 空/null 或 `mode==='quick'` → 现状渲染路径原样（counts-from-rows、单段 chips、明细平铺）——同一组件内双分支，不改既有 DOM 结构与 testid（`scope-audit-chip-*` 等在分组形态下升级为每仓段内 `scope-audit-chip-<repo>-<verdict>`，回退形态 testid 不变保旧测试绿）。
3. `mobile-change-detail.tsx` / `quicklog-drawer.tsx` import 复用零改动（回归跑两处既有测试）。

### 测试（随各 Wave 同步写）

- daemon `sillyhub-daemon/tests/sillyspec-file-diff.test.ts`（:305 describe 扩展）：v2 信封夹具（含跨仓行 + 三仓 repos[]）→ 投影断言（cross_repo/anchor 短化/totals 三态/degraded_reason/repoPath 不出现）；无 repos 键 → `repos: null`；截断护栏用例补跨仓行不受影响。
- backend `backend/app/modules/change/tests/test_scope_file_diff.py`：scope-audit 端点用例补 `repos` 透传断言（FakeHub 返回 v2 形态）+ 无 repos → `repos: []`。
- frontend `frontend/src/components/changes/__tests__/scope-audit-command-card.test.tsx`：分组渲染（三仓段/chips 取信封 totals/degraded 段/note 渲染）+ 回退（无 repos 单段，旧快照形态跨仓行归主仓）+ 明细分桶。
- 回归面（只跑不改为主，桩需调整时才有写面）：`frontend/src/components/mobile/mobile-change-detail.test.tsx`（import 复用卡）、`frontend/src/components/changes/__tests__/quicklog-drawer.test.tsx`（quick 抽屉挂载卡）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/sillyspec-manager.ts | auditTable 投影增量（数据流：producer=CLI `--json` v2 `rows[].crossRepo`/`repos[]` → daemon 投影归一（crossRepo→cross_repo asStr；repos 逐条防御，anchor_label=base 7 位短化，repoPath 白名单排除）→ consumer=RPC `sillyspec_scope_audit` result → backend） |
| 修改 | sillyhub-daemon/tests/sillyspec-file-diff.test.ts | auditTable describe（:305）增 v2 投影/回退/截断三组用例 |
| 修改 | backend/app/modules/change/schema.py | `ScopeAuditRow.cross_repo` + `ScopeAuditRepoAnchor/Totals/Repo` 新类 + `ScopeAuditResponse.repos`（数据流：producer=daemon RPC result → pydantic DTO 防御构造 → consumer=OpenAPI → frontend api-types.ts） |
| 修改 | backend/app/modules/change/scope_audit.py | `get_scope_audit()` 透传投影（rows 循环补 cross_repo；repos 防御构造，非法 → []） |
| 修改 | backend/app/modules/change/tests/test_scope_file_diff.py | scope-audit 端点 repos 透传/回退用例 |
| 修改 | backend/openapi.json | gen:types 链路生成物提交（schema 增量同步） |
| 修改 | frontend/src/lib/api-types.ts | gen:types 生成物（consumer=卡片组件与 lib/changes.ts 类型） |
| 修改 | frontend/src/components/changes/scope-audit-command-card.tsx | 按仓分段渲染 + 明细按仓分节 + 仓标徽章 + note 顶摘要 + 无 repos 回退单段（数据流 consumer=api-types `ScopeAuditResponse.repos`/`ScopeAuditRow.cross_repo`） |
| 修改 | frontend/src/components/changes/__tests__/scope-audit-command-card.test.tsx | 分组渲染/回退/明细分桶用例 |
| 修改 | frontend/src/components/mobile/mobile-change-detail.test.tsx | 回归（import 复用卡；桩需调整时才有写面） |
| 修改 | frontend/src/components/changes/__tests__/quicklog-drawer.test.tsx | 回归（quick 抽屉挂载卡；桩需调整时才有写面） |

（全部为已有文件修改，无新建源码文件；prototype-scope-audit-cross-repo.html 已在变更目录。）

## 接口定义

本变更接口面：1 端点（既有端点零改动，响应 DTO additive 扩展——见下表，非新增端点）。

| 方法 | 路径 | 变更说明 |
|---|---|---|
| GET | /api/workspaces/{workspace_id}/sillyspec/scope-audit | 既有端点零改动，响应 DTO additive：ScopeAuditRow.cross_repo + ScopeAuditResponse.repos（含 RPC `sillyspec_scope_audit` 同构扩展） |

### daemon TS（sillyhub-daemon/src/sillyspec-manager.ts）

```ts
/** 对账表单行（契约 v2 增量）：full-flow 跨仓行带 cross_repo（repoKey）。 */
export interface SillySpecAuditRow {
  path: string;
  additions: number | null;
  deletions: number | null;
  kind: string;
  planned?: string | null;
  verdict?: string | null;
  declared?: boolean | null;
  attribution?: string | null;
  cross_repo?: string | null;   // CLI rows[].crossRepo；主仓行/旧行无键 → null
}

export interface SillySpecAuditRepoAnchor {
  source: string | null;   // 'reviews-range' | 'head~1-window' | 'head-uncommitted-window' | 'degraded' | 'main-<form>'
  base: string | null;
  head: string | null;
  label: string | null;    // CLI 档位人类可读文案
}

export interface SillySpecAuditRepoTotals {
  files: number | null;
  additions: number | null;
  deletions: number | null;
  planned: number | null;
  unplanned: number | null;
  untouched: number | null;
}

/** 每仓汇总条目（契约 v2 信封 repos[]；repoPath 不投影——D-001）。 */
export interface SillySpecAuditRepo {
  key: string;                       // 'main' 恒首位
  anchor: SillySpecAuditRepoAnchor;
  anchor_label: string | null;       // base 7 位短化（^[0-9a-f]{7,40}$ → slice(0,7)），语义锚/无 base → null
  totals: SillySpecAuditRepoTotals;
  degraded: boolean;
  degraded_reason: string | null;
}

// SillySpecAuditTable 增：repos: SillySpecAuditRepo[] | null（null=旧 CLI 无该键）
```

### backend pydantic（backend/app/modules/change/schema.py）

```python
class ScopeAuditRow(BaseModel):
    # 既有字段不变，增量：
    cross_repo: str | None = None

class ScopeAuditRepoAnchor(BaseModel):
    source: str | None = None
    base: str | None = None
    head: str | None = None
    label: str | None = None

class ScopeAuditRepoTotals(BaseModel):
    files: int | None = None
    additions: int | None = None
    deletions: int | None = None
    planned: int | None = None
    unplanned: int | None = None
    untouched: int | None = None

class ScopeAuditRepo(BaseModel):
    key: str
    anchor: ScopeAuditRepoAnchor = ScopeAuditRepoAnchor()
    anchor_label: str | None = None
    totals: ScopeAuditRepoTotals = ScopeAuditRepoTotals()
    degraded: bool = False
    degraded_reason: str | None = None

class ScopeAuditResponse(BaseModel):
    # 既有字段不变，增量：
    repos: list[ScopeAuditRepo] = []
```

### 消费语义（前端分组规则）

- 分组激活条件：`repos` 为非空数组且 `mode === 'full-flow'`。
- 段序：`repos[]` 原序（CLI 保证 main 首位）；明细分桶键 = 行 `cross_repo` ?? `'main'`，桶序同 `repos[]`，`repos[]` 未列出的孤儿 repo 桶按首现顺序尾随。
- chips 计数单一源：`repos[].totals`（不前端重算——与 rows 分桶在截断/畸形下不一致时以信封为准，CLI 单一源原则）。
- degraded 仓段：不渲染 chips，整段 ⚠️ degraded_reason。
- 行数 `null`（B/C 档降级、二进制）显示 `—`（沿用 fmtNum 语义）。

## 生命周期契约表

不涉及生命周期契约（本变更是既有只读查询链路的响应结构 additive 扩展：不改 RPC method 注册、WS 连接、会话/租约/心跳语义，`auditTable` 方法与端点均已存在）。

## 数据模型

无 DB schema 变更。OpenAPI DTO 增量（ScopeAuditRow.cross_repo + ScopeAuditRepo 族 + ScopeAuditResponse.repos），`backend/openapi.json` 与 `frontend/src/lib/api-types.ts` 为生成物随变更提交。

## 兼容策略（brownfield 必填）

1. **未配置/旧版本行为不变**：旧 CLI 无 `repos` 键 → daemon 投影 `repos: null` → backend `repos: []` → 前端走现状单段渲染（counts-from-rows、明细平铺、testid 不变）；单仓变更 CLI 按 v2 契约不输出 repos → 同一回退路径。旧 daemon 不投影 → backend result 无键 → `repos: []` → 同上。端到端行为与现状等价（回归测试钉住）。
2. **旧行回退**：跨仓行旧形态（无 `cross_repo` 键，恒 untouched）在前端归主仓桶按普通行渲染；v2 degraded 仓行（untouched + cross_repo）归对应仓段。
3. **回退路径**：不引入 `sillyspec_capability_missing` 类新版本门禁错误——契约 v2 是 additive，旧 CLI 输出仍合法 v1，链路照常出表（对比：scope-audit 命令本身缺失才有能力门 422）。
4. **不改变的接口**：RPC method 名与参数、REST 端点与权限、错误映射族、rows 截断护栏（500 行）、quick 模式全链、`excluded_foreign_declared`、单文件 diff 链路（跨仓行 diff 路由在 CLI `--file` 侧，平台透传零改动）。
5. **生成物纪律**：gen:types 前确认前端 node_modules 健康（规则 21：`pnpm exec tsc --version` 可跑，坏则 `pnpm install --force`）；`api-types.ts` + `backend/openapi.json` 同一变更内提交，不让类型落后后端；frontend gen:types 若串跑出 daemon 侧伴生产物（如 gen-provider-caps），只提交本变更相关 diff。
6. **回退形态渲染语义钉死**：无 repos 的回退路径不渲染 note（现状原样——note 属分组形态增量）；v3.29.3~v2 之间旧快照行可能带 crossRepo ⊘ 标记，回退形态不消费该键、按普通行渲染。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | daemon 真实 v2 信封无实机样本（f85a6650 的 daemon 在另一台机器，本机 E 盘不存在），夹具按契约文档示例造可能与真实输出有出入 | P1 | 夹具逐字段对齐上游 design.md「完整 JSON 示例」节；上游归档 verify 已过其侧测试；真机首查时人工核对一次（验收注记） |
| R-02 | `repos[].totals` 与前端 rows 分桶计数不一致（rows 截断 ≤500 而 totals 原值；或畸形信封行有 cross_repo 但 repos 无该仓条目） | P2 | chips 计数一律取信封 totals（单一源，CLI 产出）；明细分桶按行归属；不一致属 CLI 侧数据问题不在平台兜底，truncated 提示已有 |
| R-03 | gen:types 未跑或 node_modules 半坏导致 api-types 漂移、假 TypeScript 报错 | P1 | 规则 21 流程（tsc --version 预检 + pnpm install --force 修复）；daemon 侧 CI 有 gen:types:check 门禁先例，前端 CI typecheck 兜底 |
| R-04 | 跨仓行点击「单文件比对」在旧 CLI 机器上返回窗口外/失败提示（旧版无跨仓路由） | P2 | advisory 语义不拦：错误经既有 ScopeFileDiffModal 错误面展示；升级 CLI 后自然可用，卡片不额外判版本 |
| R-05 | 移动端窄屏下多仓分段密度过高（mobile-change-detail import 复用同卡） | P2 | 分段为紧凑纵排（原型已验证密度）；mobile-change-detail.test.tsx 回归；真机验收时观察，过密再收折 |
| R-06 | 明细 500 行截断发生在跨仓段中间，分桶后小节头与行数观感割裂 | P2 | 截断提示已有（「仅前 500 行」）；分桶只重排不增删行，截断语义不变 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | 接口定义 daemon 投影白名单（无 repoPath）；文件变更清单 sillyspec-manager.ts 行说明 | 已覆盖 |
| D-002@v1 | 兼容策略 1/2/3；总体方案 Wave 3 回退分支 | 已覆盖 |
| D-003@v1 | 总体方案 Wave 3（分组形态/计数源/note 顶摘要）；设计目标 3；验收 | 已覆盖 |
| D-004@v2 | 接口定义 anchor_label 短化规则（daemon 投影层生成；语义锚 → null，档位可读性走 anchor.label 并行渲染——Grill S2 缺口修正，supersedes D-004@v1） | 已覆盖 |
| D-005@v1 | 总体方案全部（方案A 全链投影+按仓分段）；文件变更清单 | 已覆盖 |

## 自审

- [x] 章节齐全（背景/设计目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale）
- [x] 引用所有当前版本 D-xxx@v1（D-001~D-005 均入决策追踪表）
- [x] 生命周期关键词豁免短语已紧邻「生命周期契约表」标题（「不涉及生命周期契约」）
- [x] UI 原型分级核对：组件级变化（卡片内部分段+弹窗分节，页面骨架不变）→ 建议生成档已生成 prototype-scope-audit-cross-repo.html
- [x] 文件变更清单无新建文件（全部修改已有文件，无 NEW: 前缀需求）；对外字段数据流已标注（daemon 投影行 / backend schema 行 / 前端卡片行）
- [ ] ⚠️ 自审存疑①：分组形态下 testid 升级为 `scope-audit-chip-<repo>-<verdict>`——旧测试若断言全局唯一 `scope-audit-chip-planned` 会受影响，execute 时以「回退形态 testid 不变 + 分组形态新 testid」双轨处理，具体断言改造在 plan/execute 定
- [x] 自审存疑②已闭环（Grill S2 缺口修正 → D-004@v2）：anchor_label 只承载短 hash（语义锚/无 base → null 显示 —），档位可读性由 anchor.label 文案始终并行渲染兜底
