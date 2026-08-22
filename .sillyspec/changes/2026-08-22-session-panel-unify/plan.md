---
author: qinyi
created_at: 2026-08-22 13:40:00
change: 2026-08-22-session-panel-unify
plan_level: full
---

# 实现计划（Plan）

> 判定：8 任务 ≥ full 阈值 / 19 个文件路径（design §5 全集：1 删 + 10 改 + 3 迁移
> + 4 测试改 + 1 团队文档）/ 前端 3 模块（components-daemon、components-sessions、
> app-sessions-pages）/ 56 用例测试迁移需契约对账。
> 无 schema/状态机变更；同文件共享度高 → Wave 内不并行、设计已 Grill 无需人工复审。
> **顺序铁律（design §1 / D-006@v1）**：本变更整体先于 team-unify task-11 执行合入。

## Spike 前置验证
不需要——技术路线无未验证假设（适配层映射/类型导出/mock 兼容性均经 Grill 代码级实测）。

## Wave 编排（每个 Wave 收尾全绿）

### Wave 1（测试先行迁移，无依赖）
- task-05

> 适配层仍在场，3 套测试先改为直测 `SessionPanel mode="dialog"`（语义不变仍绿），
> 为 Wave 2 删除适配层扫清编译/断言障碍。

### Wave 2（依赖 Wave 1：结构搬移）
- task-01

> 删适配层 + 4 消费方直迁 + 类型归位；测试已直连不受影响，Wave 收尾全绿。

### Wave 3（依赖 Wave 2：antd 化第一批 + 注释校正，三任务文件不相交）
- task-02
- task-04
- task-06

### Wave 4（依赖 Wave 3：TurnStatusBadge，断言基线稳定后做）
- task-03

### Wave 5（依赖 Wave 1-4：收口）
- task-07

### Wave 6（特殊：代码合入 main 后执行）
- task-08

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-05 | 3 套 ISP 测试迁移改名 + mock 路径 | W1 | P0 | — | FR-06 | 56 用例对账语义保留；适配层未删先行迁移 |
| task-01 | 4 消费方直迁 + 类型归位 + 删适配层 + 守护 | W2 | P0 | task-05 | FR-01, FR-02, D-002@v1 | 结构搬移零视觉变化 |
| task-02 | session-panel dialog 分支 5 处 antd 化 | W3 | P0 | task-01 | FR-03, D-001@v1, D-004@v1 | 尺寸 32/24；结束 danger；UiBadge→Tag |
| task-04 | SessionInputBar 发送/📎 换 antd | W3 | P0 | task-01 | FR-05, D-005@v1 | primary / text |
| task-03 | TurnStatusBadge antd 化 + 3 断言测试适配 | W4 | P0 | task-02, task-04 | FR-04, D-003@v1 | 签名零变化；映射 processing/success/error/default |
| task-06 | 3 文件注释锚点校正 | W3 | P2 | task-01 | FR-09 | 仅注释零逻辑 |
| task-07 | 全量回归 + 双主题冒烟 + 5 面人工冒烟 | W5 | P0 | task-02, task-03, task-04, task-06 | FR-07, NFR | vitest/tsc/lint + 原型对照 |
| task-08 | team-unify task-11.md 锚点更新 | W6 | P1 | task-07 | FR-08, D-006@v1 | 仅文档；合入 main 后执行（P1 门收尾） |

## 关键路径
task-05 → task-01 → task-02 → task-03 → task-07（决定最短交付周期）

## 全局验收标准
1. 全量 vitest / tsc --noEmit / lint 零失败；迁移用例数对账 56=56、禁删用例
2. 全仓 grep 无 `interactive-session-panel` 残留 import（注释历史提及除外）
3. session-panel / session-input-bar / turn-timeline 中无 `@/components/ui/button`、
   `@/components/ui/badge` shadcn 原件 import（原生控件除外清单见 design §3）
4. 零硬编码 hex 新增；antd 色走 token；双主题换肤冒烟正常
5. 5 个消费面（/sessions 页、/runtimes 弹窗、workspace 会话区、change 会话区、
   runtime chat section）人工冒烟与原型 §①-⑥ 对照一致
6. task-08 完成后 team-unify task-11.md 锚点指向新结构，团队其余任务不受影响

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-02, task-03, task-04 | 全局验收 3/4 + 原型对照 |
| D-002@v1 | task-01~07（单变更一次交付） | 全局验收 1-5 单轮闭环 |
| D-003@v1 | task-03 | TurnStatusBadge 断言 3 文件适配全绿 |
| D-004@v1 | task-02 | dialog 分支尺寸 spot-check（32/24/danger） |
| D-005@v1 | task-04 | 发送 primary / 📎 text |
| D-006@v1 | task-08 + 全局顺序 | task-11.md 更新于合入后；执行期无并行同文件 |
