---
author: flow-machine-draft
created_at: 2026-10-12T00:42:29.656Z
---
# 设计记录（Design Record）— 2026-10-12-borrow-ctx-truncate-rest

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

408bc0889 给 description/tech_stack/repo_url 三字段补了 truncateText（500 阈值）截断，但同文件仍有四处字段值原样进 AGENTS.md 正文：工作区行的 name/slug/display_alias（backend 各 200 上限、无模式约束）与真实代码目录行的 root_path（backend 上限 4096，sanitize 只删 Unicode bidi 不可见字符，换行/反引号是 POSIX 合法路径字符）。lender 登记超长或含 markdown 的值即可向 borrower agent 自动加载正文注入多行指令——与已收口三字段同族。修法：四处全部套既有 `truncateText`（逐字段截断，工作区行三字段各自过阈值而非聚合后截，保证单字段超长不挤掉同行的 slug/别名信息），零新增防御原语，头注安全语义段同步为「全部进正文的自由文本字段统一截断」。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `renderBorrowSandboxContext` 签名/返回形态不变；可观察变化：超长 name/slug/display_alias/root_path 在输出中被截断加「…（已截断）」（此前原样直达正文——缺陷行为，无消费方依赖）；500 以内值逐字不变。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   纯函数、单次入参渲染，无时序面；渲染幂等（同 ctx 同输出）不受影响。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   不适用：无共享状态；写入落盘在 daemon marker 分支（fail-open），与本模块无并发耦合。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   不适用：无状态迁移；截断只影响单次渲染输出。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   字段值来自单条 lease metadata（borrow_workspace_context），逐字段截断不改变数据来源边界，无串台面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 风险：换行/反引号等合法路径字符经 500 截断后仍可能在正文内换行呈现——截断只限长不限形（与 408bc0889 同款边界），收尾免责行+写守卫 enforcement（D-003 红线：写隔离唯一权威是 SessionManager 写守卫）兜底；彻底转义会破坏合法路径显示（POSIX 允许换行/反引号），得不偿失。
- 放弃方案 A：对字段值做 markdown 转义/去反引号——破坏合法路径与名称显示，且转义规则本身成为新注入面；截断+免责行是既有单一范式。
- 放弃方案 B：把 type/default_branch 一并截断——两字段为 backend 受约束枚举/短标识，无自由文本注入面，纳入只会稀释「自由文本长字段」防线的语义。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 改 | sillyhub-daemon/src/borrow-sandbox-context.ts | name/slug/alias/root_path 四处套 truncateText + 头注同步 |
| 改 | sillyhub-daemon/tests/borrow-sandbox-context.test.ts | 新增截断覆盖用例 |
