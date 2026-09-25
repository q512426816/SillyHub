---
author: flow-machine-draft
created_at: 2026-09-25T05:03:12.144Z
---
# 提案书（Proposal）— 2026-09-25-tombstone-heal-archive

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:a9552878d42bf717b03127bcfd1e93a78d0ad98f4677a371774c24a9fa24514f:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-tombstone-heal-archive 留痕重锚 -->
任务原话转写：收编上个会话遗留的 archive-tombstone 冤案复活半成品（platform_sync/service.py 未提交 WIP + test_change_deleted_guard.py 新 3 用例，代码与测试均已就绪实测 16 passed）：旧 CLI 墓碑 bug 曾把归档链误标 location='deleted'（面板已归档 tab 隐身）；新 CLI（e4667729 终态透传后）重推 'archived' 载荷时应把冤案行翻回 location='archive' 恢复可见，且 'archived' 墓碑不触发镜像软删（归档可回溯，区别于 deleted 链）。
成功标准：
- upsert_progress 已删拒收分支加复活通道：body changes[] 同名条目 status=='archived' 且行 location=='deleted' 时翻回 archive 走正常接受，否则维持原拒收（真删除链零回归）
- _apply_cli_tombstone 的 archived 分支语义化 no-op（行为与原早退等价，钉住不软删镜像/不动 location 的不变量注释）
- test_change_deleted_guard.py 三新用例（恢复/不软删/幂等）+ 既有 13 用例全绿（16 passed 实测）
- 尊重 D-002@v1 与 P1 ingest 不变量：不新增 location 写路径竞争（复活通道是唯一新增写点且仅 deleted→archive 单向）
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:a8e92912cec3777f337ae00d3f37d7c509780d453c2f8532787a779634931579:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-tombstone-heal-archive 留痕重锚 -->
按成功标准机械推导，共 4 条验收面：
1. upsert_progress 已删拒收分支加复活通道：body changes[] 同名条目 status=='archived' 且行 location=='deleted' 时翻回 archive 走正常接受，否则维持原拒收（真删除链零回归）
2. _apply_cli_tombstone 的 archived 分支语义化 no-op（行为与原早退等价，钉住不软删镜像/不动 location 的不变量注释）
3. test_change_deleted_guard.py 三新用例（恢复/不软删/幂等）+ 既有 13 用例全绿（16 passed 实测）
4. 尊重 D-002@v1 与 P1 ingest 不变量：不新增 location 写路径竞争（复活通道是唯一新增写点且仅 deleted→archive 单向）
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:abc25edf7d9c84c4e4334bd35bcb90a78870016bf876be27f3184ff1b8f8e197:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-tombstone-heal-archive 留痕重锚 -->
1. upsert_progress 已删拒收分支加复活通道：body changes[] 同名条目 status=='archived' 且行 location=='deleted' 时翻回 archive 走正常接受，否则维持原拒收（真删除链零回归）
2. _apply_cli_tombstone 的 archived 分支语义化 no-op（行为与原早退等价，钉住不软删镜像/不动 location 的不变量注释）
3. test_change_deleted_guard.py 三新用例（恢复/不软删/幂等）+ 既有 13 用例全绿（16 passed 实测）
4. 尊重 D-002@v1 与 P1 ingest 不变量：不新增 location 写路径竞争（复活通道是唯一新增写点且仅 deleted→archive 单向）
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
