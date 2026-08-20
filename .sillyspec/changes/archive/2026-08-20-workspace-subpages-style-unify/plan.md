---
plan_level: full
---

# 实现计划（Plan）：工作区子页面样式统一（批量）

> 来源：design.md §5（9 项×8 页矩阵，Grill 修订版含 8 处错误条/2 内嵌组件）+ tasks.md（6 骨架）+ D-301~304。
> 批量模式（design §4）：公共件先行 Wave，逐页套用 Wave，验收清单统一收尾。验收依据=§0.5+概览页基线（D-304）。

## Wave 1（公共件，无依赖）
- task-01

## Wave 2（A 组套用·按文件分组两任务并行，文件集互斥，依赖 W1）
- task-02
- task-03

## Wave 3（B 组套用·两任务文件集互斥；与 W2 有共文件，靠 Wave 串行错开，须 W2 完成后执行）
- task-04
- task-05

## Wave 4（统一验收，依赖全部）
- task-06

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | ErrorBanner 组件+8 处替换 | W1 | P0 | — | FR-01, D-301 | 新组件（**必须保留 role=alert**——explorer-page.test:254 与 shared-daemon-manager.test 尾部 getByRole("alert") 断言依赖）+components:119/changes:514/skills:51/mcp:53/mcp-tokens:119/members:141/explorer:124-131/shared-daemon-manager:124 |
| task-02 | A 组·四页套用（skills/mcp/components/members） | W2 | P0 | task-01 | FR-02, FR-03, FR-04, FR-05 | 按文件分组（审查 P1-1 修正）：四页全部 A 组项——返链入 actions（目标 /workspaces/${id}）/空态换 EmptyState/skills+mcp 卡 hover=lift/h-7 换 shadcn（components NAV Link 用 buttonVariants 先例 changes:442）/mcp:124 amber 语义色 |
| task-03 | A 组·三页套用（changes/explorer/mcp-tokens） | W2 | P0 | task-01 | FR-02, FR-04 | 按文件分组：changes:521,530 语义色；explorer:105-107 语义色（:124-131 错误条已归 task-01）；mcp-tokens:271-276 语义色+返链入 actions |
| task-04 | 表格规格+中文化 | W3 | P0 | — | FR-05, D-303 | members/mcp-tokens 表头规格统一+member-row 行 hover；members 全中文（含 Actions/subtitle） |
| task-05 | 容器与锚修正 | W3 | P0 | — | FR-06 | session-section:242 换 SectionCard（bodyPadding=p-0+className 透传 flex/min-h 适配包裹层）；explorer 56→64px+antd Button 换 shadcn（**保留"刷新"按钮文案**——explorer-page.test:191 断言） |
| task-06 | 统一验收 | W4 | P0 | 全部 | 全 FR | grep 清单（bg-red-50/tone 硬编码/英文文案三清零）+断言同步+全量 test+tsc/eslint+Docker 抽查 skills/members/explorer 双主题 |

## 关键路径

task-01 → task-02/03（W2 内文件互斥并行）→ task-04/05（W3 在 W2 完成后串行执行，共文件靠 Wave 错开）→ task-06

## 全局验收标准

- [ ] grep 三清零：bg-red-50 错误条（8 页+2 内嵌组件）、amber/emerald/blue tone 硬编码（5 处）、members 英文文案
- [ ] 返回链接 4 处统一（actions+目标一致）；空态 4 处 EmptyState；skills/mcp hover lift
- [ ] 两手写表头规格逐字段一致；explorer 高度锚 64px
- [ ] tsc + eslint 0 error；全量 pnpm test 通过（断言同步：skills:90/mcp:116 空态文案；explorer:254 alert 角色与 :191 刷新文案经保留设计免改；changes:424 不受影响移出同步清单）
- [ ] Docker 抽查 3 页双主题观感与概览页一致
- [ ] 行为等价：零业务逻辑/API 变更

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-301 | task-01~03 | 公共件落地+替换清零 |
| D-302 | 全部 | 无新视觉语言，对照 §0.5 |
| D-303 | task-04 | 表头规格对照 |
| D-304 | task-06 | 验收依据声明 |
| FR-01~06 | 见任务总表 | requirements GWT 对应 |
