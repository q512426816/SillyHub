---
author: flow-machine-draft
created_at: 2026-10-20T00:16:49.178Z
---
# 设计记录（Design Record）— 2026-10-20-conflict-platform-archive

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

核心洞察：冲突推送里被拒的 op 本身就是机器侧事实——add/update 的 base64 `content` 与 `mtime`、delete 的「机器侧已删」语义、rename 的 new_path 落点。因此不需要任何新通道：apply_ops 的七处被拒点（乐观锁冲突 / 删除前缀拦截 add+update 两处 / 墓碑行 add / 墓碑行 update / rename 目标删除前缀 / rename 目标墓碑 / rename 目标占用——见「接口契约」逐点）在既有 conflict 收集动作旁把被拒 op 追加进 `conflicted_ops` 列表，收尾交给 `_upsert_sync_conflict` 蒸馏成 `details_json.local_archive`（条目 `{path, missing, content, binary, truncated, mtime}`，三重帽）。对比端点 `SillySpecCompareService.compare` 在 spec-tree 分支捕获 `_fetch_snapshot` 抛出的 `conflict_record_missing` 网关错，查 open 行留档，命中则以留档为机器侧快照走既有 `_build_spec_tree_compare`（平台侧仍实时读 spec_root），`record_label="platform-archive"`。

选这个方案而不是「服务端 upsert 时经 daemon RPC 抓记录快照」的原因：机器侧 `spec-sync-conflict-*.json` 是 CLI 在**收到推送响应之后**才落盘的（CLI 侧 spec-sync.js 冲突处理时点），服务端在 apply_ops/upsert 时点抓取必竞态 miss；且 Workspace 表无 instance 绑定，服务端无从得知该向哪台机器发 RPC。也不是「平台行携带记录 label 驱动对比」：那只解决记录名口径（full-tree 兜底 2026-10-16 已解决记录**活着**时的读取），不解决记录**死亡**——本坑的残留断层正是「行开记录亡」。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

**`SpecWorkspaceService.apply_ops`（backend/app/modules/spec_workspace/service.py）**：内部新增 `conflicted_ops: list[FileOp]` 收集（七处被拒点，行号基于当前工作区）：

1. `:2357` add/update 命中平台删除目录前缀；
2. `:2384` add 命中墓碑行（platform_deleted）；
3. `:2412` update 命中墓碑行；
4. `:2428` base_version 乐观锁冲突（任意 op 类型——delete 亦在此被拒）；
5. `:2509` rename 目标命中删除前缀；
6. `:2524` rename 目标命中墓碑行；
7. `:2532` rename 目标被占用。

对外 HTTP 契约（sync-incremental 请求/响应）零变化。蒸馏规则（新增模块级纯函数，便于单测）：add/update/rename 条目 `path = op.new_path if rename else op.path`、`missing=false`、`content` = base64 解码后 utf8 可解码的文本（超 32000 字符截断置 `truncated=true`；不可解码 `binary=true, content=null`）、`mtime` = `op.mtime`（Unix 秒）转 ISO 串（daemon 快照 files[].mtime 同形态，对比响应 DTO local_mtime 为 str——留档条目与快照条目同构，回退路径零转换）；delete 条目 `missing=true, content=null`。总量帽：蒸馏时累计序列化字节，超 512KB 后后续条目 content 置 null（路径/missing/binary/mtime 保留）；条目数帽 300。

**`_upsert_sync_conflict`**：签名增可选参 `conflicted_ops: list[FileOp] | None = None`；details_json 新增键 `local_archive`（list[entry]；`conflicted_ops` 为空/None 时该键为空列表）。既有键与整体替换语义不变。调用点（apply_ops `:2756`）传入。

**`SillySpecCompareService`（backend/app/modules/daemon/sillyspec_compare.py）**：`compare()` spec-tree 分支把 `self._fetch_snapshot(...)` 包进 try——捕获 `DaemonRpcRemoteGatewayError` 且 `details.daemon_code == "conflict_record_missing"` 时调用新私有方法 `_load_archived_snapshot(workspace_id, change)`：查 `spec_conflicts` 该 workspace 的 open spec-sync 行（stage 常量取 `SpecWorkspaceService.SYNC_CONFLICT_STAGE`），details_json fail-soft 解析，取 `local_archive` 重建快照 dict `{files: [...], conflict_created_at: <row.created_at>, local_updated_at: None}`，经 `_scope_snapshot_to_change(snapshot, change, label="platform-archive")` 裁剪——命中返回、否则 None → 重抛原错误。`_scope_snapshot_to_change` 签名增 `label: str = FULL_TREE_RECORD_LABEL` 参数（既有调用零变化）。非 conflict_record_missing 错误原样上抛。

