---
author: qinyi
created_at: 2026-08-22 13:33:10
---
# 提案书（Proposal）

## 动机

2026-08-21-session-message-queue 完成会话面板组件统一第一阶段后留下两笔已备案的债：
① `interactive-session-panel.tsx` 从 ~1300 行实现体降级为 127 行适配层但文件保留
（验收偏差 1，「彻底删除」被列为后续建议）；② 共享 `session-panel.tsx` 两模式
chrome 各用一套 UI 基元（page 分支 antd、dialog 分支 shadcn），同一功能在
/sessions 页与 4 个弹窗消费面观感不一致。用户要求一次清掉这两笔债，且必须与
进行中的 2026-08-22-team-session-unify 变更零冲突。

## 关键问题

1. **适配层是永久性中间层**：4 个消费方（runtime-session-dialog /
   runtime-session-helpers / workspace-session-section / change-session-section）
   经由适配层间接使用 SessionPanel，多一层无实际逻辑的转发，类型 re-export
   也寄生其上；不删则每次面板接口演进都要同步维护三层。
2. **两套基元观感割裂**：dialog 分支 5 处 shadcn（UiButton×4/UiBadge×1）+
   SessionInputBar 发送/📎 按钮与 page 分支 antd、消息流 TurnStatusBadge 纯
   span 胶囊并存，用户在两个入口看到的是「两个产品」。
3. **并行变更的文件重叠风险**：team-session-unify 剩余 task-11 的
   allowed_paths 与本变更正面重叠（session-panel.tsx / 适配层 / 其测试），
   无显式顺序门则必然合入冲突。

## 变更范围

- 删除 `frontend/src/components/daemon/interactive-session-panel.tsx`；
- 4 个渲染消费方直连 `SessionPanel mode="dialog"`（props 按已验证映射表转换，
  key 重挂载契约保持），类型 import 归位 `turn-timeline.tsx`（5 类型已全导出）；
- antd 统一：dialog 分支 5 处基元、TurnStatusBadge（antd Badge status 语义）、
  SessionInputBar 发送/📎 按钮；尺寸按用户拍板（主操作 32px / 打断 small 24px）；
  遵守 §0.5 主题铁律（色走 token 零手写 hex）；
- 测试迁移：3 套 ISP 测试（56 用例）改直测 SessionPanel dialog 模式并改名，
  断言语义全保留禁删用例；TurnStatusBadge 断言 3 文件适配；mock 路径同步；
- 注释锚点校正（3 文件仅注释）；全仓 dangling import 守护；
- 团队协调：本变更先于 team-unify task-11 合入（P1 硬前置门），合入后更新
  task-11.md 代码锚点（仅文档）。

## 不在范围内（显式清单）

- 不改 backend / sillyhub-daemon 任何文件
- 不动 team-session-unify 分支与 worktree（协调仅限其 task-11.md 文档锚点）
- 不做 viewMode/onViewModeChange props 接线（另行处理）
- 不动 /sessions 页外壳（已 antd）与 page 分支 chrome（已 antd，对照基准）
- 不转换非 shadcn 原生控件（native select / tab pill / 队列 chips 原生 button）
- 不动 4 个弹窗消费面的外壳（Radix Dialog / shadcn Button / SectionCard）
- 不改 TurnTimeline 消息流内容渲染（MarkdownText 等；TurnStatusBadge 除外）
- 不调整区域布局 / 信息层级 / 交互流程

## 成功标准（可验证）

- 全仓 grep 无 `interactive-session-panel` 残留 import（注释历史提及除外）；
- 4 消费方渲染行为零回归：56 个迁移用例全过、用例数对账 56=56；
- 两模式 chrome 基元单一化：session-panel / session-input-bar /
  turn-timeline（TurnStatusBadge）中 grep 无 `@/components/ui/button`、
  `@/components/ui/badge` shadcn 原件 import；
- 全量 vitest + tsc --noEmit + lint 零失败；双主题换肤冒烟正常；
- 5 个消费面人工冒烟与原型对照一致（prototype-session-panel-unify.html §①-⑥）；
- 团队 task-11.md 锚点已更新，team-unify 其余任务不受影响。
