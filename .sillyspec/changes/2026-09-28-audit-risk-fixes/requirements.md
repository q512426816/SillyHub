---
author: flow-machine-draft
created_at: 2026-09-27T21:39:32.123Z
---
# 需求规格（Requirements）— 2026-09-28-audit-risk-fixes

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: KnowledgeGovernanceHandler digest/action 双点过 asser
Given 系统就绪
When KnowledgeGovernanceHandler digest/action 双点过 assertWithinAllowedRoots（daemon.ts 
Then 行为符合本条标准描述

### FR-02: knowledge root 黑名单收窄到异常值字符集，Windows 合法目录字符 & $ ' `
Given 系统就绪
When knowledge root 黑名单收窄到异常值字符集，Windows 合法目录字符 & $ ' `
Then 行为符合本条标准描述

### FR-03: 不再误拦
Given 系统就绪
When 不再误拦
Then 行为符合本条标准描述

### FR-04: mobile variant 下 detailColumnVisible 恒 false，local
Given 系统就绪
When mobile variant 下 detailColumnVisible 恒 false，localStorage 跨视口不再双挂 TaskExecutionP
Then 行为符合本条标准描述

### FR-05: SessionUsageBar
Given 系统就绪
When SessionUsageBar
Then 行为符合本条标准描述

### FR-06: mobile-change-detail thin
Given 系统就绪
When mobile-change-detail thin
Then 行为符合本条标准描述

### FR-07: quick 卡判定对齐 desktop isThinLineageChange（归档 thin 与 
Given 系统就绪
When quick 卡判定对齐 desktop isThinLineageChange（归档 thin 与 change_type=quick 落轻量卡）
Then 行为符合本条标准描述

### FR-08: 变更列表删除按钮与标题链接 stopPropagation，点击不再触发整行 location.as
Given 系统就绪
When 变更列表删除按钮与标题链接 stopPropagation，点击不再触发整行 location.assign
Then 行为符合本条标准描述

### FR-09: DaemonRpcRemoteError 重映射改用 exc.code 且 timeout→504 
Given 系统就绪
When DaemonRpcRemoteError 重映射改用 exc.code 且 timeout
Then 504 其余

### FR-10: _safe_module_doc 拦 NUL 字节，含 \0 的 doc 不读盘整条丢弃
Given 系统就绪
When _safe_module_doc 拦 NUL 字节，含 \0 的 doc 不读盘整条丢弃
Then 行为符合本条标准描述

### FR-11: 聚焦测试全绿（daemon handler / session 变体 / mobile 详情 / c
Given 测试 相关模块就绪
When 聚焦测试全绿（daemon handler / session 变体 / mobile 详情 / changes 页 / test_governance / t
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-06 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-07 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-08 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-09 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-10 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-11 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
