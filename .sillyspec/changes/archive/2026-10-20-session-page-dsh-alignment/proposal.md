---
author: qinyi
created_at: 2026-10-20 15:24:52
---
# 提案书（Proposal）

## 动机

用户对会话页提出的原始诉求是「**效果和能力**都想参考 deepseek-harness」（D-003、D-022 记录）。这条诉求在使用现场被拆成三类场景（D-003 用户多选）：①与手边在用的 DSH 直接对比、差距刺眼；②想把它当主力工作台，日常别扭感累积到临界；③要给别人用/演示，观感与可读性要能打。

推进过程中用户连续追加了五轮反馈，每一轮都改变了范围：

1. **三次「看不出区别」**。用户在 dev 路由看过真实组件后给的原话是「我没看出来有什么区别，而且效果都不行」（D-012），并勾选「折叠没用，方向错了」「观感差，要整体视觉重做」「信息密度/层次不对」。后来核出这三次判定所看的静态稿**缺全部答复正文**——`prototype-session-fullpage.html` 里有 138 个 CSR bailout `<template>` 占位、`.wmde-markdown` 为 **0**（D-019 / D-018）。判定因此部分不成立，需在修复稿上重判。
2. **「轮间 1px hairline 多余」**（D-020 用户原话）→ 轮间只留留白，不画线。
3. **「对比加强」**（D-021 用户原话）→ 落成四组可量化参数（正文 15px/1.8/0.65em、过程 11.5px + muted/80、左规线 /60、过程与答复区间隔 14px）。
4. **「类似 deepseek harness 轨迹的能力，想在平台页面上看到」**（D-022）→ 并轨迹档 1。
5. **「bash / sillyspec CLI 改的文件能否回显」**（D-023）→ 核实 `edit_patch` 只覆盖 Edit/Write（真实导出 1271 条日志里 91 条带 patch，bash 178 条与 sillyspec 30 条均无 patch，`runs[].diff_summary` 0/21），因此文件变更卡必须改走 daemon 每轮工作区快照（1b）。

不做会怎样：会话页继续是「过程与正文同权重、轮信息重复、框线成灾」的形态，用户的主工作台与对外演示两个场景都不成立；而「这轮到底改了哪些文件」在现有数据面里根本无解（`edit_patch` 覆盖不到命令行改动）。

## 背景

- **技术栈边界已定**（D-001）：2026-08-19-session-stream-ux 选定的路线是「参考 DSH 设计思想但不移植其插件化架构」。本仓客户端是 Next.js 14 + React 18 + TanStack Query + antd 的单一应用，DSH 是 Cordis 插件图 + 58 个 `packages/client/*` 包 + slot 注册表；移植成本与回归面远超收益。
- **视觉基线已更正**（D-015@v2 取代 D-015@v1）：基线是真实页面的**结构与信息组织**，颜色是**三个并存主题**（ai-native / blue / dark）；用户原话「不是颜色问题 平台就是有三套主题，我给你de截图是深色而已」。
- **原型形态已定**（D-010 / D-017 / D-018）：定稿原型必须是 dev 预览路由渲染的**真实生产组件**，静态稿必须是**水合后 DOM** 序列化（手绘 HTML 与 SSR 抓取都不作数）。
- **性能线已出界**（D-006 / D-007）：用户四项症状全选（首屏慢 / 触顶翻页卡 / 流式发涩 / 滚动跳转卡），但按 D-006 另立变更承接；本变更不承接性能优化。
- **折叠方向已否决**（D-012）：整轮折叠不作交付目标，已落盘的 `turn-fold.ts` 与 `TurnTimeline.detailLevel` 转为候选能力。

现状量化（本变更启动时可指认的事实）：正文与过程行同为 12–13px 量级（`frontend/src/app/globals.css` 原会话正文规则）；工具行满宽带框、与答复同权重；轮头轮尾各一条元信息行；轮间一根 1px hairline；左栏 chip 与时间同级同字号。

## 关键问题

