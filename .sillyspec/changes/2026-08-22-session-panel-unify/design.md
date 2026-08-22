---
author: qinyi
created_at: 2026-08-22T13:04:24
updated_at: 2026-08-22T13:52:00
change: 2026-08-22-session-panel-unify
scale: large
prototype: prototype-session-panel-unify.html
revision: v2.1（Design Grill v2 复审 passed：v1 12 项发现 + 用户 2 决策修订；复审 N-01~N-03 补正）
---

# 删除会话面板适配层 + 统一 antd 基元

## 1. 背景

2026-08-21-session-message-queue（已归档）完成组件统一的第一阶段：原 ~1300 行
`interactive-session-panel.tsx` 的渲染主体迁入共享 `session-panel.tsx`，本文件降级为
127 行 props 适配层。验收偏差 1 备案了「文件保留」决策（4 个范围外消费方 +
3 套测试从其导入），并把「彻底删除适配层」列为后续建议。同时两模式 chrome
各用一套 UI 基元（page 分支 antd、dialog 分支 shadcn ui 基元），观感不一致
（该变更注释原文：「dialog chrome 用 ui 基元……与 page 模式的 antd Badge/Button
是两套 API，别名消歧防同文件撞名」）。

本变更把这两笔债一次清掉。决策编号索引（详见 decisions.md）：D-001@v1 基元
方向 antd、D-002@v1 一次性原子改造、D-003@v1 TurnStatusBadge 纳入、D-004@v1
按钮尺寸 32/24、D-005@v1 📎 映射 type="text"、D-006@v1 先于 task-11 的 P1
顺序门。用户已拍板（AskUserQuestion 三问 + 方案选择 + 设计确认 + Grill 两问，
全程留痕）：
- **UI 基元方向 = antd**。真实依据（v2 更正，Grill X-03）：page 分支 chrome 已
  antd（session-panel.tsx:1101/1167/1208/1239）、/sessions 页外壳
  （SessionListPanel/NewSessionForm）为 antd、antd 是全仓管理体系主流（PPM 页
  规范 §0「UI 组件全用 antd」）。注意：4 个弹窗消费面的**外壳**现状为
  shadcn/Radix（runtime-session-dialog.tsx:29-34 shadcn Button+Radix Dialog、
  workspace-session-section SectionCard 等），非 antd——统一后为 antd 面板嵌
  shadcn 外壳，与「shadcn 输入条嵌 antd 页壳」的现混合态互为镜像，用户已知悉
  并确认方向（外壳不在本次范围）；
- **实施方式 = 一次性原子改造**（方案 A）：搬移与样式统一同变更内做完，单轮验收；
- **范围 = 连共享子组件家族**：SessionInputBar / MessageQueueBar / TurnTimeline
  的 chrome 基元（含消息流状态徽标 TurnStatusBadge，Grill U-01 用户拍板纳入）。

**与进行中变更 2026-08-22-team-session-unify 的协调（用户明确要求不冲突，
v2 按 Grill X-04 刷新事实）**：该分支 `sillyspec/2026-08-22-team-session-unify`
现况 11 commits / 42 文件，其中**前端 6 文件（task-12，2026-08-22T13:06:35
合入，晚于本设计 v1 落笔 2 分钟）**——经实测这 6 文件与本变更清单**零交集**
（不涉 session-panel / 适配层 / 4 消费方）。但剩余 task-11 的 allowed_paths
**正面重叠**本变更（session-panel.tsx、interactive-session-panel.tsx 及其测试）。
因此确立**硬前置条件（P1 门）**：本变更必须先于 team-unify task-11 执行并合入
main；本变更落地后仅更新 task-11.md 的代码锚点（grep 实测团队任务卡中唯一
引用适配层的文件）。在门满足前，两变更已提交代码保持零交集，可安全并行推进
其余任务（团队侧 task-08/task-13/task-14 与本变更无文件交集）。

