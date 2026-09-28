---
author: flow-machine-draft
created_at: 2026-09-28T06:45:19.285Z
---
# 需求规格（Requirements）— 2026-09-28-knowledge-gov-ux

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: 目标：每个信号用人话说明（这是什么/要不要紧/影响什么），可机械处理的给一键按钮（推荐目标预填 + 
Given 系统就绪
When 目标：每个信号用人话说明（这是什么/要不要紧/影响什么），可机械处理的给一键按钮（推荐目标预填 + 确认弹窗 + 完成反馈），不能一键的（需内容判断的）明说建议
Then 行为符合本条标准描述

### FR-02: 动作复用既有 POST /knowledge/governance/actions（redomain
Given 系统就绪
When 动作复用既有 POST /knowledge/governance/actions（redomain/repair），不加新写通道
Then 行为符合本条标准描述

### FR-03: 伪域各池（auto-sillyhub-daemon/auto-backend/auto-fronte
Given 系统就绪
When 伪域各池（auto-sillyhub-daemon/auto-backend/auto-frontend/auto-sillyspec）每池一行：人话描述+条数
Then 行为符合本条标准描述

### FR-04: 信号卡标题
Given 系统就绪
When 信号卡标题
Then 行为符合本条标准描述

### FR-05: 说明全部改为非开发者可懂文案，不再出现 CLI 命令字样
Given 系统就绪
When 说明全部改为非开发者可懂文案，不再出现 CLI 命令字样
Then 行为符合本条标准描述

### FR-06: 操作成功/失败有明确反馈（结果行/toast + 刷新）
Given 系统就绪
When 操作成功/失败有明确反馈（结果行/toast + 刷新）
Then 行为符合本条标准描述

### FR-07: 既有 governance 前端测试同步更新全绿，tsc
Given 前端 / 测试 相关模块就绪
When 既有 governance 前端测试同步更新全绿，tsc
Then 行为符合本条标准描述

### FR-08: eslint 0 错
Given 系统就绪
When eslint 0 错
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） --
frontend/src/components/knowledge/__tests__/governance-cards.test.tsx › 超阈：伪域卡分池人话渲染（人话标题/正文断言）；说明型信号（rot/inbox）用人话 用例
>

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） --
同上 › 一键归位：Popconfirm 确认后以预填的 from/to 调 redomain（断言 postKnowledgeGovernanceAction 收到既有端点契约参数）；binding-unresolved：一键修复路径（repair-paths）
>

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） --
同上 › 超阈：伪域卡分池人话渲染——推荐去向预填、unmapped 无按钮无害说明（redomain-go-auto-sillyhub-daemon/auto-backend/auto-frontend 三 testid + unmapped 行无按钮断言）
>

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） --
同上 › healthy：人话安语 + 底数（早期遗留）；超阈用例（「2 项可以整理」标题断言）
>

<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） --
同上 › 说明型信号（rot/inbox）用人话（断言卡片正文 not.toContain('sillyspec knowledge'）——CLI 命令字样不进卡）
>

<!--AGENT:测试绑定FR-06 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） --
同上 › 一键归位（governance-action-result 含「已完成」+ invalidateQueries 刷新）；local 模式守护进程提示用例
>

<!--AGENT:测试绑定FR-07 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） --
frontend/src/components/knowledge/__tests__/governance-cards.test.tsx 全文件 7 用例（本地实测 7 passed）+ npx tsc --noEmit 0 错
>

<!--AGENT:测试绑定FR-08 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） --
不适用：静态门禁项——npx eslint 对 governance-cards.tsx 及测试文件实测 0 error（2 个未用变量 warning 已清偿为 0 problem）
>
