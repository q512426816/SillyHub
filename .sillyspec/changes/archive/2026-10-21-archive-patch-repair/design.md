---
author: flow-machine-draft
created_at: 2026-10-21T04:01:29.176Z
---
# 设计记录（Design Record）— 2026-10-21-archive-patch-repair

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：只动两个归档工件文件（`.sillyspec/changes/archive/2026-10-21-files-refresh-spinner/` 下的 change.patch 与 change-patch.json）：前者以 `git diff c71b875a1..e88ffddb7 -- <两源码文件>` 原样输出重写，后者修准 files/totals/scopeAudit.rows 并新增 `repair` 注记字段（保留原错误锚 `7f14be0a…`、修复时间、依据、方法、修复变更名），重算 patchSha256。选这个方案因为评估已实锤：锚是 patch 文件字节哈希（平凡可重算）、权威内容源唯一且经独立评审验证、平台侧元数据与正文均为请求时读盘（`assets.py get_change_assets` 每请求 `to_thread` 读 change_dir）故盘准即卡面准、归档提交未推送无需公共历史改写。不做静默改写——repair 注记使错误被记录且修正可追溯。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：无代码/端点/签名变化。改的是两个归档数据文件的**内容**：change.patch（格式不变，仍为标准 git diff 文本，切片解析器 `slice_patch_for_file` 与前端 patch 树均按原格式消费）；change-patch.json（schema 不变、键集不变、仅数值面修准 + 新增 `repair` 对象字段——后端投影取已知键、未知键 fail-open 忽略，不影响解析）。平台 `/changes/{id}/assets/patch-file` 端点行为不变，返回内容因冻结件修准而恢复正确。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

答：成立。修复对象是已注销归档变更的静态文件，无事件流；唯一外部交互是 platform sync（本地→服务器单向推），修好盘面后 sync 一次到位，不存在迟到写入覆盖修复面——修复提交先于 sync 执行，顺序钉死。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

答：风险点与缓解：① 归档目录属已注销变更，无活跃会话声明写入（flow-state 已迁 archive 注销），并行撞写概率极低；② 本仓共享暂存区竞态有规则 11 防护——本变更 add 与 commit 同一显式 pathspec 清单，且提交前 `git diff --cached --name-only` 全量核对，防上次事故形态（他侧裸 commit 扫走我侧暂存）重演：本次核对暂存面后立即提交，发现暂存面被他人先行提交则核内容完整性再补提交说明。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

答：安全。两文件修准在一个原子操作序列内完成（patch 写入 → JSON 更新 → sha 重算校验），校验不通过即停手不提交；中途中断留下的半态（patch 新/JSON 旧）会在校验步暴露且不进 git，恢复重跑即可。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

答：不会。改动面锁定单仓单归档目录（`.sillyspec/changes/archive/2026-10-21-files-refresh-spinner/`），platform sync 按变更名定向推送该变更镜像，不触其他工作区/仓；repair 注记字段记明修复归属变更名，跨变更引用可溯源。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：最大风险是手工修准与 CLI 未来版本的 schema 演进漂移——缓解：键集不变只修值、repair 为纯新增字段（后端投影对未知键 fail-open，schema.py 侧 assets 读取面已核），且 verdict 枚举已从后端权威源查证（`planned/unplanned/untouched`，schema.py:745），无需凭空造值。放弃方案：① 接受现状不动——平台卡面持续误导 + 未来 FR 归属按错误清单污染，且 review.json 的 git-diff 权威面在历史压扁后成孤儿引用，评估已否；② 只追加 repair-note 文件不动冻结件本体——半吊子修复，卡面照旧错，不解决用户可见面；③ CLI 官方通道重建——`flow` 子命令无重建能力（已归档注销）、`--reopen` 属厚流程阶段机、知识库无先例，通道不存在。仓内已有 `patch-reanchor` 命令（归档后锚点修复）先例，佐证归档后修复在该流程文化下是被认可的形态（本变更为其内容面扩展，手工执行）。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | .sillyspec/changes/archive/2026-10-21-files-refresh-spinner/change.patch | 重写为两源码文件 git diff（逐字节） |
| 修改 | .sillyspec/changes/archive/2026-10-21-files-refresh-spinner/change-patch.json | files/totals/scopeAudit.rows 修准 + repair 注记（保留原错误锚）+ 重算 patchSha256 |
