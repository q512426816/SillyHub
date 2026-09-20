---
author: qinyi
created_at: 2026-09-20T19:35:30
---

# decisions.md — 2026-09-20-scope-audit-cross-repo-platform 决策台账

> 只记录有实现/验收影响的决策。上游契约（--json 契约 v2）已在 sillyspec 仓
> archive/2026-09-20-scope-audit-cross-repo/design.md 接口定义节定稿，本台账只记
> 平台侧消费决策。

## D-001@v1: repoPath 不出 daemon（本地路径隐私）
- type: boundary
- status: accepted
- source: design-grill（薄跑自裁，依据既有先例）
- priority: P0
- question: 契约 v2 的 repos[].repoPath 是仓根本机绝对路径（如 E:/PZwangge/sub-grid-security），平台链路要不要透传到浏览器?
- answer: 不透传。daemon 投影白名单不含 repoPath——先例 ql-20260911-003-355a P2：daemon 原始消息含本机路径只进服务端结构化日志、不随 details 下发客户端。前端分组与展示用 repo key（sub-grid-security 等）足够；排查需要真实路径时看服务端日志或本机 CLI。
- normalized_requirement: daemon SillySpecAuditRepo 投影字段= key/anchor/totals/degraded/degraded_reason/anchor_label，无 repoPath 键
- impacts: [接口定义, R-02]
- evidence: backend/app/modules/change/scope_audit.py:284-285 注释（「daemon 原始消息可含 stderr 尾段/本机路径……不随 details 下发客户端」）

## D-002@v1: 全链 additive 兼容，不加版本门禁
- type: architecture
- status: accepted
- source: user（任务书边界：旧环境不崩）
- priority: P0
- question: 用户机器上的旧 sillyspec CLI（无 repos 键）/ 旧 daemon（不投影）/ 旧 backend（无字段）混布时怎么兜?
- answer: 三层各自缺省回退：daemon 侧 parsed.repos 非数组 → 投影 repos=null；backend 侧 result.repos 非法形态 → repos=[]；前端 repos 空/缺 → 走现状单段渲染（三态 chips 从 rows 统计）。不新增 sillyspec_capability_missing 类版本门禁错误——契约 v2 是 additive，旧 CLI 输出仍合法 v1。
- normalized_requirement: 旧链路端到端行为与现状逐字节等价（回归测试钉住）；跨仓行旧形态（恒 untouched 无 crossRepo 键）在前端按主仓行渲染
- impacts: [接口定义, 兼容策略, R-01]
- evidence: 上游 design.md 兼容策略第 1/3 条（单仓变更零回归 / fail-soft 回退）

## D-003@v1: 分组形态——卡片内每仓一段，主仓首位
- type: ui
- status: accepted
- source: user（任务书：按仓分类展示）
- priority: P0
- question: 对账卡的按仓分组用什么形态? tabs 还是分段?
- answer: 卡片内垂直分段（无 tabs）：顶部保留全表合计行（锚点/文件数/+−），其下每仓一段——段头=仓标识（main 显示「主仓」，其余显示 repo key）+ 该仓锚点档 label + 短 hash；段身=三态 chips + 该仓 files/+−。degraded 仓整段降级为 ⚠️ 原因文案（无 chips）。明细弹窗按仓分小节，跨仓行加仓标徽章。quick 模式无 repos 不分组。移动端 mobile-change-detail 是 import 复用本卡，自动继承。
- normalized_requirement: 每仓段的三态计数取 repos[].totals（不前端重算）；无 repos 时退回现状 counts-from-rows
- impacts: [总体方案前端节, 验收]
- evidence: 任务书「按仓库去分类展示」+ 现有卡面结构（单段 chips 行）

## D-005@v1: 实现方案选 A——全链投影 + 按仓分段
- type: architecture
- status: accepted
- source: user
- priority: P0
- question: 平台侧消费方三方案（A 全链投影+按仓分段 / B 仅信封 repos[] 汇总 / C 最小修行级仓标+note 不分段）选哪个?
- answer: 方案A。daemon 投影行级 cross_repo + 信封 repos[]（每仓锚点/三态计数/降级），backend schema 全量透传 + gen:types，前端卡面按仓分段 + 明细按仓分节 + note 顶摘要层。理由：任务书验收「主仓段+各跨仓段真实三态与锚点档」只有 A 同时具备行级仓归属（明细分组/单文件 diff 联动判仓）与信封级汇总（卡面分段计数单一源）；B 缺行级仓归属致明细层不可按仓分组；C 不满足已确认的按仓分类展示诉求。
- normalized_requirement: 覆盖 D-001~D-004 全部决策；B/C 的省略面（行级仓归属/分组形态）不采纳
- impacts: [总体方案全部, 文件变更清单]
- evidence: 用户任务书原文「daemon 投影 rows[].crossRepo/verdict 与 repos[](anchor/totals/degraded)→后端 schema→前端按仓分组对账卡」即方案A逐字描述；方案选择轮 AskUserQuestion 未获实时回答，按任务书预选如实记录（2026-09-20 19:42）

## D-004@v2: 每仓锚点短 hash 在 daemon 投影层生成（语义锚 → null）
- type: convention
- status: accepted
- supersedes: D-004@v1
- source: design-grill（S2 独立审查缺口修正，2026-09-20）
- priority: P1
- question: repos[].anchor.base 是完整 hash，前端展示短化在哪层做? 语义锚（非 hash base）怎么显示?
- answer: daemon 投影每仓条目加 anchor_label 字段，生成规则与信封 anchor_label 同款：base 命中 `^[0-9a-f]{7,40}$` → slice(0,7)；**语义锚/无 base → null**（前端显示 —）。CLI 契约的 anchor.label（档位文案，如「reviews base..head…」）原样透传为独立字段并**始终并行渲染**——语义锚的可读性由 label 文案兜底，anchor_label 只承载短 hash。
- normalized_requirement: v1 的「语义锚原样（进 anchor_label）」作废——语义锚不进 anchor_label（null），档位可读性走 anchor.label 并行渲染；前端零格式化逻辑
- impacts: [接口定义, Wave1 投影规则, 前端段头渲染]
- evidence: Grill S2 审查缺口①（decisions v1「语义锚原样」与 design「→null」冲突，审查建议采纳 design 版本并回写修订）；daemon 现有信封语义锚实证（quick-window:*/HEAD 窗口）

## D-004@v1: 每仓锚点短 hash 在 daemon 投影层生成
- type: convention
- status: accepted
- source: design-grill（薄跑自裁，对齐既有惯例）
- priority: P1
- question: repos[].anchor.base 是完整 hash，前端展示短化在哪层做?
- answer: daemon 投影每仓条目加 anchor_label 字段，生成规则与信封 anchor_label 同款（^[0-9a-f]{7,40}$ → slice(0,7)，语义锚原样，base=null → null）——前端零格式化逻辑，与「锚点短化（表头同款 7 位短 hash）」既有注释口径一致。
- normalized_requirement: repos[].anchor_label 仅 daemon 计算；CLI 契约的 anchor.label（档位文案）原样透传为 anchor_label 之外的独立字段
- impacts: [接口定义]
- evidence: sillyhub-daemon/src/sillyspec-manager.ts auditTable anchor_label 短化实现（^[0-9a-f]{7,40}$ 分支）
