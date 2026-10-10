---
author: flow-machine-draft
created_at: 2026-10-10T11:34:47.360Z
---
# 需求规格（Requirements）— 2026-10-10-change-patch-cross-repo-view

## 功能需求

### FR-01: ScopeAuditView 渲染 repos[]（非空数组时）：每仓一段=仓标识（key==='main' 显示「主仓」brand 色）+锚点 chip（anchor.label 文案+base 前 7 位短哈希，degraded 显示降级锚）+三态 chips（计划内/计划外/计划未动计数取 repos[].totals 单一源）+该仓 files/+−；degraded 仓段不渲染 chips，整段 ⚠️ degradedReason

- 对账快照视图必须在 scopeAudit.repos 为非空数组时按仓分段渲染：每段段头=仓标识（key==='main' 显示「主仓」并用 brand 色，其余仓显示仓 key）+ 锚点 chip（anchor.label 文案 + anchor.base 前 7 位短哈希，base 缺失时哈希位显示 —）；段身=三态计数 chips（计划内/计划外/计划未动，计数必须取 repos[].totals 单一源，禁止前端从 rows 重算）+ 该仓 files 数与 +/− 行数。
- degraded=true 的仓段禁止渲染三态 chips，整段降级为 ⚠️ 与 degradedReason 文案（无原因时给默认文案「该仓跨仓对账不可达（未注册/路径不可达），请人工到对应仓核对」）。
- 每仓段禁止渲染 repos[].repoPath 字段（该字段可能含本机布局路径，不外泄）。

#### 场景：跨仓冻结件按仓分段

- Given：change-patch.json 的 scopeAudit.repos 为非空数组（含 main 之外的仓，如 sub-x）
- When：渲染对账快照视图
- Then：每仓出现独立段（`scope-audit-repo-seg-<key>`），段头=仓标识+锚点 chip，段身=三态 chips（计数与 repos[].totals 一致）+ files/+−

#### 场景：降级仓整段警示

- Given：repos[] 某条 degraded=true 且 degradedReason 非空
- When：渲染
- Then：该段无三态 chips，显示 ⚠️ 与原因文案（`scope-audit-repo-degraded-<key>`）

### FR-02: rows 表 crossRepo 字段非空的行在路径后加仓标徽章（brand 色小标签，对齐 scope-audit-command-card 形态）

- rows 表中 crossRepo 字段为非空 string 的行必须在文件路径后渲染仓标徽章（brand 色小标签显示仓 key，形态对齐 scope-audit-command-card 的 repoBadge）；无 crossRepo 或值非 string 的行禁止渲染仓标。

#### 场景：跨仓行与主仓行混排

- Given：rows 同时含 crossRepo='sub-x' 的行与无 crossRepo 的行
- When：渲染表格
- Then：跨仓行路径后出现「sub-x」brand 徽章，主仓行无徽章

### FR-03: repos[].patch 键在场（'patch' in 条目）时：非空 string 可折叠展开 DiffView 正文+patchSha256 短哈希（title 全量）；null 诚实显示「patch 未采集（采集失败或空窗）」；键缺省（旧形态/未开采集）零渲染——additive 契约旧读方零感知

- repos[] 条目存在 patch 键时（'patch' in 条目）：patch 为非空 string 必须提供可折叠的 diff 正文区（默认折叠，展开后用 DiffView 渲染）并显示 patchSha256 短哈希（title 为全量哈希）；patch 为 null（键在场但采集失败/空窗）必须诚实显示「patch 未采集（采集失败或空窗）」，禁止伪造正文或占位 diff；条目无 patch 键（旧形态冻结件/未开采集）禁止渲染任何 patch 相关 UI。
- degraded=true 的仓段不适用上述 patch 面（FR-01 整段降级语义优先）——「采集失败或空窗」文案对整仓不可达场景是误描述，降级原因已覆盖。
- 折叠区默认收起（跨仓 diff 正文可能很大，不铺满预览面）。

#### 场景：patch 正文在场可展开

- Given：repos[] 条目 patch 为非空 diff string、patchSha256 为 64 位哈希
- When：渲染
- Then：段内出现折叠钮（`scope-audit-repo-patch-<key>`），展开后 DiffView 渲染 hunk，sha 短哈希可见（title 全量）

#### 场景：patch 采集失败诚实留痕

- Given：repos[] 条目 patch=null 且键在场
- When：渲染
- Then：显示「patch 未采集（采集失败或空窗）」文案，无 DiffView

#### 场景：旧形态无 patch 键零渲染

- Given：repos[] 条目无 patch 键
- When：渲染
- Then：该段无任何 patch 相关 UI

### FR-04: 旧形态（无 repos 键/无跨仓行）渲染与现状一致，既有测试零回归

- scopeAudit 无 repos 键或 repos 为空数组时，视图渲染必须与现状保持一致（摘要行+rows 表，无仓分段、无仓标、无 patch 面）；structured-views 测试文件的既有用例必须全部保持通过。

#### 场景：旧冻结件回退

- Given：scopeAudit 无 repos 键、rows 无 crossRepo 字段
- When：渲染
- Then：输出与现状一致（既有用例断言不变绿）

### FR-05: 测试覆盖：跨仓 repos 段渲染/降级段/patch 展开+sha/null 未采集/缺键不渲染/行仓标徽章

- 本变更必须在 structured-views 测试文件补齐以下用例并全部通过：跨仓 repos 段渲染（含主仓+跨仓段）、降级段、patch 正文折叠展开+sha 短哈希、patch null 未采集、patch 键缺省零渲染、rows 仓标徽章、无 repos 回退。

#### 场景：回归面全绿

- Given：上述用例就位
- When：运行 structured-views 测试文件
- Then：全部通过（含既有用例）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/files/__tests__/structured-views.test.tsx「change-patch.json（跨仓冻结）→ repos[] 每仓段+锚点 chip+三态 chips+降级段」
FR-02: frontend/src/components/files/__tests__/structured-views.test.tsx「rows 跨仓行路径后仓标徽章」
FR-03: frontend/src/components/files/__tests__/structured-views.test.tsx「repos[].patch 折叠正文+sha/null 未采集/缺键零渲染」
FR-04: frontend/src/components/files/__tests__/structured-views.test.tsx「旧形态无 repos 回退现状（既有用例零回归）」
FR-05: frontend/src/components/files/__tests__/structured-views.test.tsx「跨仓展示用例组全绿」
