---
author: qinyi
created_at: 2026-08-26T23:45:11
---

# Decisions: 工作区移动端页面（变更中心 + 会话移植）

> 稳定版本 ID 格式 `D-xxx@V1`（大写 V）。supersede 需新版本号。

## D-001@V1 渲染层策略：独立移动渲染层（方案 A）
- type: architecture
- status: accepted
- source: step4 用户拍板
- question: 移动端怎么承载工作区的变更中心 + 会话？（独立移动页面 vs 响应式改造桌面组件 vs 移动壳嵌桌面页）
- answer: 新增 `/m/workspaces/[id]/**` 独立移动页面：变更列表/详情用移动卡片 + 全屏钻取重绘；会话直接复用 SessionPanel 内核（继门户页/悬浮窗之后的第四宿主）。数据层 100% 复用 `lib/changes.ts` + `lib/daemon.ts` + `lib/tasks.ts`，桌面代码零回归（仅解除 m/workspaces 门禁等 4 处最小改动）。middleware UA 分流（matcher 已含 `/workspaces/:path*`）与 route-guard（已放行 `/workspaces/:id/**`）无需结构改动
- normalized_requirement: 手机 UA 访问工作区变更中心与会话获得原生移动页面；桌面行为不变
- alternatives: B 响应式改造桌面组件（需动 session-panel.tsx 4522 行 + session-list-panel.tsx 2142 行，桌面回归面大，且与既有 D-002@v2 UA 分流独立路由决策相悖）——否决；C 移动壳 iframe 嵌桌面页（体验差、SSE 二次中继、样式无法重做，违背需求）——否决
- impacts: 新增 `frontend/src/app/m/workspaces/[id]/**` 页面群 + `components/mobile/` 新组件；`m/workspaces/page.tsx` 解除门禁改为导航；桌面 `(dashboard)/**` 渲染零改动
- errata（design-grill C-10/C-12/C-13）：桌面共用文件最小改动共 5 处——m/layout.tsx、m/workspaces/page.tsx、pre-session-picker.tsx、session-panel.tsx（加 variant/export 之类纯增量）+ `(dashboard)/…/changes/page.tsx` 加 export PENDING_REVIEW_LABEL；均为零渲染变化的增量改动，D-001 实质不变
- evidence: brainstorm step4 方案选择轮（进度库回放）
- priority: P0
- 模块域: frontend

## D-002@V1 变更中心功能深度：核心版
- type: scope
- status: accepted
- source: step3 用户拍板
- question: 变更中心在手机端做到什么深度？（桌面端 4 层：列表 → 详情 → 任务看板 → 任务详情/执行）
- answer: 列表 + 详情（阶段/时间线/变更文件/审批/执行日志）+ 审批操作 + 文档预览。任务看板与任务执行页手机端不做，入口处引导回电脑端
- normalized_requirement: 变更中心手机端可浏览全部变更、可执行审批操作、可全屏预览规范文档；任务管理不在手机端
- alternatives: 完整版（加任务看板只读 + 任务详情）——范围过大推迟；只读版（不做审批操作）——与"适配手机端操作"需求不符
- impacts: 不建 `/m/workspaces/[id]/changes/[cid]/tasks/**` 页面；详情页任务区放桌面引导条
- evidence: brainstorm step3 需求澄清第 1 问回答
- priority: P0
- 模块域: frontend

## D-003@V1 会话能力边界：完整内核复用
- type: architecture
- status: accepted
- source: step3 用户拍板
- question: 会话在手机端的能力边界？（SessionPanel 内核含对话流/输入/消息队列/子代理目录/上下文用量等）
- answer: SessionPanel 内核 100% 复用，所有高级功能（消息队列/子代理目录/上下文用量/会话配置）保留，仅重排样式适配手机竖屏。对齐 2026-08-25-unified-floating-session 验证过的"一内核·N 宿主"模式
- normalized_requirement: 手机端会话具备与桌面等同的全部对话能力（发消息/流式/中断/结束/重开/队列/子代理/上下文），仅样式移动化
- alternatives: 对话核心裁剪版（去掉高级面板）——否决，用户明确要完整内核；只读浏览——否决
- impacts: SessionPanel 加 variant prop（默认 desktop 仅影响渲染层），改造必须桌面零回归（mode="page"/"dialog" 既有行为不变）
- evidence: brainstorm step3 需求澄清第 2 问回答
- priority: P0
- 模块域: frontend

## D-004@V1 工作区导航结构：主页 + 双 Tab
- type: ux
- status: accepted
- source: step3 用户拍板
- question: 进入工作区后手机端导航怎么组织？（现状：/m/workspaces 点卡片提示"请在电脑端打开"）
- answer: 解除 /m/workspaces 门禁，点卡片进入移动端工作区主页，页内段控切换「变更中心」「会话」两个主 Tab（真实路由 /changes 与 /sessions，非 query）；二级页面（变更详情/会话对话）全屏钻取、左上角返回、隐藏底部 Tab
- normalized_requirement: 工作区选择器卡片可进入；工作区内变更/会话一键切换；钻取页有明确返回路径
- alternatives: 不设主页直接进变更中心（会话入口散落各处，层级不清）——否决
- impacts: 新增 `/m/workspaces/[id]` 主页 redirect + MobileWorkspaceHeader 组件；`m/workspaces/page.tsx` 卡片点击从 message.info 改为 router.push；`m/layout.tsx` 加钻取路由裸容器分支
- evidence: brainstorm step3 需求澄清第 3 问回答
- priority: P0
- 模块域: frontend
