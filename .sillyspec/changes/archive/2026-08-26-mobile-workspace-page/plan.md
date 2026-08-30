---
author: qinyi
created_at: 2026-08-27 00:26:00
plan_level: full
---
# 实现计划（Plan）— 工作区移动端页面（变更中心 + 会话移植）

> 依据：design.md（含 §14 Grill 修订）/ requirements.md（FR-01~FR-11）/
> decisions.md（D-001@V1~D-004@V1 全部 accepted）。
> 唯仓变更：frontend（主仓），无跨仓 task。
> 测试策略：test_strategy=module（local.yaml）——前端相关测试 `cd frontend && pnpm test`，
> 仅跑本变更相关文件（CLAUDE.md 规则 0 禁全量）。

## Spike 前置验证

无独立 Spike。唯一高不确定点 R-01（SessionPanel 桌面 chrome 耦合面）已内置于
task-14 首步（通读渲染层产出耦合清单，超预期即降级为「mobile 壳组件包 SessionPanel
+ CSS 覆盖，逻辑零触碰」，design §10 R-01）。

## Wave 1（并行，无依赖——骨架与桌面纯增量，文件互不重叠）
- task-01
- task-02
- task-03
- task-04
- task-05
- task-10
- task-13
- task-14

> task-14 是关键路径最长任务（4522 行通读 + variant），W1 启动、允许跨到 W2 周期
> 完成后再进 W3 的 task-15；其余 W1 任务小而快。

## Wave 2（依赖 Wave 1——移动核心组件）
- task-06
- task-08
- task-11

## Wave 3（依赖 Wave 2——页面装配与钻取，文件互不重叠）
- task-07
- task-09
- task-12
- task-15

## Wave 4（依赖全部——收尾验收）
- task-16

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | m/layout DRILL_ROUTES 钻取裸容器分支 | W1 | P0 | — | FR-09/FR-11 | 正则纯函数导出+测试；既有 /m 路径零命中 |
| task-02 | 工作区 layout Provider + 主页 redirect | W1 | P0 | — | FR-02 | getWorkspace 预取；page redirect → /changes |
| task-03 | m/workspaces 解除门禁 | W1 | P0 | — | FR-01/FR-11 | :199 改 router.push + 新增导航断言（C-17） |
| task-04 | MobileWorkspaceHeader 段控双 Tab | W1 | P0 | — | FR-02 | 返回+工作区名+段控（真实路由切换） |
| task-05 | MobileChangeCard + PENDING_REVIEW_LABEL 导出 | W1 | P0 | — | FR-03 | 徽标映射复用（C-10：加 export） |
| task-10 | 深链兜底 redirect 薄壳 ×2 | W1 | P1 | — | FR-10 | changes/[cid]/sessions、quicklog/[qlId]/sessions → 会话列表（C-11） |
| task-13 | PreSessionPicker variant bottomSheet | W1 | P1 | — | FR-08/FR-11 | 默认 center 零回归 + 回归测试 |
| task-14 | SessionPanel variant 移动适配 | W1 | P0 | — | FR-07/FR-11 | 首步耦合清单（R-01）；逻辑零分叉；「不传 variant=desktop 一致」测试 |
| task-06 | 变更列表移动页 | W2 | P0 | task-02/04/05 | FR-03 | 三Tab+计数+搜索+筛选抽屉+智能轮询复用 |
| task-08 | MobileChangeDetail 区块组件 | W2 | P0 | task-05 | FR-04 | 阶段条/审批 submitStageReview/文档 FilePreviewModal/时间线/日志折叠/引导条 |
| task-11 | MobileSessionList 会话分组列表 | W2 | P0 | task-01 | FR-06 | listAgentSessions+workspace_id 同 key query（C-08）；分组/状态Tab/菜单操作 |
| task-07 | quicklog Tab + MobileDetailSheet | W3 | P1 | task-06 | FR-05 | 同文件顺序；listQuicklogEntries+轮询复用 |
| task-09 | 变更详情移动页 | W3 | P0 | task-01/02/08 | FR-04/FR-09 | 钻取页装配（返回顶栏） |
| task-12 | 会话列表移动页 | W3 | P0 | task-02/04/11/13 | FR-06/FR-08 | 含预会话态承载与切真会话路由 |
| task-15 | 会话对话移动页（第四宿主） | W3 | P0 | task-01/02/14 | FR-07/FR-09 | SessionPanel key=sid；machines/llmProviders 同源数据 |
| task-16 | 全局自测 + 文档核对 | W4 | P0 | task-01~15 | 全 FR | 深链矩阵/双主题/键盘避让/桌面既有测试全绿；X-03 组件复用落位清单、X-04 key 锁形态用例 |

## 关键路径

task-14 → task-15 → task-16（SessionPanel variant 是最长任务；其余链
task-02→06→07→16 较短）。

## 全局验收标准

1. 所有新增测试通过 + 受影响既有测试（session-panel / pre-session-picker /
   m-workspaces / m-layout）全绿（仅跑相关文件，不全量）。
2. 集成冒烟（task-16 执行）：手机视口走通 选择器→主页→变更列表→详情→审批按钮
   （可 mock submit）→文档预览打开→返回；会话列表→对话页 SessionPanel 渲染→
   输入条可见；两条深链兜底 redirect 生效。
3. brownfield 零回归：桌面既有测试全绿；不传 variant 的调用点渲染与改前一致。
4. 移动规范抽检：触摸热区 ≥44px、正文 ≥14px、无写死色值（brand-*/语义 token）。

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@V1 | task-01/02/03/05/06/08/09/11/14/15/16 | 全局验收 1/2/3（独立渲染层+数据复用+零回归） |
| D-002@V1 | task-06/07/08/09 | FR-03/04/05 验收 + 详情引导条（task-08） |
| D-003@V1 | task-11/12/13/14/15 | FR-07 验收（完整内核全功能）+ task-14 回归测试 |
| D-004@V1 | task-02/04/06/09/12/15 | FR-02/09 验收（双 Tab 真实路由 + 钻取隐藏 Tab） |
