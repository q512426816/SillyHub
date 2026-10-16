---
author: flow-machine-draft
created_at: 2026-10-16T02:43:26.709Z
---
# 设计记录（Design Record）— 2026-10-16-knowledge-module-card

## 做法概述

两步：①在 `_module-map.yaml` 追加 `sillyspec` 模块条目（paths=`.sillyspec/knowledge/**`，字段与既有条目同构），并按 incident.md 范式新建 `modules/sillyspec.md` 文档卡——登记后 fr-index 蒸馏的路径投票命中真域，新变更不再落伪域；②用 CLI 官方命令 `sillyspec tests --redomain --from fr/auto-sillyspec --to sillyspec` 先干跑核对、再 `--write` 迁移存量 3 条 FR——工具自身保证迁域不换号（D-001 铁律），INDEX 联动由命令一并处理。选官方命令而非手搬：条目 ID/绑定链/supersede 寻址容不得手工差错，且伪域文件清理逻辑（清空 or 移除）以工具行为为准。

## 接口契约

无代码接口变化。文件面契约：模块图 schema_version 2 追加一个 modules.sillyspec 条目；`knowledge/fr/sillyspec.md` 由 redomain 命令新建（条目结构 = 既有 fr 文件同款：## FR-<ID> + 变更/状态/摘要/全文/最近确认五要素）；`fr/auto-sillyspec.md` 由命令清空 active 条目。FR 注入面行为变化：后续轻量/完整变更的知识注入将命中 sillyspec 真域而非 auto-sillyspec 伪域。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   不适用：静态登记 + 一次性迁移，无事件流；迁移对象是已定案的 3 条 FR 索引条目（最近确认 hash 已锚定 08aa9fa6）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   模块图手改与另一会话 redomain 撞同一批文件会在 git 工作区冲突，按仓库惯例显式 pathspec 提交解决；本变更单会话完成，无实际并发面。redomain 自身对 fr 文件的读写为命令内单趟完成。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   安全：干跑不落盘；--write 半途中断最多留下迁移一半的 fr 文件（git 未提交态），重跑同命令幂等续接（条目已迁则跳过）；模块图与文档卡是纯追加，无中间态。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   不适用：模块图与模块文档是本仓 SillyHub 项目 docs 域文件；knowledge/fr 树是本工作区知识资产。登记只影响 fr-index 蒸馏路由（路径投票），不改变任何平台侧数据，无跨工作区效应。

## 风险与死路

最大风险：`_module-map.yaml` 头部标注 generator: sillyspec-scan——后续重跑 scan 若全量重生成可能冲掉手改条目；缓解：文件头同时注明「可手动修改」，scan 为 advisory 流程（人工确认后才落盘），且本条目 paths 是 scan 无法推导的规范资产域（scan 只扫代码路径），冲突概率低。死路：手工把 3 条 FR 剪切粘贴到新文件并自行重编号——已放弃，违反迁域不换号铁律（ID 是绑定/supersede 链寻址键），且伪域文件清理状态（清空 vs 移除）手搬无法与 CLI 的 fr-index 幂等提炼状态机对齐。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | .sillyspec/docs/SillyHub/modules/_module-map.yaml | modules 下追加 sillyspec 模块卡 |
| 新增 | .sillyspec/docs/SillyHub/modules/sillyspec.md | 模块文档卡（定位/文件契约/路由逻辑） |
| 新增 | .sillyspec/knowledge/fr/sillyspec.md | redomain --write 产物（3 条 FR 原 ID 迁入） |
| 修改 | .sillyspec/knowledge/fr/auto-sillyspec.md | redomain 清空伪域 active 条目 |
| 修改 | .sillyspec/knowledge/INDEX.md | redomain 联动索引（如命令触及） |
