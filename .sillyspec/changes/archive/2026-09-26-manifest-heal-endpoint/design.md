---
author: flow-machine-draft
created_at: 2026-09-25T23:10:15.907Z
---
# 设计记录（Design Record）— 2026-09-26-manifest-heal-endpoint

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-manifest-heal-endpoint 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
新增一个人工拍板恢复端点：SpecWorkspaceService.heal_manifest_tombstones(workspace_id, paths)
把显式 paths 的 manifest 行 platform_deleted→False、exists→True（version 不动——下一轮常规同步
按现行版本自然重定基线），随后复用 _close_open_sync_conflicts 关闭开放 spec-sync 冲突行（heal
即人工宣告已解决）。非墓碑行跳过计入 skipped（幂等重放安全）。选此方案：墓碑拒收是「平台删除」
语义的正当守卫，缺的只是冤案的人工恢复通道——单文件粒度显式清单即拍板单位（不做前缀批量，
防误清整目录墓碑），复用既有冲突闭环不新建状态机。


## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-manifest-heal-endpoint 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
改动：spec_workspace/service.py（heal_manifest_tombstones + _close_open_sync_conflicts 复用）、
schema.py（ManifestHealIn/Out）、router.py（POST /spec-workspace/manifest-heal，
WORKSPACE_WRITE，注册在字面量区不受通配影响——本模块无同级通配）、
test_platform_deleted_guard.py（TestManifestHeal 两用例）。
对外可见：新端点 POST /workspaces/{id}/spec-workspace/manifest-heal；无既有端点/字段变化。


## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-manifest-heal-endpoint 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序：heal 是一次性显式清单操作，无事件序依赖。2. 并发写：单事务 commit；与并发同步撞
version 不动所以无乐观锁冲突面；行级 heal 与同步重推竞态最坏是同步先重推（此时 heal 变 skipped
幂等）。3. 切换：heal 后未及同步即中断——墓碑已清，下一轮常规同步自然收敛，无半态。4. 作用域：
行按 workspace_id 过滤；清单外路径 422 拒收不跨区。


## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-manifest-heal-endpoint 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：误清真墓碑（该变更确实被平台删除、heal 后下一轮同步复活已删内容）。缓解：单文件
显式清单=人工逐条拍板（与 resolve --keep-local 同判级）+ WORKSPACE_WRITE 权限 + 审计日志 +
删除动作本身可重放（change-center 再删即重立墓碑）。放弃方案：①前缀批量 heal——一次误操作清
整目录墓碑，拒绝；②heal 时同步重推文件内容——越权（内容归同步通道，heal 只清行状态）；
③自动检测冤案（archived 载荷匹配）——fed6e9e9a 在 progress 通道已有先例，但 spec manifest
误标形态未普查，自动化误判面大，留后续。

## 文件变更清单

- backend/app/modules/spec_workspace/service.py
- backend/app/modules/spec_workspace/schema.py
- backend/app/modules/spec_workspace/router.py
- backend/app/modules/spec_workspace/tests/test_platform_deleted_guard.py
