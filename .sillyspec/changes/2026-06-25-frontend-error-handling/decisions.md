---
author: qinyi
created_at: 2026-06-25T09:51:22+08:00
change: 2026-06-25-frontend-error-handling
---

# Decisions — 前端错误处理规范化

> 本次变更的决策台账（非长期术语表）。只记录有实现/验收影响的决策。

## D-001@v1: errMessage util 取文案规则
- type: architecture
- status: accepted
- source: code + user
- question: errMessage 如何从错误取出面向用户的中文文案？
- answer: ① `ApiError` 且 `code==="network_error"` → 固定中文「网络连接失败，请检查网络后重试」；② 否则用 `err.message`（后端业务错误已中文）；③ 无 message / 非 Error → `fallback ?? "操作失败"`。
- normalized_requirement: `errMessage` 绝不返回 `err.code` 或英文浏览器 message；network_error 必须中文兜底。
- impacts: [FR-01, task Wave1, verify errors.test.ts]
- evidence: `api.ts:136-141`（网络错误 message=浏览器英文 `Failed to fetch`）、`:152-153`（非规范响应 message 英文）；用户确认不要映射表但 network 兜底属 UX 必需。

## D-002@v1: fallback 签名与默认值
- type: boundary
- status: accepted
- source: design
- question: 无可用 message 时的兜底文案？
- answer: 签名 `errMessage(err, fallback?)`，调用点可传 fallback；未传默认「操作失败」。
- normalized_requirement: `fallback` 参数可选；默认值「操作失败」。
- impacts: [FR-01, §7]
- evidence: 现有局部 errMessage（kanban.ts:181-185）签名一致，合并后行为等价。

## D-003@v1: 成功 toast 范围
- type: boundary
- status: accepted
- source: user
- question: 成功提示要不要全站铺？
- answer: 仅在 daemon 删除补 `notify.success` 作为范例（修复前删除无任何成功反馈）；不扩展到全站创建/更新。
- normalized_requirement: 仅 `runtimes/page.tsx` 删除成功路径调用 `notify.success`；其他操作本次不加。
- impacts: [FR-03, N5]

## D-004@v1: D 模式收敛清单延后精确化
- type: risk
- status: accepted
- source: design
- question: D 模式（`${code}: ${message}`）确切哪几处？
- answer: brainstorm 阶段列候选 ~8 处，plan 阶段 grep 精确化并逐处标注原展示方式（toast/inline）。
- normalized_requirement: plan 产出精确文件:行清单；verify grep 确认无残留 `${...code...}:` 拼接。
- impacts: [FR-04, R-02]
- evidence: 调研报告 §4 D 模式代表位置。

## D-004@v2: D 模式精确清单（Design Grill grep 实测）
- type: risk
- status: accepted
- supersedes: D-004@v1
- source: design-grill
- question: D 模式实际有多少处？候选清单是否完整？
- answer: grep `\$\{[^}]*[Cc]ode[^}]*\}\s*[:：]` 实测 **16 处**（多于初估 8），且初版候选清单遗漏 `workspaces/[id]/members/page.tsx`（4 处）。精确清单见 design.md §6。
- normalized_requirement: plan/execute 覆盖全部 16 处；verify grep 残留 `${...code...}:` 拼接应为 0；每处保持原展示方式（toast/inline）。
- impacts: [FR-04, R-02, Wave3]
- evidence: `rg '\$\{[^}]*[Cc]ode[^}]*\}\s*[:：]' frontend/src` 命中 16 行（api-key-create-dialog:53、daemon-dir-browser:49、health-card:35、server-status-card:77、workspace-scan-dialog:92/111/125/142、members/page:57/82/110/131、workspace-member-add-dialog:78/129、settings/api-keys/page:50/82）。

## D-005@v1: 方案 B — util + useNotify hook
- type: architecture
- status: accepted
- source: user
- question: errMessage util 用哪种形态？
- answer: `lib/errors.ts` 导出 `errMessage` 纯函数 + `useNotify()` hook（封装 `App.useApp().message` + errMessage）。否决 A（仅纯函数，调用点啰嗦）、C（全局 static message，与 antd v5 `useApp` 约定相悖、不消费主题）。
- normalized_requirement: 组件内用 `useNotify()`；store/非组件用 `errMessage` + 现有静态 message（本次不强改）。
- impacts: [FR-01, FR-02, §5, §7, R-01]
- evidence: 项目范例 `ppm-project-plan-form.tsx:110`（`App.useApp()` 用法）、CONVENTIONS「组件用 App.useApp() 取实例」。

## D-006@v1: 不维护 code→中文映射表
- type: premise
- status: accepted
- source: user
- question: 前端要不要一份 err.code→中文 映射表？
- answer: 不要。后端 message 已是中文，直接用 `err.message`，避免前后端文案双源漂移。network_error 兜底（D-001）是前端自造 code 的 UX 必需，不属业务映射表。
- normalized_requirement: 不新增任何 `code → 中文` 字典/Map。
- impacts: [N1]
- evidence: 后端 `errors.py:321-351` message 全中文。

## D-007@v1: 展示策略按场景区分
- type: architecture
- status: accepted
- source: user
- question: 错误提示统一用哪种展示？
- answer: 按场景：操作类（删/建/改）→ antd toast（notify）；页面加载/列表 → inline 红条；表单字段 → inline；危险操作确认 → antd Modal.confirm。
- normalized_requirement: 展示方式由场景决定，写入模块文档作为约定（design §5 表）。
- impacts: [FR-06, §5]
