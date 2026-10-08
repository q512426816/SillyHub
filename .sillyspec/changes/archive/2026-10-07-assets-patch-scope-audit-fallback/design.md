---
author: flow-machine-draft
created_at: 2026-10-07T14:58:35.066Z
---
# 设计记录（Design Record）— 2026-10-07-assets-patch-scope-audit-fallback

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

沉淀资产「归档留档」块数据源 `_read_patch_meta` 只认 change-patch.json，厚流程
execute --done 只落 scope-audit.json/patch，厚变更该块整块不渲染（缺陷记录
docs/sillyspec/thin-flow-done-no-scope-audit-snapshot.md 镜像缺口一节）。本变更是
三层修法第 1 层（平台读侧回退）：`_read_patch_meta` 缺件回退读 scope-audit.json
（totals/patchStatus/savedAt 同构直取，file_list 改从 rows[].path 投影）；
`_read_patch_file_diff` 缺 change.patch 时改读 scope-audit.patch 再切片（切片函数
复用不动）。选读侧而非改 CLI 写侧：本仓库独立可落地，存量厚归档立即出数；写侧
统一归 sillyspec 工具仓另修。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `_read_patch_meta(change_dir) -> ChangePatchMeta | None`：签名不变，新增回退取数
  路径（change-patch.json 优先，两份都缺/损坏 → None 语义不变）。
- `_read_patch_file_diff(change_dir, rel_path) -> ChangePatchFileRead`：签名不变；
  留档按 change.patch → scope-audit.patch 顺序取第一份存在者，未命中 note 指名实际
  留档文件名，两份都缺 note 同时列两名。
- HTTP 端点 GET /changes/{cid}/assets 与 /assets/patch-file 请求/响应 schema 零变化
  （字段未动，仅 docstring 更新）；前端无改动，无 api-types 重生成面。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

不适用——纯归档目录静态文件读取，无事件序；归档件 append-only，读到新旧文件均为
合法冻结态。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

CLI 写归档件与平台读并发的窗口内，半写 JSON 解析失败 → `_read_json_dict` 返回
None → 回退另一份或整体 None（fail-open），不抛 500；与既有 change-patch.json
读取行为同款。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全——无状态服务函数，请求间无共享态；变更在途（未归档）本就不读目录件（既有
design R-03 分支），不受本改动影响。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会——change_dir 由 change.path 按工作区解析（既有 `_resolve_change_dir`），
归档目录 per-change 隔离；scope-audit.json rows 只含本变更对账行，file_list 天然
限本变更。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：file_list 语义按通道不同——change-patch.json 的 files 数组含 .sillyspec/
规格工件，scope-audit.json 的 rows 只含对账表行。展示口径随之不同（各自的真实冻结
面），可接受；未来若要求统一需 CLI 侧统一留痕（第 3 层根治）。试过但放弃：在
assets 层实时重算 git diff 补数——引入实时窗口漂移，违背「归档留档冻结在收尾时点」
的既有语义。
