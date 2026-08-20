---
plan_level: full
---

# 实现计划（Plan）：工作区详情页工作台式重构

> 来源：design.md §5（四段式+九块映射表）+ tasks.md（5 任务骨架）+ decisions.md（D-201/202/203）。
> Grill 残留定案：Collapse items 全量 `forceRender: true`（与现状"加载即挂载"数据时序等价，测试无需展开交互；生产放弃懒加载收益换行为等价，R-03 覆盖）。

## Wave 1（三组件并行，无依赖无共享文件）
- task-01
- task-02
- task-03

## Wave 2（依赖 Wave 1）
- task-04

## Wave 3（依赖 Wave 2）
- task-05

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | hero-header | W1 | P0 | — | FR-01, D-201/202 | 纯展示；渐变 brand 阶；操作组=编辑信息+返回 |
| task-02 | stats-row | W1 | P0 | — | FR-02, D-201/202 | 可点击性同现状（归档 div） |
| task-03 | quick-entry-grid | W1 | P0 | — | FR-03, D-201/202 | 6 入口 href 同现状；grid-cols-3 |
| task-04 | page.tsx 重排 | W2 | P0 | task-01,02,03 | FR-04, D-203 | 映射表对账；Collapse ghost+forceRender |
| task-05 | 测试同步+验证 | W3 | P0 | task-04 | FR-05 | 新增统计/入口断言；全量 pnpm test |

## 关键路径

task-01/02/03 → task-04 → task-05

## 全局验收标准

- [ ] design §5 映射表 10 行逐块落地（含 WorkspaceDaemonSwitcher 面板底部/守护共享条件渲染）
- [ ] 统计四数字/6 入口 href 与重构前等价（新断言锁定）
- [ ] 既有 8 个用例全绿（ConfigCard mock 接线 + default_agent×3 + 三策略 + 三个负向断言 it2/3/4 经 mock 保护重排后仍成立，全量 pnpm test 兜底）
- [ ] tsc + eslint 0 error；全量 pnpm test 通过
- [ ] Docker rebuild 后双主题截图核对（横幅渐变 blue 侧平移、宫格悬浮三件套）
- [ ] 行为等价：无新增 API 调用；编辑/保存/绑定交互不变

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-201 | task-01~04 | 四段式落位，task-05 断言 |
| D-202 | task-01~03, 05 | 纯展示组件 + page.tsx 编排层 450-480 行 |
| D-203 | task-04 | ghost Collapse 分组截图 |
| FR-01~05 | 见任务总表 | requirements GWT 对应 |
