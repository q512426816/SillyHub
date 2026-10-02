---
author: qinyi
created_at: 2026-09-27 01:10:00
change: 2026-09-26-core-pages-visual-redesign
plan_level: full
execution_mode: main
---

# 实现计划（Plan）— 核心三页 GitHub/Primer 风格重设计

## Wave 1（并行，无依赖）
- task-01

## Wave 2（依赖前序 Wave）
- task-02

## Wave 3（依赖前序 Wave）
- task-03

## Wave 4（依赖前序 Wave）
- task-04
- task-05
- task-07
- task-08
- task-09

## Wave 5（依赖前序 Wave）
- task-06
- task-10

## Wave 6（依赖前序 Wave）
- task-11

## Wave 7（依赖前序 Wave）
- task-12

## Wave 8（依赖前序 Wave）
- task-13

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | themes.ts semantic soft 浅底阶扩展 | W1 | P0 | — | FR-02, D-001 | 三主题各配 soft（dark 半透明底）；旧单值字段保留零破坏；globals.css 对应 var 注入 |
| task-02 | primer 基础原子组件 | W2 | P0 | task-01 | FR-01 | NEW state-icon/state-label/counter/empty-state + 单测（变体矩阵+iconName 双态） |
| task-03 | primer 结构组件 | W3 | P0 | task-01 | FR-01, FR-03 | NEW page-head/underline-nav/issue-row/stat-grid + 单测（UnderlineNav 受控+Counter 联动） |
| task-04 | primer 时间线/侧栏 + 桶导出收口 | W4 | P0 | task-02, task-03 | FR-01, FR-04 | NEW timeline/meta-panel + index.ts + primer.test.tsx 全量收口 |
| task-05 | 变更中心列表页重排 | W4 | P0 | task-03 | FR-03, D-001@v1, D-003@v1 | 7 层→4 层；antd Table 退役换 IssueRow；flash 告警收敛（PlatformSyncSection/解析警告）；同步修 page.test.tsx |
| task-06 | 变更详情页重排 | W5 | P0 | task-04 | FR-04, D-001@v1, D-003@v1 | checks 横条+Timeline 主线+MetaPanel 右栏；detail/ 涉及组件 Primer 化（change-stage-header 起按页面锚定展开）；同步修 3 份既有测试+detail 组件测试 |
| task-07 | 工作区列表页重排 | W4 | P0 | task-03 | FR-05, FR-08 | 行式列表；drag-grid 纵向化；规范分页；window.confirm→Modal；同步修 workspaces/__tests__/page.test.tsx |
| task-08 | 工作区概览页重排 | W4 | P0 | task-03 | FR-06 | 白底页头+守护横幅+StatGrid+两栏；原生表单→antd；amber 硬编码→token；同步修 page.test.tsx+page-sync.test.tsx |
| task-09 | 会话门户左栏 Primer 化 | W4 | P0 | task-02, task-03 | FR-07 | session-list-panel.tsx 展示层（3665 行只动 render/样式）；同步修相关测试 |
| task-10 | 会话门户中栏 Primer 化（四分支） | W5 | P0 | task-09 | FR-07 | session-panel-page.tsx 展示层（4615 行）+portal 四分支（群聊/预会话/空态 EmptyState）；同步修相关测试 |
| task-11 | 会话门户右栏信息面板 | W6 | P1 | task-10 | FR-07 | MetaPanel 化信息面板+portal 文件预览栏样式统一 |
| task-12 | top-bar token 修复 + 硬编码色清零 | W7 | P1 | task-05~task-11 | FR-09, FR-10, D-001@v1 | slate→语义 token；涉及文件 grep bg-green-50/text-slate-800/border-amber-300 清零 |
| task-13 | FRONTEND_PAGE_STYLE.md 回写 | W8 | P1 | task-12 | FR-09, D-002 | primer 章节+D-304 条款改写（PPM 范围不变，R-07）+ verify 抽查 /ppm/projects |

## 关键路径
task-01 → task-02/03 → task-05 → task-12 → task-13（组件库先行决定最短交付周期；会话门户链最长 task-09→10→11）

## 全局硬约束（从 design.md 逐字抄录，绑定所有 task）
- 颜色全部走三主题 token：MUST NOT 新增任何硬编码 hex；antd 色经 ConfigProvider 不手写；品牌色用 brand-* 语义阶
- 会话门户红线：MUST NOT 改动 props 接口、状态机、数据流、轮询与 WS 消息处理逻辑（仅 render 与样式类）
- 行为保留：智能轮询（30s 全终态停轮）、深链（?session=、?new=1、列表 ?tab=/?search=）、批量操作、拖拽排序、群聊/预会话/空态四分支全部保留
- 移动端零波及：app/m/ 路由与移动组件零改动；若 desktop 改动组件被 /m 引用，MUST 保持其 props 兼容
- 正文可读性下限 12px（数据密集 mono 元数据 MAY 11px）
- 删除类操作 antd Modal（MUST NOT 保留 window.confirm）
- 测试纪律：改断言不改测试意图（规则 9）；只跑相关测试，全量留给 CI（规则 0）
- 不触发 pnpm gen:types（无后端改动）；tsc 0 新增错误
- 对照基准：prototype-github-redesign.html 五视图（本变更目录）

## 全局验收标准
1. primer 组件单测全绿（变体矩阵/受控契约/空态）；tsc 0 新增错误；eslint 0 新增
2. 五页面既有测试（改断言不改意图）全绿：changes/__tests__/page.test.tsx、[cid]/ 三份、workspaces/__tests__/page.test.tsx、[id]/page.test.tsx + page-sync.test.tsx、sessions/__tests__/page.test.tsx 及涉及的组件测试
3. 涉及文件 grep 硬编码色清单清零（bg-green-50/text-slate-800/border-amber-300 及同类）
4. 三主题（blue/ai-native/dark）逐页截图走查通过；/ppm/projects 基准页零回归（R-07）
5. DOM 结构与原型五视图对照一致；四分支/轮询/深链/批量/拖拽行为点验通过