## 2. 设计目标

1. `interactive-session-panel.tsx` 整文件删除，全仓无 dangling import；
2. 4 个弹窗消费方直连 `SessionPanel mode="dialog"`，行为与现状零回归
   （56 个迁移用例语义保留——实测主套 50 + offline 4 + changeid 2，v2 更正）；
3. 会话面板两模式 + SessionInputBar + TurnStatusBadge 统一 antd 基元，遵守
   FRONTEND_PAGE_STYLE §0.5 主题铁律（antd 色走 ConfigProvider token 不手写 hex、
   品牌 `brand-*` 语义阶、阴影走主题 token），双主题（blue/ai-native）换肤正常；
4. MessageQueueBar（已 antd）核对保持，不引入回归；
5. 全量 vitest + tsc + lint 零失败，5 个消费面人工冒烟（原型作对照基准）。

## 3. 非目标

- 不改 backend / sillyhub-daemon 任何文件；
- 不动 team-session-unify 分支与其 worktree（协调仅限其 task-11.md 文档锚点，
  且在本变更合入后进行）；
- 不做 `viewMode/onViewModeChange` props 接线（上变更遗留偏差 4，无消费方传，
  另行处理）；
- 不动 /sessions 页外壳（SessionListPanel / NewSessionForm，已 antd）与 page
  分支 chrome（已 antd，本次对照基准）；
- **不转换非 shadcn 的原生控件**（Grill X-08）：dialog 分支引擎选择器 native
  `<select>`（session-panel.tsx:2372 附近）、对话/进度 tab pill 原生 button
  （:2316 附近）、队列 chips 原生 button——本次只清 shadcn↔antd 混用，不做
  全控件 antd 化；
- 不动 4 个弹窗消费面的外壳（Radix Dialog / shadcn Button / SectionCard）；
- 不改 TurnTimeline 消息流内容渲染（MarkdownText 等中性组件）；TurnStatusBadge
  除外（U-01 已纳入）；
- 不调整区域布局/信息层级/交互流程；按钮高度属基元替换固有微调（主操作
  36→32、打断 36→24，见 §4.B.5 尺寸决策），非布局变化。

## 4. 总体方案

### 4.A 删适配层（纯结构搬移，界面零变化）

删除 `frontend/src/components/daemon/interactive-session-panel.tsx`（127 行，
13 props，实测核对）。

1. **4 个渲染消费方**直迁（行号实测）：
   - `components/daemon/runtime-session-dialog.tsx:338`
   - `components/daemon/runtime-session-helpers.tsx:117`（InteractiveSessionChatSection 内）
   - `components/workspace-session-section.tsx:253`
   - `components/changes/change-session-section.tsx:212`

   传参按现适配层映射逐项转换（适配层 109-125 与 SessionPanelProps 120-186
   逐项核对吻合）：`attachSessionId ?? undefined` → `sessionId: attachSessionId
   ?? null`；补 `mode="dialog"`；其余 12 props 同名直传零改名。
2. **类型 import 归位**：适配层 re-export 的 **5 个**类型
   （SessionProcessItem/SessionToolEvent/SessionTurnView/SessionUiStatus/
   TurnUiStatus——v2 更正计数）本就定义并**已全部导出**于 `turn-timeline.tsx`
   （:74/79/80/88/94），**无需补 export**；4 个渲染消费方 import 路径改指
   `@/components/daemon/turn-timeline`。已核实其余 8 个文件
   （ask-user-dialog-card / lib/daemon / session-log-sanitize /
   session-input-bar / turn-timeline 等）仅注释提及适配层（无真实 import），
   代码零改动；其注释中的历史锚点（如 `interactive-session-panel.tsx:1092`）
   按 CLAUDE.md 规则 18 顺手校正（仅注释，见 §5 清单）。
3. **`key` 重挂载契约保持**：4 消费方现有 key 用法不动（R6：消费方靠 key 重挂载
   清 SSE/轮询/队列，会话态 100% 组件内部，本变更不提升任何状态到外部）。