1. **过程挤占正文**——工具卡满宽描边 + 与答复同为深色卡、同字号，读者在一轮里找不到答复（D-002①、D-016②③）。
2. **层次与节奏缺失**——轮元信息重复两遍、每个块各画一圈边框、用户气泡是整屏最亮块（D-016①③④）。
3. **能力缺口**——会话页没有「按事件账本读过程」的视图（轨迹），也没有「这轮改了哪些文件」的回显面；后者不是样式问题而是数据面问题（`edit_patch` 覆盖不到 bash/CLI 改动，D-023）。
4. **评审载体不可信**——静态稿缺正文导致三次误判（D-019）；原型管线若不修，后续每一轮观感讨论都会重犯。

## 变更范围

三条线 + 配套原型管线（任务与验证见 `tasks.md`）：

- **线 A 视觉层重做**（已落盘并验证）：轮元信息合并为一行、正文 15px/1.8/0.65em 与过程 11.5px 分档、工具行去外框改 2px 左规线、过程/答复 14px 分区、轮间只留白、左栏 chip 统一 9px。落地位置：`frontend/src/app/globals.css`、`frontend/src/components/daemon/{turn-timeline,turn-segment-views,attachment-chips}.tsx`、`frontend/src/components/chat/round-divider.tsx`、`frontend/src/components/sessions/session-list-panel.tsx`。
- **线 B 轨迹档 1**（已落盘并验证）：纯函数装配器 `frontend/src/components/daemon/trajectory/build-trajectory.ts` + 只读视图 `trajectory-view.tsx` + dev 路由 `frontend/src/app/proto/session-trajectory/`；事件账本按 run/step、工具子树按 `parent_tool_use_id` + `depth`、记录 inspector（tokens/时长/入参原文/输出）、时间轴跨度。
- **线 C 文件变更卡 1b**（未开始）：daemon 每轮工作区快照 → backend 透传 → 前端 turn 级卡片 + 会话级汇总，逐文件 +/− 以 git 为准、`edit_patch` 只用于归因。
- **后端 model-usage 只读端点**（已落盘，FR-23）：`GET /api/daemon/sessions/{session_id}/model-usage` 按 run × model 读真实用量（`agent_run_model_usage` JOIN `agent_runs`），只读、零迁移；`backend/openapi.json` 与两侧 `api-types.ts` 已同步重生成，UI 消费面尚未接线。
- **配套原型管线**：dev 预览路由 `frontend/src/app/proto/session-redesign/`（真实壳层 / 左栏 / 输入区 + 真实会话导出装配的真实轮次）+ 水合后 DOM 导出脚本 `frontend/scripts/export-hydrated.mjs`。

## 不在范围内（显式清单）

- **不做 TTFT / decode 切片**：需要引擎上报首 token，档 1 明确不做（D-022）。
- ~~不做轨迹区间聚焦与滚轮缩放~~：**已做**——D-026@v1 取代 D-022 该子句，滚轮缩放（锚点稳定）/ 拖拽平移（两端钳制）/ 双击与按钮重置 / 10px 总览刷子 / 时间轴与账本右缘对齐 Δ≤2px 已落地并验证（见线 B 与 SC-05）。
- **不做会话页工具审批卡**：D-002 用户未选（该能力落在权限/状态链路，与在途变更领域相邻）。
- **不做移动端 inspector 抽屉**：轨迹检查器按桌面 320px 固定列实现。
- **不做每会话独立 worktree**：D-023 明确接受共享工作区的「可能含并行会话改动」标注，独立 worktree 留作后续根治项。
- **不做长会话性能优化**：首屏/翻页/滚动/流式四项归性能变更（D-006、D-007），本变更不承接。
- **不移植 DSH 的 Cordis + Slots 插件化客户端架构**（D-001）。
- **不以整轮折叠为交付目标**：D-012 已否决该方向；`turn-fold.ts` 只作候选能力留档，不接线到任何页面。
- **不再用静态 `prototype:build` 复刻会话页做定稿**：D-011 已否决（静态管线无浏览器运行时，功能面补不完）。
- **不做 git rename 检测、不做全仓扫描式快照**：1b 的性能红线明确禁止（D-023③）。

## 成功标准（可验证）

