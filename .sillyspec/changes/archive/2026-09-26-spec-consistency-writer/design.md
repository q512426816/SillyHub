---
author: flow-machine-draft
created_at: 2026-09-26T00:02:17.793Z
---
# 设计记录（Design Record）— 2026-09-26-spec-consistency-writer

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-spec-consistency-writer 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
两件事同批（同属「spec 快照一致性可见化」）：①consistency() 内存对账——rglob 磁盘树（排
.runtime/local.yaml，线程池）× SpecFileManifest 行，输出 disk_only（磁盘有清单无）/manifest_ghost
（行 exists=True 磁盘缺——正是 resurrect 修的幽灵形态）/tombstoned_on_disk（墓碑但文件在）三类
+ counts；新端点 GET /spec-workspace/consistency。②写方记录——SpecWorkspace 增 last_writer/
last_writer_at 两列（alembic 20260926083000），apply_sync/apply_ops 尾部 _note_writer（独立短事务
幂等；写方切换 structlog warning——daemon 与 CLI 双写是 manifest 漂移根因），身份从路由 _user 派生
摘要 user:<id8>:<email24>，Read DTO 透传。


## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-spec-consistency-writer 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
改动：spec_workspace/{model,schema,service,router}.py、migrations/versions/
20260926083000_spec_workspace_last_writer.py、测试 test_full_sync_convergence.py 增 TestConsistencyAndWriter
（四分歧用例 + 写方记录/切换用例）、api-types.ts/openapi.json 重生成（含 change-events 旧债顺手
修——gen:types 暴露观测事件会话已提交测试与已提交后端契约不一致，按 CLAUDE.md 规则 21 顺手对齐，
其 v3 会话继续演进时以后端为准）。对外可见：新端点 + Read DTO 两字段 + DB 迁移（部署时 alembic 自动跑）。


## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-spec-consistency-writer 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序：对账是请求内一次快照（磁盘 walk 与行 SELECT 之间有毫秒级窗口，并发同步中读到的
是中间态——对账是诊断面非账面，容忍）。2. 并发写：_note_writer 独立 commit；两写方并发最后落
last_writer 后写者（漂移 warning 已各自发出）。3. 切换：迁移幂等（add_column）；对账无状态。4. 作用域：
对账按 workspace_id；写方摘要不含敏感全量（email 截 24 字符）。


## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-spec-consistency-writer 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：对账的磁盘 walk 在万级文件树上秒级（rglob 同步 IO 已移线程池，对齐既有范式）——
低频诊断端点可接受。次生：写方摘要 user:<id>:<email> 无法区分「daemon 服务身份」与「人」——当前
鉴权解析后都是 User；daemon 轨道身份细分（runtime_id）留待 auth 层提供 principal 类型后增强。放弃：
①对账进周期任务+告警——先给手动端点验证口径，自动化等消费面确认；②三向含「本地树」（daemon 侧）
——平台看不到本地树，属 daemon 侧职责，分界清晰。

## 文件变更清单

- backend/app/modules/spec_workspace/model.py
- backend/app/modules/spec_workspace/schema.py
- backend/app/modules/spec_workspace/service.py
- backend/app/modules/spec_workspace/router.py
- backend/migrations/versions/20260926083000_spec_workspace_last_writer.py
- backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py
- backend/openapi.json
- frontend/src/lib/api-types.ts
- frontend/src/components/changes/detail/__tests__/change-events-card.test.tsx