### 4.B 统一 antd（基元替换，区域布局零变化）

对照原型 `prototype-session-panel-unify.html`（execute 观感基准，v2 补 §⑥
状态徽标对照）：

1. `session-panel.tsx` dialog 分支 5 处（实测 :2334/2352/2398/2409/2363）：
   - `UiButton`×4（新建会话/结束会话/团队分析/打断）→ antd `Button`；结束会话
     destructive 语义 → `danger`；
   - `UiBadge`×1（提供方数量徽标 :2363）→ antd `Tag`；
   - 删除 `Badge as UiBadge` / `Button as UiButton` 别名 import（antd 正名直用）。
2. **TurnStatusBadge antd 化（U-01 用户拍板纳入）**：
   `turn-timeline.tsx:930-983` 现为纯样式 span 胶囊（running/completed/failed/
   killed 等彩色小徽标，两模式共用）→ 改用 antd `Badge status`：running/
   interrupting→`processing`、completed→`success`、failed/killed→`error`、
   pending 及其余中性态→`default`。类型签名与调用方零变化（内部渲染替换）；
   受影响的既有断言测试 3 个文件同步适配（断言语义保留、禁删用例，见 §5
   清单 N-01 补行）。
3. `session-input-bar.tsx` 2 处 shadcn Button（实测，v2 更正 X-07）：
   发送按钮（:196）→ antd `Button type="primary"`；📎 附件 ghost 按钮（:169）→
   antd `Button type="text"`（对应 ghost 无边框语义，U-03 设计内定）；
   附件 chips 删除按钮为原生 button（:140），不动（非目标）。
4. `message-queue-bar.tsx`：已 antd（:23 Button/Tag/Tooltip），核对保持。
5. **尺寸决策（U-02 用户拍板）**：dialog 分支主操作按钮（新建/结束/团队分析）
   = antd 默认 32px；打断按钮 = `size="small"` 24px（对齐 page 分支打断/重开
   惯例 :1208/1239）；现 dialog 36px → 32/24px 属基元替换固有微调（原型 §①③
   已示）。「布局零变化」界定 = 区域结构/信息层级/交互流程不变。
6. **主题铁律**：不新增任何硬编码 hex；antd 组件色不写 style 覆盖，需差异走
   ConfigProvider token 或既有 tailwind CSS 变量类；品牌色类名用 `brand-*` 阶。
7. **D-304 适用性备案（v2 补 X-10）**：4 消费面中 workspace-session-section
   挂载于 `/workspaces/[id]/sessions`（D-304 豁免区，工作台式页面 shadcn 基线），
   其余 3 面 + /sessions 页在 antd 强制区。会话面板为**跨区共享组件**，其基元
   方向（antd）经用户显式拍板，且与 §0.5 主题系统兼容（antd 色经 token 随双
   主题换肤）；D-304 豁免条款是对页面骨架基线的豁免而非禁用 antd，跨区共享
   组件选 antd 不违反该条款。此判断留档供 verify 复核。

### 4.C 测试迁移

3 套 ISP 测试（`__tests__/interactive-session-panel{,-offline,-changeid}.test.tsx`，
**实测 56 用例**：50+4+2，无 skip/each——v2 更正）迁移为直测 SessionPanel：
- render 入口 `<InteractiveSessionPanel {...props}>` → `<SessionPanel mode="dialog"
  sessionId={attachSessionId ?? null} {...props}>`；
- 文件改名 `session-panel-dialog{,-offline,-changeid}.test.tsx`（名实相符）；
- 断言语义全保留（排队行为/离线只读/changeId 透传/终止中横幅/attach 轮询等），
  仅 mock 路径与组件名同步；**禁删用例**（CLAUDE.md 规则 9），前后用例数对账
  56=56；