- **SC-01 视觉四组参数可机械核验**：`npx vitest run src/components/daemon/__tests__/turn-segment-views.test.tsx` 全绿（**93 例**，2026-10-21 13:58 本轮实跑），其中断言正文 15px / 1.8 / 0.65em、过程行 11.5px + `muted-foreground/80`、工具行 `border-border/60`，并断言旧值 `font-size: 14.5px !important` 不再出现。
- **SC-02 轮间无 hairline**：`turn-block` 不带 `border-b` / `border-border` 且保留 `pb-7`；两侧同时可验——单测（`turn-time-display.test.tsx` 8 例）与导出件机械核验（`prototype-session-final.html` 实测 20 个 `turn-block`：带线 0、缺 `pb-7` 0）。
- **SC-03 轮元信息只有一行**：完成轮在对话视图与「全部（进度）」视图都只有一条元信息行（`turn-meta-detail` 在对话视图为 0、进度视图为 1）；导出件 `turn-meta-detail` 计数 20。
- **SC-04 轨迹 builder 契约**：`npx vitest run src/components/daemon/trajectory/__tests__/build-trajectory.test.ts` **31 例全绿**（要求 ≥12；2026-10-21 13:58 本轮实跑）。
- **SC-05 轨迹能看真实数据（泳道判据，2026-10-21 重写）**：`GET /proto/session-trajectory` 返回 200；导出稿 `prototype-session-trajectory.html` 实测 `data-testid="trajectory-lane-label"` **3** 个（输入 / 模型 / 工具）、`data-testid="trajectory-bar"` **618** 根、`role="grid"` **1** 个；且泳道时间轴右缘与账本盒右缘对齐 **Δ ≤ 2px**（1600×1000 实测 0.00px，改前 308px）。旧判据 `data-testid="trajectory-turn-row"`（20 个）已随 D-024 删除「每轮一行」概览而全树零命中，**作废**。
- **SC-06 定稿原型由真码产出**：`prototype-session-final.html`（**`--with-js` 产出**）满足——`.wmde-markdown` 元素 138、`turn-meta-detail` 20、`turn-block` 20、`<template>` 0、`<script data-export-shim="vanilla">` **恰 1 段**（`--with-js` 模式期望值 1；纯静态模式才是 0 段）、`<link>` 0、`<style>` 1。脚本数由 `frontend/scripts/export-hydrated.mjs` 按模式机械校验（`:864-870` 的 `expectedScriptCount`，不符即 `:934-938` 报错）；`prototype-session-trajectory.html` 同为 `--with-js` 产出，脚本口径相同。
- **SC-07 三主题成立**：本变更所有视觉改动只用语义 token（`hsl(var(--…))` / `--color-*` / token 派生类名），零写死色值；三个主题共用同一布局与信息层级。
- **SC-08 零回归**：`node node_modules/typescript/bin/tsc --noEmit` 退出码 0；相关 30 个测试文件全绿且退出码 0（原记 513 例；2026-10-21 按单文件实跑校正两处计数——`build-trajectory` 20→**31**、`turn-segment-views` 88→**93**，合计口径随之上移 16 例，execute 收口时按实测复录）。
- **SC-09 文件变更卡（线 C，验收口径先行）**：bash / CLI 改动可回显（有改动但无 `edit_patch` 的文件标「命令行/脚本改动」）；每轮 git 子进程 ≤3、硬超时 1500ms 降级 partial、单工作区串行、p50 > 300ms 或降级率 > 5% 报警；老 daemon 降级为「仅工具编辑」并显式提示（D-023）。
- **SC-10 model-usage 端点（FR-23，已落盘）**：`GET /api/daemon/sessions/{id}/model-usage` 四分支可控——2 run × 2 model 按轮次序排序、跨用户与不存在会话同 404、空态 200 + 空 `items`、超硬上限裁剪并置 `truncated=true`（`backend/app/modules/daemon/tests/test_session_model_usage.py` 4 例）；`backend/openapi.json` 与两侧 `api-types.ts` 由 `pnpm gen:types` 重生成、`git diff` 只含本端点新增行（禁手改）。
