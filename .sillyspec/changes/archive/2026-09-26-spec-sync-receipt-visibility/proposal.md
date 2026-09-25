---
author: flow-machine-draft
created_at: 2026-09-25T16:20:13.219Z
---
# 提案书（Proposal）— 2026-09-26-spec-sync-receipt-visibility

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:3628b97b0f86f562e3e4fd67138208f19d795c4d854366b7e2d83031ec0d5246:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-spec-sync-receipt-visibility 留痕重锚 -->
任务原话转写：动机：spec 同步链的「绿灯谎言」两处（2026-09-25 生产实证）：①全量推送回 {"ok":true} 却丢 2106 个成员零告警（回执无 landed/skipped 计数）；②增量冲突（base_version 乐观锁 / platform_deleted 墓碑拒收）只活在 daemon 日志一行 warn——平台 spec-conflicts 注册表恒空、无任何横幅，c84182bc 冲突挂了一周无人知晓，镜像与遥测全冻结。

成功标准：
- 全量同步回执（SpecSyncResponse）增 landed_files / skipped_files 计数；skipped>0 时服务端显式 warn 日志（跳过原因计入：墓碑前缀排除 + staging 成员缺失）
- 增量同步回执（SpecIncrementalSyncResponse）增 applied_ops / skipped_conflict / skipped_tombstone 计数与 platform_deleted 列表（daemon 轨道此前不透传该字段——CLI 轨道有但 daemon 看不到）
- 增量冲突发生时写 SpecConflict 注册表行（stage=spec-sync，details_json 带 server_versions/platform_deleted/冲突路径；同工作区同 stage 开放行幂等更新不重复建行），随后一次全绿同步自动把开放冲突行置 resolved（闭环不留僵尸）
- 前端工作区布局挂 spec 同步冲突横幅：有开放 spec-sync 冲突时显示细条警示（数量 + 「镜像可能滞后」提示），无冲突不渲染
- gen:types 契约同步（api-types.ts + openapi.json 随提交）
- 后端单测：墓碑前缀跳过计数 / 冲突建行 + 成功闭环 / 计数字段在两回执中；前端横幅渲染/隐藏用例
- 既有 spec_workspace 测试与前端布局相关测试零回归
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:02714a96b53e4d5edf83c96e161740ae0f7a0c6700a28b930bf0bec4ef101c2c:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-spec-sync-receipt-visibility 留痕重锚 -->
按成功标准机械推导，共 12 条验收面：
1. 全量同步回执（SpecSyncResponse）增 landed_files
2. skipped_files 计数
3. skipped>0 时服务端显式 warn 日志（跳过原因计入：墓碑前缀排除 + staging 成员缺失）
4. 增量同步回执（SpecIncrementalSyncResponse）增 applied_ops / skipped_conflict / skipped_tombstone 计数与 platform_deleted 列表（daemon 轨道此前不透传该字段——CLI 轨道有但 daemon 看不到）
5. 增量冲突发生时写 SpecConflict 注册表行（stage=spec-sync，details_json 带 server_versions/platform_deleted/冲突路径
6. 同工作区同 stage 开放行幂等更新不重复建行），随后一次全绿同步自动把开放冲突行置 resolved（闭环不留僵尸）
7. 前端工作区布局挂 spec 同步冲突横幅：有开放 spec-sync 冲突时显示细条警示（数量 + 「镜像可能滞后」提示），无冲突不渲染
8. gen:types 契约同步（api-types.ts + openapi.json 随提交）
9. 后端单测：墓碑前缀跳过计数 / 冲突建行 + 成功闭环 / 计数字段在两回执中
10. 前端横幅渲染
11. 隐藏用例
12. 既有 spec_workspace 测试与前端布局相关测试零回归
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:eb4ee766f71053d309db1672549df2557a54ec530752507c0036339a2db463e8:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-spec-sync-receipt-visibility 留痕重锚 -->
1. 全量同步回执（SpecSyncResponse）增 landed_files
2. skipped_files 计数
3. skipped>0 时服务端显式 warn 日志（跳过原因计入：墓碑前缀排除 + staging 成员缺失）
4. 增量同步回执（SpecIncrementalSyncResponse）增 applied_ops / skipped_conflict / skipped_tombstone 计数与 platform_deleted 列表（daemon 轨道此前不透传该字段——CLI 轨道有但 daemon 看不到）
5. 增量冲突发生时写 SpecConflict 注册表行（stage=spec-sync，details_json 带 server_versions/platform_deleted/冲突路径
6. 同工作区同 stage 开放行幂等更新不重复建行），随后一次全绿同步自动把开放冲突行置 resolved（闭环不留僵尸）
7. 前端工作区布局挂 spec 同步冲突横幅：有开放 spec-sync 冲突时显示细条警示（数量 + 「镜像可能滞后」提示），无冲突不渲染
8. gen:types 契约同步（api-types.ts + openapi.json 随提交）
9. 后端单测：墓碑前缀跳过计数 / 冲突建行 + 成功闭环 / 计数字段在两回执中
10. 前端横幅渲染
11. 隐藏用例
12. 既有 spec_workspace 测试与前端布局相关测试零回归
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
