---
author: flow-machine-draft
created_at: 2026-09-26T23:20:17.495Z
---
# 需求规格（Requirements）— 2026-09-27-visual-gap-fix

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: 工作区列表每行为单行紧凑条目（无 dl 字段表/独立 footer），hover 显操作，拖拽/别名
Given 系统就绪
When 工作区列表每行为单行紧凑条目（无 dl 字段表/独立 footer），hover 显操作，拖拽/别名/重扫/删除行为全部保留
Then 行为符合本条标准描述

### FR-02: 概览页呈 统计四格+左主右辅两栏，Hero 之后的旧卡片流结构收敛
Given 系统就绪
When 概览页呈 统计四格+左主右辅两栏，Hero 之后的旧卡片流结构收敛
Then 行为符合本条标准描述

### FR-03: 会话左栏条目高密度两段式，选中态清晰
Given 系统就绪
When 会话左栏条目高密度两段式，选中态清晰
Then 行为符合本条标准描述

### FR-04: 相关测试全绿 + tsc 0
Given 测试 相关模块就绪
When 相关测试全绿 + tsc 0
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 -->
frontend/src/components/__tests__/workspace-card.test.tsx（19 用例：名称/别名/守护徽标/类型徽章/时间行/hover 操作/点击激活/Modal 删除）+ frontend/src/components/__tests__/workspace-drag-grid.test.tsx（14 用例：拖拽排序接线）+ frontend/src/app/(dashboard)/workspaces/__tests__/page.test.tsx（15 用例：列表接线/分页/筛选）

<!--AGENT:测试绑定FR-02 -->
frontend/src/app/(dashboard)/workspaces/[id]/page.test.tsx（16 用例：统计四数字渲染/基本信息/守护横幅/两栏组件接线）+ frontend/src/app/(dashboard)/workspaces/[id]/__tests__/page-sync.test.tsx（7 用例）+ frontend/src/components/workspace/__tests__/changes-overview-card.test.tsx（13 用例，1 例主仓预存债已归因）

<!--AGENT:测试绑定FR-03 -->
frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx + frontend/src/components/sessions 相关套件（本变更未改门户文件，沿用 2026-09-26-core-pages-visual-redesign 已验证的 386/387 基线）

<!--AGENT:测试绑定FR-04 -->
frontend 全量相关套件 702/704（2 失败=已知主仓预存债：changes-overview-card ghost 折叠、pre-session-picker cursor caps，基线复现归因）+ pnpm typecheck 0 + pnpm lint 0
