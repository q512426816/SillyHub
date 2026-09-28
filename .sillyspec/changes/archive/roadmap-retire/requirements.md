---
author: flow-machine-draft
created_at: 2026-09-28T06:08:40.809Z
---
# 需求规格（Requirements）— roadmap-retire

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: .sillyspec/ROADMAP.md 自平台仓删除并显式 pathspec 提交
Given 系统就绪
When .sillyspec/ROADMAP.md 自平台仓删除并显式 pathspec 提交
Then 行为符合本条标准描述

### FR-02: 读侧零改动：sillyspec CLI next.js 绿地探测/status cat/lite 豁
Given 系统就绪
When 读侧零改动：sillyspec CLI next.js 绿地探测/status cat/lite 豁免措辞均不动（条件化自失活）
Then 行为符合本条标准描述

### FR-03: daemon sillyspec-manager.ts:2184 仅为注释示例非消费点
Given 系统就绪
When daemon sillyspec-manager.ts:2184 仅为注释示例非消费点
Then 行为符合本条标准描述

### FR-04: 纯 doc 删除，收口实测自动跳过代码面
Given 系统就绪
When 纯 doc 删除，收口实测自动跳过代码面
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
不适用：纯 tracked 文件删除（.sillyspec/ROADMAP.md），无运行时行为；删除事实由 git 提交面锚定（patch 冻结面按交付过滤不含 .sillyspec/ 治理路径，属预期）

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
不适用：读侧核验为静态结论（sillyspec CLI 读点条件化：stages/status.js:16 cat 带 2>/dev/null、stages/archive.js:60「存在→」、run/next.js:135 绿地探测为通用功能保留；daemon sillyspec-manager.ts:2184 仅注释示例），无行为分支可断言；本变更实测门文件面 0 自动跳过

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
不适用：提交纪律由 git 历史锚定（提交只含 2 路径，并行会话 untracked 目录未带走）

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
不适用：实测面自动跳过是 CLI 对纯 doc 删除的既定行为（门文件 0 个），非本变更实现的被测功能