**HTTP 对比响应（daemon/router/machines.py）**：DTO 零变化——`record_label` 既有可选字段新增取值 `"platform-archive"`（str 无枚举约束，前端类型无需再生成）。

**daemon / CLI 协议**：零变化（不新增 RPC、不改推送负载）。

**前端（frontend/src/components/changes/conflict-compare-modal.tsx）**：`renderSpecTreeBody` 在 full-tree 横幅旁新增 `record_label === "platform-archive"` 分支横幅（`data-testid="compare-archive-source"`，同款固定说明行样式）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

local_archive 随每次冲突推送整体替换（与 details_json 既有语义一致）——迟到旧推送会以旧留档覆盖新留档，但这是 upsert 既有口径（`last_seen_at` 同步刷新、冲突面以最后到达为准），本变更不引入新假设；对比读到的是「最近一次冲突推送时点」的机器侧状态，横幅文案明示时点语义。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

两执行体同时推冲突 → 既有 upsert 幂等形态不变（select 后 update/insert，同一 session 事务），local_archive 只是 details_json 内容的一部分；对比读行与 upsert 写行并发 → 读到替换前/后任一完整 JSON 均为合法时点视图（Text 列单写原子，无半 JSON 态——写侧整体 `json.dumps` 一次落列）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

upsert 本就在 apply 主事务后的独立 try 内 best-effort（失败仅告警 `sync_conflict_registry_failed`）——蒸馏异常同被该 try 吞掉，推送响应不受影响；行被置 resolved 后留档随行退役（`_load_archived_snapshot` 只查 open 行，resolved 行不回退）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

留档按 workspace 行隔离（spec_conflicts 本就 workspace 级），compare 按 workspace_id 查行不串台；变更裁剪复用既有段边界判定（`changes/<change>/` 紧跟 `/`，foobar 不误吞 foo——2026-10-16 FR-02 同款）；蒸馏只消费当次请求内存中的 op 对象，不读任何跨请求状态。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：details_json 膨胀——三重帽兜底（32000 字符/文件、512KB 总量停存内容、300 条目），上限与一次冲突推送的请求体同量级（推送本身已携带这些 content），不放大既有存储压力。次风险：留档内容是**冲突时点**快照，机器侧后续演进不反映——横幅文案明示，且这恰是排障需要的时点证据。

试过但放弃的方案：①服务端 upsert 时经 daemon RPC 抓记录快照——时序必竞态（机器记录由 CLI 收到响应后落盘）+ Workspace 无 instance 绑定（无从寻址机器）；②平台行携带记录 label 驱动对比——只修名口径不修记录死亡，10-16 已用 full-tree 兜底覆盖记录活着场景；③机器离线/超时（504 家族）也回退留档——前端对比按钮对离线机器本就禁用，需求面（坑文）只覆盖记录缺失态，维持四臂文案现状，超范围不做。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/spec_workspace/service.py | 七处被拒点收集 conflicted_ops；_distill_local_archive 纯函数（三重帽）；_upsert_sync_conflict 增参与 local_archive 键 |
| 修改 | backend/app/modules/daemon/sillyspec_compare.py | compare() spec-tree 分支捕获 conflict_record_missing 回退 _load_archived_snapshot；_scope_snapshot_to_change 参数化 label |
| 新增 | backend/app/modules/spec_workspace/tests/test_conflict_local_archive.py | FR-01：七类被拒点条目形态 + 三重帽 + upsert 落库断言 |
| 修改 | backend/app/modules/daemon/tests/test_sillyspec_compare.py | FR-02/03：回退命中构造（200 + platform-archive + 裁剪）/ 不命中重抛 / 非 missing 不回退 |
| 修改 | frontend/src/components/changes/conflict-compare-modal.tsx | FR-04：platform-archive 来源横幅 |
| 修改 | frontend/src/components/changes/__tests__/conflict-compare-modal.test.tsx | FR-04：横幅呈现用例（含与 full-tree 横幅互斥） |