- mock 兼容性已实测（Grill X-11）：全部为模块路径 mock，render 入口替换不破坏
  mock 结构；antd Button 透传 title/disabled，既有 getByTitle 断言兼容；
- `workspace-session-section.test.tsx` 的模块 mock（现 mock 适配层路径 :28）改指
  session-panel；
- 补「适配层已删」守护：全仓 grep 断言（vitest 内或 verify 探针）无
  `interactive-session-panel` 残留 import（注释中的历史提及除外，见 §5）；
- 相邻测试兼容性（v2 补 X-12）：`runtime-session-dialog.test.tsx:369`
  getByTitle(/发送/)、`turn-timeline-session-input-bar.test.tsx:410`
  getByTitle("发送").disabled 均与 antd Button 兼容（实测），列入回归清单。

## 5. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 删除 | `frontend/src/components/daemon/interactive-session-panel.tsx` | 127 行适配层整体删除 |
| 修改 | `frontend/src/components/daemon/session-panel.tsx` | dialog 分支 5 处基元换 antd（尺寸按 U-02）+ 删别名 import |
| 修改 | `frontend/src/components/daemon/session-input-bar.tsx` | 发送/📎 两处 shadcn → antd |
| 修改 | `frontend/src/components/daemon/turn-timeline.tsx` | TurnStatusBadge → antd Badge status（U-01）；类型导出面已全（零补） |
| 修改 | `frontend/src/components/daemon/runtime-session-dialog.tsx` | 直迁 SessionPanel + 类型 import 改 turn-timeline |
| 修改 | `frontend/src/components/daemon/runtime-session-helpers.tsx` | 同上 |
| 修改 | `frontend/src/components/workspace-session-section.tsx` | 同上 |
| 修改 | `frontend/src/components/changes/change-session-section.tsx` | 同上 |
| 修改 | `frontend/src/components/ask-user-dialog-card.tsx` | 仅注释锚点校正（:15 历史提及，无 import） |
| 修改 | `frontend/src/lib/daemon.ts` | 仅注释锚点校正（:586，无 import） |
| 修改 | `frontend/src/components/daemon/session-log-sanitize.ts` | 仅注释锚点校正（:4/:12/:22，无 import） |
| 迁移 | `frontend/src/components/daemon/__tests__/interactive-session-panel.test.tsx` | → session-panel-dialog.test.tsx（主套 50 用例），56 用例语义保留 |
| 迁移 | `frontend/src/components/daemon/__tests__/interactive-session-panel-offline.test.tsx` | → session-panel-dialog-offline.test.tsx（4 用例） |
| 迁移 | `frontend/src/components/daemon/__tests__/interactive-session-panel-changeid.test.tsx` | → session-panel-dialog-changeid.test.tsx（2 用例） |
| 修改 | `frontend/src/components/__tests__/workspace-session-section.test.tsx` | mock 路径改 session-panel |
| 修改 | `frontend/src/components/daemon/__tests__/turn-timeline-session-input-bar.test.tsx` | TurnStatusBadge 断言适配（:67-70，语义保留） |
| 修改 | `frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx` | TurnStatusBadge 断言适配（:752-754/:821，page 模式同样受影响） |
| 修改 | `frontend/src/components/sessions/__tests__/session-config-bar.test.tsx` | TurnStatusBadge 断言适配（:544） |
| 修改 | `.sillyspec/changes/2026-08-22-team-session-unify/tasks/task-11.md` | **本变更合入后**更新代码锚点（唯一引用适配层的团队任务卡，仅文档） |

## 6. 接口定义

消费方迁移映射表（唯一调用签名变化；右列 = 迁移后写法）：

