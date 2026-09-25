---
author: flow-machine-draft
created_at: 2026-09-25T16:20:13.220Z
---
# 设计记录（Design Record）— 2026-09-26-spec-sync-receipt-visibility

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-spec-sync-receipt-visibility 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
三件事同源落盘：①apply_ops 两个墓碑拦截分支 + 版本冲突分支各计数（applied=总数-跳过），
返回 dict 与双轨响应模型（daemon SpecIncrementalSyncResponse / CLI SpecSyncResponse）新增
applied_ops/skipped_conflict/skipped_tombstone/platform_deleted 四键；全量通道 _write_spec_root
两跳过分支计数（返回 tuple 扩 2 元），apply_sync 回执增 landed_files/skipped_files，
skipped>0 服务端显式 warn。②apply_ops 冲突 → _upsert_sync_conflict 幂等写 spec_conflicts
开放行（stage=spec-sync，details_json 带 server_versions/platform_deleted/conflicting_paths/
last_seen_at，同工作区同 stage 只更新不重复建）；全绿 → _close_open_sync_conflicts 自动置
resolved（闭环不留僵尸）。③前端 lib.listSpecConflicts + SpecSyncConflictBanner（工作区布局
顶部细条警示，react-query 60s 轮询，失败静默）。选此方案：三面全是纯增量（响应字段带默认值、
注册表用既有 SpecConflict 表与 GET/resolve 端点、横幅独立组件零侵入），不改任何既有字段语义。


## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-spec-sync-receipt-visibility 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
改动：spec_workspace/{service,schema,router}.py（计数+注册表 helper×2+回执透传）、
platform_sync/{schema,router}.py（CLI 轨道回执计数）、_write_spec_root 返回 tuple 3→5 元
（apply_sync/import SSE 两调用点同步）、测试×3 文件（形状断言补新键 + 新用例：冲突注册表
开/幂等/闭环）、frontend：lib/spec-workspaces.ts（listSpecConflicts）、
components/spec-sync-conflict-banner.tsx + 测试、workspaces/[id]/layout.tsx 挂载、
api-types.ts/openapi.json 重生成。对外可见：三个同步端点响应**新增字段**（全带默认值零破坏）；
spec_conflicts 表开始有 spec-sync 开放行（既有 GET /spec-conflicts 与 resolve 端点直接可消费）；
工作区页面顶部新增冲突横幅。


## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-spec-sync-receipt-visibility 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序：计数是单请求内循环累加、注册表 upsert 按开放行单键幂等，与到达顺序无关。
2. 并发写：注册表 helper 各自 commit 短事务；两并发冲突同步 → 后写覆盖 details（last_seen_at
单调），不重复建行（SELECT 开放行 + 唯一工作区粒度语义靠先查后插，竞态最坏多建一行，resolve
全绿时会全部关闭，无僵尸累积面）。
3. 切换：响应新字段带默认值，旧 daemon/CLI 读新回执零破坏；新前端读旧后端——横幅查询走既有
GET /spec-conflicts（旧后端恒空 → 横幅不渲染，安全退化）。
4. 作用域：注册表行按 workspace_id 过滤；计数只进响应不落库；details_json 不含跨工作区数据。


## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-spec-sync-receipt-visibility 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：注册表先查后插的竞态在并发冲突同步下可能多建开放行——最坏影响是横幅多计一条，
且下一次全绿同步全量关闭，无永久僵尸面；接受（加唯一约束属过度工程）。
次生：applied_ops 把「同内容豁免 no-op」与「delete 无行 no-op」计入 applied——口径=「成功处理
非跳过」，文档化即可；若消费方要严格落盘数可后续细分。
放弃的方案：①冲突行按 path 粒度多行——横幅/查询面噪音大且 resolve 语义复杂，单行聚合+details
清单更贴近「一次人工拍板动作」；②把计数写日志不发回执——daemon/CLI 无法程序消费，绿灯谎言
依旧；③横幅用 SSE 推送——冲突是长滞留态，60s 轮询足够且零新基础设施。

## 文件变更清单

- backend/app/modules/spec_workspace/service.py
- backend/app/modules/spec_workspace/schema.py
- backend/app/modules/spec_workspace/router.py
- backend/app/modules/platform_sync/schema.py
- backend/app/modules/platform_sync/router.py
- backend/app/modules/spec_workspace/tests/test_platform_deleted_guard.py
- backend/app/modules/spec_workspace/tests/test_sync_incremental.py
- backend/app/modules/spec_workspace/tests/test_bundle_sync.py
- backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py
- backend/openapi.json
- frontend/src/lib/api-types.ts
- frontend/src/lib/spec-workspaces.ts
- frontend/src/components/spec-sync-conflict-banner.tsx
- frontend/src/components/__tests__/spec-sync-conflict-banner.test.tsx
- frontend/src/app/(dashboard)/workspaces/[id]/layout.tsx
