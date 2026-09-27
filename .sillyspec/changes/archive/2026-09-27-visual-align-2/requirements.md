---
author: flow-machine-draft
created_at: 2026-09-26T23:43:19.940Z
---
# 需求规格（Requirements）— 2026-09-27-visual-align-2

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: 变更中心每行两段层级与原型一致（标题主行+key 副行），底部有显示 x
Given 系统就绪
When 变更中心每行两段层级与原型一致（标题主行+key 副行），底部有显示 x
Then 行为符合本条标准描述

### FR-02: y
Given 系统就绪
When y
Then 行为符合本条标准描述

### FR-03: 变更详情右侧为单块 MetaPanel 分组（负责人/消耗/变更文件/关联会话/快速任务/观测事件）
Given 系统就绪
When 变更详情右侧为单块 MetaPanel 分组（负责人/消耗/变更文件/关联会话/快速任务/观测事件），时间线为竖线节点形态
Then 行为符合本条标准描述

### FR-04: 概览右栏为 About 侧栏（路径/技术栈/关联项目/成员/创建时间）
Given 系统就绪
When 概览右栏为 About 侧栏（路径/技术栈/关联项目/成员/创建时间）
Then 行为符合本条标准描述

### FR-05: 相关测试全绿 + tsc 0 + 部署后截图与原型并排核对一致
Given 测试 相关模块就绪
When 相关测试全绿 + tsc 0 + 部署后截图与原型并排核对一致
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 -->
frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx（36 用例全绿：行排版断言迁移后 owner 头像三态/相对时间/tab/深链）

<!--AGENT:测试绑定FR-02 -->
frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid] 三套件 + src/components/changes/detail 全量 134 用例全绿（右栏融合零功能破坏）

<!--AGENT:测试绑定FR-03 -->
frontend/src/app/(dashboard)/workspaces/[id]/page.test.tsx + __tests__/page-sync.test.tsx 23 用例全绿（About 面板数据全来自既有 workspace 加载）

<!--AGENT:测试绑定FR-04 -->
frontend 相关套件全绿 + pnpm typecheck 0 + 部署后浏览器与原型并排截图核对

<!--AGENT:测试绑定FR-05 -->
不适用：部署后人工并排核对（浏览器截图对照原型五视图），非自动化测试面
