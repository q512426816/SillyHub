---
author: qinyi
created_at: 2026-08-22 17:00:00
change: 2026-08-22-workspace-sessions-portal
plan_level: full
---

# 实现计划（Plan）

> 判定 full：9 任务 / 16 文件 / 跨 components-sessions、app-sessions-pages、
> changes 域 / 含新路由与组件退役。无 schema/状态机变更；契约对分 Wave 串行。
> context 由本步生成。

## Spike 前置验证
不需要（Grill 两轮已核：提取可行性/整列适配/绑定通道/深链先例均有代码实证）。

## Wave 编排（每 Wave 收尾全绿）

### Wave 1（基座两件，文件不相交可并行）
- task-04
- task-05

### Wave 2（门户组件，消费 W1 契约）
- task-01

### Wave 3（三入口接线，文件不相交）
- task-02
- task-03
- task-06

### Wave 4（退役清理，依赖三入口全接线）
- task-07

### Wave 5（测试适配与新增集中收口）
- task-08

### Wave 6（回归与部署实证）
- task-09

### Wave 7（v3 返工：scope 数据源反转，用户验收驱动）
- task-10
- task-11
- task-12

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-04 | SessionListPanel scope 化 | W1 | P0 | — | FR-04, D-003@v1 | 数据源切换/仅本人过滤/筛选隐藏/降级矩阵 |
| task-05 | NewSessionForm 锁定绑定 | W1 | P0 | — | FR-02/03 | bindWorkspaceId/bindChangeId |
| task-01 | SessionsPortal 提取 | W2 | P0 | task-04, task-05 | FR-01, D-001@v1, D-004@v1 | 整块提取+scope 派生+?session= |
| task-02 | /sessions 薄壳+工作区页接线 | W3 | P0 | task-01 | FR-01/02 | 两页改渲染门户 |
| task-03 | 变更级新路由 | W3 | P0 | task-01 | FR-03, D-002@v1 | change scope 薄壳页 |
| task-06 | 变更入口卡（含其测试同波适配） | W3 | P1 | task-01 | FR-03 | 前 3 条预览+打开+直达；card 测试同任务收口保绿 |
| task-07 | 退役清理 | W4 | P0 | task-02, task-03, task-06 | FR-06, D-005@v1 | 删两组件两测试+守护 |
| task-08 | 测试适配新增 | W5 | P0 | task-07 | FR-07 | 门户三 scope 用例+三处适配（card 测试已归 task-06） |
| task-09 | 回归+部署实证 | W6 | P0 | task-08 | FR-07 | 全量三件套+3001 重建+浏览器 |

## 关键路径
task-04/05 → task-01 → task-02 → task-07 → task-08 → task-09

## 全局验收标准
1. 全量 vitest/tsc/lint 零失败；退役用例语义迁移对账（4 用例过滤语义 → 门户新用例）
2. 三路由渲染点 grep 均为 SessionsPortal；全仓无 dangling import（退役组件零残留）
3. 旧能力无回退：仅本人过滤/?session= 深链/创建绑定/ended 手动重开均有测试
4. 浏览器三入口对照一致（仅列表范围/绑定/标题后缀不同）；3001 部署后实证

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01~04 | 渲染点 grep + 浏览器对照 |
| D-002@v1 | task-03, task-06 | 新路由可达 + 入口卡跳转 |
| D-003@v1 | task-04, task-06, task-08 | 过滤断言（含 change 级统一断言） |
| D-004@v1 | task-01, task-06, task-08 | ?session= 有效/无效两分支用例 |
| D-005@v1 | task-07 | 退役后 page 模式 reopen 断言 |

| task-10 | 后端全局列表加 scope 过滤参 | W7 | P0 | — | D-003@v2 | router+service+pytest |
| task-11 | 前端 scope 切全局端点+删降级 | W7 | P0 | task-10 | D-003@v2 | 同字段同筛选 |
| task-12 | 回归+部署+三入口复验 | W7 | P0 | task-11 | FR-04/07 | 用户复验闭环 |
