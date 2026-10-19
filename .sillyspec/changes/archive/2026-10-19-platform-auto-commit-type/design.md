---
author: flow-machine-draft
created_at: 2026-10-19T03:07:50.552Z
---
# 设计记录（Design Record）— 2026-10-19-platform-auto-commit-type

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

类型落库此前依赖人工回填脚本 + 人工重扫描。本变更在平台侧闭环（不碰 sillyspec
CLI）：C 件——parser 新增 `_read_timeline_commit_type`，对含 timeline.md 的变更
（轻量出身归档时 CLI 烤制）从「任务面 task-NN 行尾哈希」×「🔀 行 标题开头
conventional 前缀」提取主类型作次级权威源（权威序：flow-state 显式 commit_type >
timeline > 目录推断，前两者均置 authoritative 允许覆盖库中旧值）。B 件——核对确认
spec-sync 自动 reparse 机制**已完整存在**（apply_ops 落盘后 `_trigger_change_reparse`
后台任务：归档 rename → 全量重扫、timeline/flow-state 的 add/update → scoped 重扫、
120s 节流 + 尾随补发 + single-flight，各场景均有既有测试钉），零新代码。

关键设计：任务面哈希锚定排除并行变更提交噪音（ watcher 观测窗内混入的他变更/他仓
提交不参与判定）；标题 56 字符截断只伤尾部（变更 key 丢）不伤开头类型前缀；
`sillyspec:` 基线检查点等白名单外伪前缀不认。全量真数据对照：135 个含 timeline
归档，timeline 口径 vs git 全历史口径一致 98（73%）——分歧为口径哲学差异（git 按
「最后带 key 提交」归属会被后补 fix 提交带偏；timeline 锚定执行窗交付提交更贴变更
本体，抽样核验语义不劣），flow-state 优先级保证已回填行不被覆盖，无打架面。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `ChangeParser._read_timeline_commit_type(change_dir) -> str | None`：类方法，
  白名单内主类型（优先级 feat/fix > perf/refactor/test > docs/style > build/ci/
  chore/revert）；缺文件/无锚/无命中 → None（fail-open 回落推断）。
- `ParsedChange.change_type_authoritative` 语义扩展：flow-state 与 timeline 两源
  均可置位（消费方 `_apply_parsed` 不变）。
- 对外 API/端点/表结构零变化；B 件为既有机制核对（`_compute_reparse_scope` /
  `_trigger_change_reparse`），无签名改动。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：类型是终态事实；timeline.md 归档后不再变，迟到同步只表现为
   一次权威覆盖；解析 fail-open（缺段/畸形行跳过）。
2. 并发写：parser 只读 timeline.md；写入方仅 CLI 归档收口（串行点）——与本变更
   无新写入面。reparse 后台任务已有 single-flight 防重入（既有机制）。
3. 切换/生命周期：timeline 缺失（完整流程变更/旧变更）→ None 回落，行为同旧；
   flow-state 有显式字段的行永不被 timeline 覆盖（已回填 739 个变更的值稳定）。
4. 作用域：逐 change_dir 读取，无跨工作区共享态；哈希锚定天然限定本变更提交。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：timeline 口径与 git 口径分歧（27%）造成「同类变更不同来源类型不同」的
观感。缓解：生产链路上每变更只有一种来源生效（有回填 → flow-state 优先；无回填 →
timeline），不存在同一行两口径交替覆盖；分歧样本语义核验 timeline 不劣（git 口径
会被后补提交带偏）。watcher 盲窗导致锚缺失 → None 回落不猜。

试过放弃：A. 排除工件性 scope（docs(spec)/chore(archive)）提升一致率——实验发现
分歧主因是口径哲学非工件噪音，且 git 对照口径本身含噪，不值得为对齐一个含噪基准
加规则；B. daemon 控制命令通道（平台下发 git 提取命令）——覆盖面更全但异步回传 +
离线重试复杂度高一个量级，留作中期备选；C. 等 sillyspec CLI flow done 写类型——
用户明确不改 CLI，平台侧自闭环。
