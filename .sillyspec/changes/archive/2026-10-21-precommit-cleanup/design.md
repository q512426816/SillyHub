---
author: flow-machine-draft
created_at: 2026-10-21T01:35:13.760Z
---
# 设计记录（Design Record）— 2026-10-21-precommit-cleanup

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：两件事收尾。① 清理：删除 `.tmp/hooks/`（2026-10-21-gitlog-quotepath-fix 会话在官方 runner 不可用期自建的等价 pre-commit hook 面）；其使命已被 2026-10-21-precommit-sandbox-entries 官方链适配替代（三条 entry 去 msys + 会话级 `export PRE_COMMIT_HOME`），留着会误导后续会话继续走非官方通道。删除后 grep 全仓活跃面核验零引用（`changes/archive/` 属历史留痕不改写——审计真相在归档件）。② 沉淀：`known-issues.md` 追加 🟡 条目 + `INDEX.md` 路由行，把本会话探针链实锤的「python 子树 Low IL」环境限制（症状/根因/WSL bash 误解析坑/处置）写成可检索知识，后续会话按关键词命中即得结论，不再重走探针链。选 known-issues.md 而非 AGENTS.md：这是宿主机环境事实（desktop-hj0am09 的沙箱行为）非流程规则，知识库按需注入比全局横幅更合适。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：无代码/命令/API 面。改动三处：删除 gitignored 的 `.tmp/hooks/`（运行时残留）；`known-issues.md` 尾部追加一个 🟡 小节（追加式，不改既有条目）；`INDEX.md` known-issues 小节加一行路由。会话行为约定不变（官方链 + PRE_COMMIT_HOME，backend/.pre-commit-config.yaml 注释已载）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

答：成立。纯文档追加与静态残留删除，无时序依赖；knowledge search 索引按文件内容懒建/重建，条目落盘后检索面自洽。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

答：known-issues.md/INDEX.md 为共享仓热文件，并行会话可能同时编辑——本变更采用尾部追加（不触碰既有行）+ 显式 pathspec 提交（规则 11），最坏冲突手工解；`.tmp/hooks` 删除只影响本会话自建面，他侧会话若仍引用仅是自身降级（其提交回执会如实留痕）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

答：安全。删除与文档追加均为幂等操作；中断重入按 flow 断点续，知识条目以文件在位为准。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

答：知识条目描述的是宿主机级沙箱行为，条目内显式标注主机语境（desktop-hj0am09 实证）——其他主机读到时应先复测再套用；PRE_COMMIT_HOME 指引按仓解析（$PWD），不跨仓泄漏。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：风险①：knowledge search 的索引对新增条目可能非即时（懒建/同步节奏）——FR-03 以 search 实证命中为验收，未命中则重跑 search 触发同步，验收门兜底。风险②：INDEX 锚点 slug 与 GitHub 风格推导不一致导致点击 404——对照既有 🟡 条目锚点格式（emoji 剥除、空格转连字符）书写，search 路由不依赖锚点（按关键词行），影响仅限手工点击面。死路①：把沙箱限制写进 AGENTS.md 横幅——环境事实混入流程规则面，全局注入噪音大于收益，弃（知识库按需路由）。死路②：保留 `.tmp/hooks` 作双通道备份——非官方通道留存即诱导复用，与「统一官方链」目标相悖，弃。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 改 | .sillyspec/knowledge/known-issues.md | 尾部追加 🟡「agent 沙箱把 python.exe 子树 IL 降为 Low」条目（症状/根因/WSL bash 误解析坑/处置） |
| 改 | .sillyspec/knowledge/INDEX.md | known-issues 小节加路由行（沙箱/Low IL/msys/0xC0000022/pre-commit/WSL bash/PRE_COMMIT_HOME 关键词） |

（`.tmp/hooks/` 为 gitignored 运行时残留的物理删除，无 git 提交面——非交付条目，删除动作与零引用核验留痕于做法概述与 FR-01、交付提交消息。）
