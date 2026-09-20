---
author: qinyi
created_at: 2026-09-20 11:49:14
generated_by: sillyspec-fourpiece-init
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 平台用户 | 在变更中心/快速修复抽屉查看对账卡的开发协同成员（绑定本机 daemon） |
| 平台链路 | daemon（RPC sillyspec_scope_audit）→ backend（change 模块）→ frontend（对账卡）三跳消费方 |
| sillyspec CLI | 契约 v2 生产方（本仓外，sillyspec 仓已交付，平台零自研 git/锚点逻辑） |

## 功能需求

### FR-01: daemon 投影契约 v2 行级字段
Given 本机 sillyspec CLI ≥ v2 输出的 `scope-audit --json` rows 中跨仓行带 `crossRepo` 键
When daemon `auditTable()` 投影该信封
Then 每行投影出 `cross_repo`（string|null，无键/非字符串 → null），既有 8 字段形状不变；`repoPath` 不出现在投影结果

### FR-02: daemon 投影信封 repos[]
Given CLI 信封含 `repos[]`（key/anchor{source,base,head,label}/totals{files,additions,deletions,planned,unplanned,untouched}/degraded/degradedReason）
When daemon 投影
Then 逐条防御投影出 `SillySpecAuditRepo[]`（key 非空 string 否则整条跳过；anchor 四字段 asStr；`anchor_label` = base 命中 `^[0-9a-f]{7,40}$` 时 slice(0,7) 否则 null；totals 六字段 asCount；degraded/degraded_reason 归一）；CLI 无 `repos` 键 → 投影 `repos: null`

### FR-03: backend schema 与透传
Given daemon RPC result 含 `cross_repo`/`repos`
When backend `get_scope_audit()` 构造响应
Then `ScopeAuditRow.cross_repo` 透传（isinstance str 守卫）；`repos` 为 list 时逐条防御构造 `ScopeAuditRepo`（非法条目跳过），否则 `repos: []`；OpenAPI 导出含新字段，`pnpm gen:types` 后 `api-types.ts` 零漂移

### FR-04: 前端对账卡按仓分组
Given 响应 `repos` 为非空数组且 `mode === 'full-flow'`
When 渲染对账卡
Then 卡面显示全表合计行 + 每仓一段（段头=仓标识「主仓」/repo key + 锚点档 label 与短 hash；段身=三态 chips，计数取 `repos[].totals` 不前端重算 + 该仓 files/+−）；`degraded=true` 仓段不渲染 chips 整段显示 ⚠️ `degraded_reason`；`note` 渲染在摘要层

### FR-05: 明细弹窗按仓分节
Given 分组激活（同 FR-04 条件）
When 打开「查看明细」
Then rows 按 `cross_repo` 分桶（无键归 main 桶），桶序 = `repos[]` 序（main 首位，孤儿桶尾随首现序），每桶粘性小节头（仓标识+锚点档）；跨仓行带仓标徽章；行点击 diff 联动行为不变

### FR-06: 全链 additive 回退
Given 旧 CLI（无 repos 键）/ 旧 daemon（不投影）/ 旧 backend（无字段）/ 单仓变更（CLI 按 v2 契约不输出 repos）/ quick 模式 任一情形
When 前端渲染
Then 走现状单段渲染路径（counts-from-rows、明细平铺、既有 testid 不变），端到端与现状等价；不新增任何版本门禁错误

## 非功能需求
- 兼容性：契约 v2 为 additive，v1 输出仍合法；Windows/Linux/macOS 三平台（路径短化/正则无平台差异面）
- 安全：本地路径不出 daemon（repoPath 白名单排除，D-001）
- 性能：投影/渲染 O(rows+repos)，无额外 RPC 往返
- 可测性：三层各自夹具级测试（daemon 信封夹具 / backend FakeHub / frontend 组件测试）

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-02 | repoPath 不出 daemon，投影白名单封闭 |
| D-002@v1 | FR-06（及 FR-02/03 缺省行为） | 三层缺省回退，零版本门禁 |
| D-003@v1 | FR-04, FR-05 | 分段形态、计数取信封单一源、note 顶摘要 |
| D-004@v1 | FR-02 | anchor_label 短化在 daemon 投影层生成 |
| D-005@v1 | FR-01~FR-06 | 方案A 全链投影+按仓分段的总体取舍 |
