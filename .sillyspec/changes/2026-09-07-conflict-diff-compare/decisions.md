---
author: qinyi
created_at: 2026-09-07 11:05:00
---

# 决策记录 — 2026-09-07-conflict-diff-compare

## D-001@v1 — 冲突对比内容获取通道：实时 RPC 对比（方案A）

- type: architecture
- source: user
- 日期: 2026-09-07
- question: 冲突对比弹窗需要「本地内容 vs 平台内容」，本地内容只在 daemon 机器的 `.sillyspec/` 下，后端无法直读，内容怎么获取？
- options:
  - 方案A 实时 RPC 对比：前端点「查看对比」→ backend 新端点 → 经 WS RPC（explorer_read_file 同款请求/响应通道）让 daemon 实时读本地内容；backend 同时读平台侧内容（spec 镜像目录 / platform-sync progress 表），difflib 算差异，结构化返回前端渲染。
  - 方案B 心跳快照上报：daemon 检测冲突时把内容摘要随 pending_conflicts 心跳捎上。否决：心跳有 32KB 硬上限装不下冲突内容；快照可能过期——看着旧内容做裁决比没有对比更危险。实质不可行。
  - 方案C 复用 fire-and-forget 命令通道：「查看对比」下发命令，daemon 生成对比报告写命令结果槽随心跳捎回（2026-09-04-conflict-resolve-entry 刚建的通道）。否决：用户点完要等 15~75s（心跳周期）才能看到对比，体验不可接受。
- answer: 用户选定方案A（实时 RPC 对比）。理由：对比内容必须准确实时才敢据此裁决；有 explorer RPC 成熟先例（backend/app/modules/explorer/service.py + sillyhub-daemon/src/file-rpc.ts）；裁决本身要求机器在线，「查看对比需机器在线」不新增限制；diff 计算放后端（difflib），前端零新依赖纯渲染。
- evidence: brainstorm step 4 方案选择轮（2026-09-07，AskUserQuestion 用户亲选）。

## D-002@v1 — 裁决入口收敛：行上只留「查看对比」，保本地/取平台收进弹窗

- type: product
- source: user
- 日期: 2026-09-07
- question: 冲突列表行上现有「保本地/取平台」两个按钮，加了对比弹窗后行上按钮怎么处理？
- options:
  - 收进弹窗：行上只留「查看对比」，必须看过双方内容差异后才能裁决（防误触）。
  - 行内保留 + 弹窗内也有：快捷但有「不看差异直接裁决」的误操作空间。
- answer: 用户选定收进弹窗（「要在此弹窗才能选择保留本地还是服务器」原话确认）。
- evidence: brainstorm step 3 需求澄清轮。

## D-003@v1 — 进度类冲突弹窗展示：关键信息对比表，不用原始 JSON

- type: product
- source: user
- 日期: 2026-09-07
- question: 进度类（progress）冲突的内容是数据库进度 JSON，弹窗里怎么展示？
- options:
  - 关键信息对比表：解析成当前阶段/各步骤状态/双方最后推送时间等逐行对比，不同行高亮。
  - 原始 JSON 左右高亮：实现最简单但非技术用户没法看。
- answer: 用户选定关键信息对比表。
- evidence: brainstorm step 3 需求澄清轮。

## D-004@v1 — quick 类冲突条目标题：展示 ql 编号，daemon 读本地 guard.json 补报

- type: architecture
- source: assistant
- 日期: 2026-09-07
- question: quick-<hex8> 冲突条目对用户是不可读 ID，用户要求展示 ql 编号（如 ql-20260907-006-2972）。quick 会话与 ql 编号的结构化映射只存在于 daemon 机器本地 `.sillyspec/.runtime/quick-sessions/<名>/guard.json` 的 `quicklogId` 字段，且 `.runtime/` 在上传排除集内，平台侧拿不到，怎么补？
- answer: daemon 侧 `collectStatusOnce()` 后处理投影 pending_conflicts 时，对 `quick-*` 名 best-effort 读本地 guard.json 的 quicklogId 补 `ql_id` 字段（读不到则缺省）；backend `DaemonHeartbeatSillySpecConflict` DTO 加可选 `ql_id` 透传；前端标题展示 ql 编号 + 小字原 ID 兜底。不改外部 sillyspec CLI（不在本仓）。
- evidence: guard.json 的 quicklogId 字段实证于 `.sillyspec/.runtime/quick-sessions/quick-0343fb5a/guard.json:47`（Grill 复核修订：初稿引用的 quick-1ed69695 目录已清理）；映射实例见 docs/sillyspec/finished/2026-09-03-quicksync-conflict-granularity.md:7。**已知限制**（Grill gap-1）：存量两条 quick 冲突（quick-62e1d5fb/quick-aac62562）的 guard.json 已不存在，QUICKLOG 正文与 quick 会话名无稳定结构化映射可反查（正文偶有 quick-名提及但不构成解析依据），这两条将兜底显示原始 ID；ql 编号展示对新产生的 quick 冲突生效。
