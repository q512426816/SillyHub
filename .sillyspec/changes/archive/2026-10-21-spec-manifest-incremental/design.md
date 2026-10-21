---
author: flow-machine-draft
created_at: 2026-10-21T12:57:03.654Z
---
# 设计记录（Design Record）— 2026-10-21-spec-manifest-incremental

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

慢的根因：CLI 每条命令全量拉 spec-manifest（实测 13,145 行 / 2.2MB / 5.5s @ ~400KB/s 链路），吃掉 sillyspec 同步 8s 总预算。治本 = 让清单请求在稳态只传变化行：给 `spec_file_manifest` 加 `landing_version` 印记列（行最后写入时的工作区 `spec_version`），`GET /api/changes/-/spec-manifest` 支持 `?since=<spec_version>` 只回 `landing_version > since` 的行，响应带当前 `spec_version` 供客户端作下次游标。

配套一致性改动：① 四个清单写点（`apply_ops` / `_write_spec_root` 后逐行对齐 / `soft_delete_change_dir` / `heal_manifest_tombstones`——第四写点为评审 P2-1 捕获后补齐）在同事务内统一盖章；② rename 旧行从硬删改软删墓碑——增量协议成立的前提是「清单行只墓碑不消失」，否则旧行消失对增量消费方是不可见盲区。选工作区 `spec_version` 作游标基轴而非行级 `version`：行级 version 是每行独立 +1 的谱系计数（样本行 v20），不同行之间不可比；`spec_version` 单调递增且既有不变量「manifest 行版本变化 ⇒ spec_version 递增」（service.py:187 注释）恰好保证印章可比性。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `GET /api/changes/-/spec-manifest`：新增可选查询参数 `since: int（≥0）`；响应 `SpecManifestResponse` 新增顶层字段 `spec_version: int`（全量/增量均带）。带 since 时 `files` 只含 `landing_version > since` 的行；无 since 时全量（现状行为 + spec_version）。行项 `{hash, version, exists}` 形状不变；`landing_version` 不外露。
- `SpecWorkspaceService.get_manifest(workspace_id, since=None)`：返回值扩为含 `spec_version`；增量走 `(workspace_id, landing_version)` 索引过滤。
- `SpecWorkspaceService.apply_ops`：rename 分支旧行软删（不再 `session.delete`），受影响行盖章 `landing_version`；`pending_deletes` 机制移除。
- `_write_spec_root` 清单对齐块 / `soft_delete_change_dir`：受影响行盖章。
- DB：alembic 迁移 `20261021130000`（down_revision=20261021120000）——加列 `landing_version INTEGER NULL` + 索引 `ix_spec_manifest_ws_landing (workspace_id, landing_version)`，downgrade 对称；存量行不回填（NULL=只经全量出场，语义自洽）。
- 端点鉴权、HTTP 状态码语义、其它端点：无变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立。游标消费只有一条假设：行的印章值 ≤ 客户端已见 spec_version 的行不再变。落地是单调 `spec_version+1` 且印章=新值，同一行不可能被「旧版本号」重写（重写必产生更高印章）；迟到/重复的 op（daemon 重放）走既有 ON CONFLICT 幂等与 sha-equal 豁免，豁免路径不改行不盖章、bump 仍发生——客户端多拉一次空增量，无正确性影响。迟到增量响应（网络层）由 CLI 侧以响应 `spec_version` 单调性吸收（回退全量），不在本仓范围。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   两个 apply_ops 并发：既有唯一约束 + ON CONFLICT 幂等 + IntegrityError 重试语义不变；两事务各自取 `spec_version+1`，后提交者在行级锁上串行化，最终 `spec_version` 与行印章同事务一致（客户端不会看到「spec_version=N+1 而行印章仍 ≤N」——读已提交下两者同 commit 可见）。GET 与 apply 并发：GET 只见已提交状态，要么旧基线要么新基线，增量语义下两者都自洽（旧基线→下次重拉，新基线→含全部变化行）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全。盖章与 bump 同事务：事务中断全部回滚（无半盖章状态）；落地成功但客户端超时未收响应（HUB-09 场景）→ 客户端下次带旧 since 重拉，多得一轮增量，幂等。迁移中途失败：纯 DDL 加列/索引，alembic 事务性 DDL 回滚对称。workspace 级联删除（FK CASCADE）连带清单行消失属预期——客户端在该 workspace 的游标随 404/重建走全量重来。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不会。`landing_version` 是行级列，查询恒带 `workspace_id` 过滤（与现状同构）；`spec_version` 属单 workspace 行，游标不可跨工作区携带（token 派生 workspace，端点层已隔离）。多机 CLI 各自持游标互不影响——游标只是读侧过滤参数，不写服务器状态。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：**未来新增清单写点漏盖章 → 增量流漏行**。缓解：四个写点（apply_ops / _write_spec_root 对齐 / soft_delete_change_dir / heal_manifest_tombstones）逐点内联盖章并带「2026-10-21」锚注释，模型列注释与各写点 docstring 均注明「新写点必须盖章」；增量端点语义上把 NULL 行排除（未盖章行不进增量流）反而是显式失败面——漏盖章表现为客户端漏看到该行，靠全量兜底可发现（CLI 侧将带定期全量对账，sillyspec 仓消费变更内做）。评审补强两处：heal 写点盖章（P2-1，原实现漏）与 get_manifest 先读版本后读行（P2-2，封 READ COMMITTED 双快照跳行窗口——多读行是幂等超集无害）。次风险：rename 软删使墓碑行累积增速略升（原来硬删的行现在留存）——与既有 delete op 墓碑同量级（月千级），且有 `landing_version` 后未来可做墓碑 GC，可接受。

