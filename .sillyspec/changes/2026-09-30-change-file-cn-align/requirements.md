---
author: flow-machine-draft
created_at: 2026-09-30T02:32:53.242Z
---
# 需求规格（Requirements）— 2026-09-30-change-file-cn-align

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: 文件树行内中文名与英文小字紧凑相邻排列(左对齐),不再两端分离
Given 系统就绪
When 文件树行内中文名与英文小字紧凑相邻排列(左对齐),不再两端分离
Then 行为符合本条标准描述

### FR-02: 徽标(排队中/只读)仍靠行右端不受影响
Given 徽标 相关模块就绪
When 徽标(排队中/只读)仍靠行右端不受影响
Then 行为符合本条标准描述

### FR-03: change-file-tree 相关测试不回归
Given 测试 相关模块就绪
When change-file-tree 相关测试不回归
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- frontend/src/components/__tests__/change-file-tree.test.tsx「固定产物树节点主显中文名 + 原名对照，非固定名维持原名」（文本层回归；紧凑排列为纯 className 布局，无断言面，视觉由 visual-evidence.md 截图证据覆盖）


<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- 不适用：徽标区未改动——ml-auto 徽标 span 原样保留，既有「渲染文件树列出全部文件」（含只读徽标断言）回归绿即可，无新增行为


<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- frontend/src/components/__tests__/change-file-tree.test.tsx 全文件 19 用例回归（布局调整不破坏文本锚点/getByText 命中）