| 现适配层调用 | 迁移后 |
|---|---|
| `import { InteractiveSessionPanel } from "@/components/daemon/interactive-session-panel"` | `import { SessionPanel } from "@/components/daemon/session-panel"` |
| `import { type SessionTurnView 等 5 类型 } from "@/components/daemon/interactive-session-panel"` | `import { type SessionTurnView … } from "@/components/daemon/turn-timeline"` |
| `<InteractiveSessionPanel attachSessionId={id} ...props>` | `<SessionPanel mode="dialog" sessionId={id ?? null} ...props>` |
| 其余 12 个 props | 同名直传（SessionPanelProps 已按适配层命名设计，零改名） |

`SessionPanelProps` 本体不改（mode/sessionId 必填语义、其余可选 props 原样）；
`viewMode/onViewModeChange` 保留定义不接线（非目标）。

生命周期契约：无 —— 本变更为纯前端组件结构搬移与样式基元统一，不新增/修改任何
session、lease、agent_run、daemon 的状态流转与事件契约（后端与 daemon 零改动；
SSE 事件消费、队列投递状态机均沿用 2026-08-21-session-message-queue 既有实现，
仅改其渲染层 import 路径与 chrome 基元）。

## 7. 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| 4 消费方直迁漏传/错传 props | 弹窗功能回退 | §6 映射表逐项对照（审查已实测吻合）；56 迁移用例断言；4 面人工冒烟 |
| antd 化视觉回归（间距/高度/换肤） | 观感受损 | 基元替换不动布局类名；原型对照；双主题切换冒烟；色零手写走 token |
| TurnStatusBadge antd 化改变消息流观感（U-01 扩围） | 两模式消息流同时可见变化 | 属用户确认的统一意图；语义色映射固定（§4.B.2）；相关测试断言适配后全量回归 |
| 类型 import 漏改路径 | tsc 失败 | tsc --noEmit 零 error 硬门；全仓 grep 无 dangling import |
| 测试迁移丢断言 | 回归漏检 | 禁删用例；用例数对账 56=56；verify 探针复核 |
| **team-unify task-11 与本变更正面重叠**（session-panel.tsx/适配层/测试） | 合入冲突 | **硬前置门（P1）**：本变更先于 task-11 执行并合入；执行期如发现 task-11 已启动，立即停下协调（不并行改同文件）；已提交代码两变更零交集（实测） |
| SessionInputBar 换 antd 影响 page 分支输入区 | /sessions 输入区观感变化 | 属预期统一（用户确认范围含子组件）；相邻测试实测兼容（X-12）；页面 18 用例回归 |
| 相邻测试断言（getByTitle 等）与 antd 不兼容 | 假失败 | Grill 已实测两处兼容；全量 vitest 兜底 |

## 8. 自审

- [x] 目标明确：删适配层 + antd 统一，均可验证（grep 零残留 / tsc / 56 用例对账 / 原型对照）
- [x] 用户决策全留痕：antd 方向、一次性原子、含子组件家族、TurnStatusBadge 纳入、按钮尺寸 32/24、先于团队 task-11（六次问询均有 AskUserQuestion 记录）
- [x] 与 team-session-unify 协调基于实测事实（v2 刷新：分支 11 commits/42 文件含前端 6 文件零交集；task-11 正面重叠已升格硬前置门）
- [x] 文件变更清单完整且与真实 import 面一致（1 删 + 10 改代码 + 3 测试迁移 + 1 mock + 3 断言适配测试 + 1 团队任务卡文档 + 3 处仅注释；Grill v2 复审 N-01 补 3 个 TurnStatusBadge 断言测试行）
- [x] 风险登记覆盖搬移/样式/扩围/测试/并行/跨模式/相邻测试七类
- [x] 生命周期契约豁免已声明（纯前端渲染层变更）
- [x] 原型已生成并随 U-01 补状态徽标对照（§①-§⑥ 六节）
- [x] Grill v1 12 项发现全部处置（v2 复审逐项核对消解）；v2 复审 N-01/N-02/N-03 已补正（3 测试行入清单、残留半句删除、尺寸措辞与时间戳校正）；复审结论 specVerdict=pass / qualityVerdict=pass