放弃的方案：① 按 `version`（行级谱系）直接过滤——不同行计数不可比，语义错误。② `updated_at` 时间戳游标——时钟回拨/同秒多事务不可判定，且 DB 与应用时钟双源。③ ETag/If-None-Match 整体未变短路（无增量行）——只能省「无变化」场景，任何单行变化仍全量 2.2MB，治标不治本。④ 服务端缓存全量序列化按 spec_version 键控——省的是 0.9s 生成段，5s 传输段不动（带宽受限），收益不足。⑤ 只做响应瘦身（裁墓碑/字段）——上限 ~15%，不解决无界增长。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 改 | backend/app/modules/spec_workspace/model.py | SpecFileManifest 加 landing_version 列 + (workspace_id, landing_version) 索引 |
| 改 | backend/app/modules/spec_workspace/service.py | get_manifest(since) 增量过滤；三写点盖章；rename 旧行软删；移除 pending_deletes |
| 改 | backend/app/modules/platform_sync/schema.py | SpecManifestResponse 加 spec_version 顶层字段 |
| 改 | backend/app/modules/platform_sync/router.py | spec-manifest 端点加 since Query 参数 |
| 改 | backend/app/modules/platform_sync/service.py | get_spec_manifest 透传 since 与 spec_version |
| 增 | backend/migrations/versions/20261021130000_spec_manifest_landing_version.py | 加列 + 索引迁移 |
| 改 | backend/app/modules/platform_sync/tests/test_spec_sync.py | 新增增量/边界用例 + 全量回归断言 |
| 改 | backend/app/modules/spec_workspace/tests/test_soft_delete_change_dir.py | 追加印章断言；如既有 rename 硬删断言按新语义修正 |
| 改 | backend/app/modules/spec_workspace/tests/test_platform_deleted_guard.py | heal 用例追加印章+增量可见断言（评审 P2-1 补齐） |
| 改 | backend/app/modules/spec_workspace/tests/test_sync_incremental.py | rename 硬删断言按墓碑新语义修正（3 处） |
| 改 | backend/app/modules/spec_workspace/tests/test_spec_version_and_init_synced.py | apply_sync 落地 bump 计数断言按双 bump 新契约修正 |
| 改 | backend/tests/test_align_platform_change_events_migration.py | 迁移链尾锚 heads[0] 前移到 20261021130000（pre-commit 闸门联动） |
