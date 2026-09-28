---
author: flow-machine-draft
created_at: 2026-09-28T09:04:42.689Z
---
# 需求规格（Requirements）— 2026-09-28-change-ux-detail-batch

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: 列表行描述单行截断不再溢出覆盖右列/影响模块（min-w-0 修复），悬浮全文保留
Given 系统就绪
When 列表行描述单行截断不再溢出覆盖右列/影响模块（min-w-0 修复），悬浮全文保留
Then 行为符合本条标准描述

### FR-02: 详情页头部显示变更描述（单行截断+悬浮全文）
Given 系统就绪
When 详情页头部显示变更描述（单行截断+悬浮全文）
Then 行为符合本条标准描述

### FR-03: 平台同步处理区收进工具条按钮（搜索/重置旁），点开抽屉承载原处理区
Given 系统就绪
When 平台同步处理区收进工具条按钮（搜索/重置旁），点开抽屉承载原处理区
Then 行为符合本条标准描述

### FR-04: 无绑定数据源时抽屉内中性提示
Given 系统就绪
When 无绑定数据源时抽屉内中性提示
Then 行为符合本条标准描述

### FR-05: 详情页轻量变更说明卡（协议 1/2、2/2 长文案）不再渲染
Given 系统就绪
When 详情页轻量变更说明卡（协议 1/2、2/2 长文案）不再渲染
Then 行为符合本条标准描述

### FR-06: 顶部轻量流程条保留
Given 系统就绪
When 顶部轻量流程条保留
Then 行为符合本条标准描述

### FR-07: 沉淀资产卡默认展开、移入主栏，各分组卡片固定高度（超出滚动）网格对齐
Given 系统就绪
When 沉淀资产卡默认展开、移入主栏，各分组卡片固定高度（超出滚动）网格对齐
Then 行为符合本条标准描述

### FR-08: 智能体运行状态卡自桌面详情页移除（组件与移动端用法保留）
Given 组件 相关模块就绪
When 智能体运行状态卡自桌面详情页移除（组件与移动端用法保留）
Then 行为符合本条标准描述

### FR-09: 关联快速任务卡无关联时不渲染（有数据才显示）
Given 系统就绪
When 关联快速任务卡无关联时不渲染（有数据才显示）
Then 行为符合本条标准描述

### FR-10: 范围对账卡去头部说明副标题与降级双段说明，压缩为单行降级提示（归档指路保留）
Given 系统就绪
When 范围对账卡去头部说明副标题与降级双段说明，压缩为单行降级提示（归档指路保留）
Then 行为符合本条标准描述

### FR-11: 相关前端测试更新通过，tsc/eslint 0 错
Given 前端 / 测试 相关模块就绪
When 相关前端测试更新通过，tsc/eslint 0 错
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx :: 「变更行渲染描述（悬浮全文可读），无描述行零占位」（类名含 min-w-0；jsdom 不渲像素，溢出修复机理由类名+代码审阅锚定 changes/page.tsx 描述 span）

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx :: 「头部显示变更描述（单行截断 + 悬浮全文）」

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx :: 「平台同步：工具条按钮常驻，点开抽屉承载处理区（未绑定时中性提示）」

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx :: 同上用例 findByText(/暂无同步状态/) 断言；组件面 platform-sync-section.test.tsx（drawerHint 分支经页面集成覆盖，组件单测未单列）

<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/components/changes/detail/__tests__/change-stage-actions.test.tsx :: 「thin 阶段：两段式说明卡已移除…不落通用『无可审批』文案」（反向钉：◈/flow start/fail-closed 文案缺席+container 空）

<!--AGENT:测试绑定FR-06 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx :: 「FR-02：thin 阶段标题旁显示…」（findByText("flow start") 断言流程条在场）

<!--AGENT:测试绑定FR-07 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx :: 「默认展开…分组直接可见，点击头部可收起」+「四组渲染」（网格/固定高度为 CSS 语义，jsdom 断言结构与默认态；观感移交真机目验）

<!--AGENT:测试绑定FR-08 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx :: 「保留只读展示区…（执行日志卡已移除）」（queryByTestId change-agent-run-log 为 Null 反向钉）；组件本体 change-agent-run-log.test.tsx 保留全绿（移动端用法）

<!--AGENT:测试绑定FR-09 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx :: 「关联快速任务区块：无关联时整卡不渲染」+「命中条目列出…」（有数据路径正向钉）

<!--AGENT:测试绑定FR-10 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/components/changes/__tests__/scope-audit-command-card.test.tsx :: 「ok=true 降级：不渲染三态 chips…归档变更指路留档」（单行含不出三态+归档留档）+「降级 + 未归档：口径提示不带留档指路」

<!--AGENT:测试绑定FR-11 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
受影响面 vitest 30 文件 370P（changes 列表/详情页 + components/changes + components/mobile）+ tsc --noEmit 0 错 + eslint 触碰文件 0 错（3 warning 预存债，较 HEAD 同文件 4 条少 1，git stash 对照实证）；flow done 实测门 test+lint 双绿（deps py1+jsx6+FR 绑定 7）
