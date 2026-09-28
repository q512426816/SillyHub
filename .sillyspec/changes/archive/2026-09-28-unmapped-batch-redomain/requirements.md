---
author: flow-machine-draft
created_at: 2026-09-28T13:38:16.467Z
---
# 需求规格（Requirements）— 2026-09-28-unmapped-batch-redomain

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: 方法：按条目自带「变更：<name>」分组 → 读归档 change.patch 的交付路径判定目标
Given 系统就绪
When 方法：按条目自带「变更：<name>」分组
Then 读归档 change.patch 的交付路径判定目标域（backend/frontend/daemon/sillyspec 四粗域，与页面一键归位口径一致）

### FR-02: 映射表先出后审：patch 缺失/多域混合的变更用条目文本关键词兜底判定，映射表人工复核后才落盘
Given 系统就绪
When 映射表先出后审：patch 缺失/多域混合的变更用条目文本关键词兜底判定，映射表人工复核后才落盘
Then 行为符合本条标准描述

### FR-03: 699 条全部迁入真域，计数守恒（迁移前后条目总数一致，无丢失无重复）
Given 迁移 相关模块就绪
When 699 条全部迁入真域，计数守恒（迁移前后条目总数一致，无丢失无重复）
Then 行为符合本条标准描述

### FR-04: fr/unmapped.md 清空删除，INDEX 路由行同步
Given 系统就绪
When fr/unmapped.md 清空删除，INDEX 路由行同步
Then 行为符合本条标准描述

### FR-05: sillyspec knowledge validate 通过
Given 系统就绪
When sillyspec knowledge validate 通过
Then 行为符合本条标准描述

### FR-06: digest 伪域归零（unmapped 池 0）
Given 系统就绪
When digest 伪域归零（unmapped 池 0）
Then 行为符合本条标准描述

### FR-07: 映射依据可追溯（每个变更→域的判定来源留档在变更目录）
Given 系统就绪
When 映射依据可追溯（每个变更
Then 域的判定来源留档在变更目录）

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） --
脚本内建守恒断言（698=390+207+101）+ 三域文件 ^## FR- 计数终验（468/309/184）——见变更目录 mapping-analysis.json 与本对话执行回执
>

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） --
sillyspec knowledge validate → ok:true / errors:[]；unmapped.md 已删 + INDEX unmapped 行已清（脚本输出留档）
>

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） --
sillyspec knowledge digest → 伪域条目 0（执行后实测回执）
>

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） --
mapping-analysis.json 全量留档（每变更 domain/via/areas 路径计数；人工纠偏 5 处标 manual 并在 design 槽1 记录依据）
>

<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） --
不适用：纯数据迁移零代码改动——无测试文件面；守恒/健康/归零验证由 FR-01~03 覆盖（脚本断言 + validate + digest 实测）
>

<!--AGENT:测试绑定FR-06 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） --
不适用：同 FR-05——无代码即无 lint/tsc 面（flow done 门禁 lint 侧对 1 个门文件已过）
>

<!--AGENT:测试绑定FR-07 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） --
不适用：变更目录留档即交付物（mapping-analysis.json 已随 FR-04 绑定；归档后进 changes/archive/2026-09-28-unmapped-batch-redomain/ 永久可溯）
>
