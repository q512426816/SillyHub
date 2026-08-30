---
author: qinyi
created_at: 2026-08-22 13:33:10
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户 | 在 /sessions 页与 4 个弹窗消费面使用会话面板的最终用户（观感一致性受益方） |
| 前端开发者 | 维护 session-panel / 消费方组件的开发者（少一层适配、单一基元体系） |
| 并行变更执行者 | 正在推进 2026-08-22-team-session-unify 前端任务的 agent/会话（顺序协调对象） |

## 功能需求

### FR-01: 适配层删除与消费方直迁
覆盖决策：D-002@v1
Given `interactive-session-panel.tsx`（127 行适配层）存在且被 4 个渲染消费方引用
When 执行本变更
Then 该文件整文件删除；4 消费方（runtime-session-dialog.tsx:338 /
runtime-session-helpers.tsx:117 / workspace-session-section.tsx:253 /
change-session-section.tsx:212）改为 `import { SessionPanel } from
"@/components/daemon/session-panel"` 并以 `mode="dialog"`、
`sessionId={attachSessionId ?? null}` 调用；其余 12 props 同名直传；
各消费方现有 `key` 用法不动（重挂载清 SSE/轮询/队列契约保持）。

### FR-02: 类型 import 归位
Given 4 消费方从适配层 import 5 个类型（SessionProcessItem / SessionToolEvent /
SessionTurnView / SessionUiStatus / TurnUiStatus）
When 适配层删除
Then import 路径改指 `@/components/daemon/turn-timeline`（5 类型已全部导出于
:74/79/80/88/94，零补 export）；tsc --noEmit 零 error；全仓无 dangling import。

### FR-03: dialog 分支 chrome 基元 antd 化
覆盖决策：D-001@v1, D-004@v1
Given session-panel.tsx dialog 分支含 5 处 shadcn 基元（UiButton :2334/2352/2398/2409、
UiBadge :2363）
When 统一 antd
Then UiButton×4 → antd Button（新建/团队分析默认 32px；打断 size="small" 24px；
结束会话带 danger）；UiBadge → antd Tag；删除 UiBadge/UiButton 别名 import；
非 shadcn 原生控件（select/tab pill/chips button）不动。

### FR-04: TurnStatusBadge antd 化
覆盖决策：D-003@v1
Given turn-timeline.tsx:930-983 TurnStatusBadge 为纯样式 span 胶囊（两模式共用）
When 统一 antd
Then 内部渲染改 antd Badge status：running/interrupting→processing、
completed→success、failed/killed→error、pending 及其余中性态→default；
组件签名与调用方零变化；3 个断言测试文件
（turn-timeline-session-input-bar.test.tsx:67-70、sessions page.test.tsx:752-754/:821、
session-config-bar.test.tsx:544）适配且断言语义保留、禁删用例。

### FR-05: SessionInputBar 基元 antd 化
覆盖决策：D-005@v1
Given session-input-bar.tsx 含 2 处 shadcn Button（发送 :196、📎 ghost :169）
When 统一 antd
Then 发送 → antd Button type="primary"；📎 → antd Button type="text"；
附件 chips 删除原生 button（:140）不动；两模式共用一次替换两处生效。

### FR-06: 测试迁移与守护
Given 3 套 ISP 测试（interactive-session-panel{,-offline,-changeid}.test.tsx，
56 用例 = 50+4+2）经适配层 render
When 适配层删除
Then 迁移为 `session-panel-dialog{,-offline,-changeid}.test.tsx` 直测
SessionPanel mode="dialog"（render 入口按映射表转换）；用例数对账 56=56、
断言语义全保留、禁删用例；workspace-session-section.test.tsx 模块 mock 路径
改指 session-panel；补全仓 grep 守护断言（无 interactive-session-panel 残留
import，注释历史提及除外）。

### FR-07: 主题铁律合规
Given FRONTEND_PAGE_STYLE §0.5 双主题系统（blue/ai-native）
When 本次 antd 化
Then 新增代码零硬编码 hex；antd 组件色不写 style 覆盖（差异走 ConfigProvider
token 或既有 tailwind CSS 变量类）；品牌色类名用 brand-* 语义阶；
D-304 跨区共享组件备案生效（§4.B.7）。

### FR-08: 团队变更顺序协调
覆盖决策：D-006@v1
Given team-unify task-11 allowed_paths 与本变更正面重叠
When 本变更执行
Then 硬前置门：本变更先于 task-11 执行并合入 main；执行期若发现 task-11 已
启动改同文件，立即停下协调不并行；本变更合入后仅更新 task-11.md 代码锚点
（唯一引用适配层的团队任务卡），不动团队代码。

### FR-09: 注释锚点校正
Given 3 个文件注释含适配层历史锚点（ask-user-dialog-card.tsx:15、
lib/daemon.ts:586、session-log-sanitize.ts:4/12/22）且文件即将删除
When 适配层删除
Then 注释中指向已删文件的行号锚点按 CLAUDE.md 规则 18 校正（仅注释零逻辑改动）。

## 非功能需求

- 兼容性：4 消费方行为零回归（56 用例 + 18 页面用例 + 人工冒烟 5 面）；
  Windows/Linux/macOS 无关（纯前端组件层）。
- 可回退：纯前端单变更，git revert 即整体回退，无数据/接口影响。
- 可测试：用例数对账（56=56）、grep 守护、tsc/lint/vitest 全量门。
- 顺序安全：与 team-unify 已提交代码零交集（实测），P1 门防止 task-11 并行冲突。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-03, FR-07 | antd 方向（用户拍板，真实依据经 Grill X-03 修正） |
| D-002@v1 | FR-01, FR-02 | 一次性原子改造（用户拍板） |
| D-003@v1 | FR-04 | TurnStatusBadge 纳入 antd 化（U-01 用户拍板） |
| D-004@v1 | FR-03 | 主操作 32px / 打断 small 24px（U-02 用户拍板） |
| D-005@v1 | FR-05 | 📎 → antd type="text"（U-03 设计内定） |
| D-006@v1 | FR-08 | 先于 task-11 合入的 P1 硬前置门（Grill X-04 升格） |
