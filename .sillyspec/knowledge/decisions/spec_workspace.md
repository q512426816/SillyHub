# 决策知识 — spec_workspace

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-07-spec-sync-task-reparse
锚点：未记录
文件：.sillyspec/changes/2026-10-07-spec-sync-task-reparse/design.md, .sillyspec/changes/2026-10-07-spec-sync-task-reparse/requirements.md, .sillyspec/changes/2026-10-07-spec-sync-task-reparse/tasks.md, backend/app/modules/spec_workspace/service.py, backend/app/modules/spec_workspace/tests/test_task_reparse_on_sync.py, .sillyspec/changes/2026-10-07-spec-sync-task-reparse/proposal.md
最近确认：f82bc067ca74946ac7c6b88d4e6382e54e6c665c
理由：最大风险：archive_hit 全量路径下对大 workspace 逐变更 reparse 的耗时——已在后台任务里（不阻塞同步响应）且全量路径仅归档移动触发（罕见）；后续可按 location 过滤收窄。试过放弃：在 apply_ops 落盘循环里逐 op 触发——绕过调度器会复活 ql-20260909-021 修掉的风暴；放弃。

## D-spec_workspace-001@v1 2026-09-25-full-sync-resurrect-missing——在 `spec_workspace/service.py::_write_spec_root` 的逐文件循环改「同内容跳过」分支：跳过前提从 「既有行哈希相同」
状态：implemented
变更：2026-09-25-full-sync-resurrect-missing
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-09-25-full-sync-resurrect-missing/design.md
文件：backend/app/modules/spec_workspace/service.py, backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py
最近确认：未记录
理由：在 `spec_workspace/service.py::_write_spec_root` 的逐文件循环改「同内容跳过」分支：跳过前提从 「既有行哈希相同」升级为「既有行哈希相同 **且** 目标文件磁盘在位 **且** 行在线（exists=True）」。 `_load_member` 线程函数顺手探测 `tgt.exists()` 一并返回（不加额外 IO 轮次）；三态任一不满足即判 「复活态」（`resurrect`）：绕开 mtime 优越性判定直接落盘（move）并把行翻回在线；复活且内容一致时 不产生冲突归档行（内容相同无冲突），内容不同仍走既有归档。 选这个方案的原因：生产 c84182bc 实证「行在、哈希同、磁盘无文件」的幽灵态下，整树覆盖的全量推送 也永远写不回文件——镜像残缺直接卡死知识/扫描文档页数据；而全量语义本来就是「以 tar 为权威整树 覆盖」，磁盘缺文件时同内容跳过没有任何正当性。复活不比 mtime（磁盘侧本无现行文件可比对）， 也不该归档同内容「冲突」。

## D-spec_workspace-002@v1 2026-09-26-spec-consistency-writer——两件事同批（同属「spec 快照一致性可见化」）：①consistency() 内存对账——rglob 磁盘树（排 .runtime/local.yaml，线程
状态：implemented
变更：2026-09-26-spec-consistency-writer
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-09-26-spec-consistency-writer/design.md
文件：backend/app/modules/spec_workspace/model.py, backend/app/modules/spec_workspace/router.py, backend/app/modules/spec_workspace/schema.py, backend/app/modules/spec_workspace/service.py, backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py, backend/migrations/versions/20260926083000_spec_workspace_last_writer.py, backend/openapi.json, frontend/src/components/changes/detail/__tests__/change-events-card.test.tsx, frontend/src/components/changes/detail/change-observation-events-card.spec.tsx, frontend/src/lib/api-types.ts
最近确认：未记录
理由：两件事同批（同属「spec 快照一致性可见化」）：①consistency() 内存对账——rglob 磁盘树（排 .runtime/local.yaml，线程池）× SpecFileManifest 行，输出 disk_only（磁盘有清单无）/manifest_ghost （行 exists=True 磁盘缺——正是 resurrect 修的幽灵形态）/tombstoned_on_disk（墓碑但文件在）三类 + counts；新端点 GET /spec-workspace/consistency。②写方记录——SpecWorkspace 增 last_writer/ last_writer_at 两列（alembic 20260926083000），apply_sync/apply_ops 尾部 _note_writer（独立短事务 幂等；写方切换 structlog warning——daemon 与 CLI 双写是 manifest 漂移根因），身份从路由 _user 派生 摘要 user:<id8>:<email24>，Read DTO 透传。

## D-spec_workspace-003@v1 2026-10-21-spec-manifest-incremental——慢的根因：CLI 每条命令全量拉 spec-manifest（实测 13,145 行 / 2.2MB / 5.5s @ ~400KB/s 链路），吃掉 sill
状态：implemented
变更：2026-10-21-spec-manifest-incremental
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-21-spec-manifest-incremental/design.md
文件：backend/app/modules/platform_sync/router.py, backend/app/modules/platform_sync/schema.py, backend/app/modules/platform_sync/service.py, backend/app/modules/platform_sync/tests/test_spec_sync.py, backend/app/modules/spec_workspace/model.py, backend/app/modules/spec_workspace/service.py, backend/app/modules/spec_workspace/tests/test_soft_delete_change_dir.py, backend/app/modules/spec_workspace/tests/test_spec_version_and_init_synced.py, backend/app/modules/spec_workspace/tests/test_sync_incremental.py, backend/migrations/versions/20261021130000_spec_manifest_landing_version.py, backend/tests/test_align_platform_change_events_migration.py
最近确认：未记录
理由：慢的根因：CLI 每条命令全量拉 spec-manifest（实测 13,145 行 / 2.2MB / 5.5s @ ~400KB/s 链路），吃掉 sillyspec 同步 8s 总预算。治本 = 让清单请求在稳态只传变化行：给 `spec_file_manifest` 加 `landing_version` 印记列（行最后写入时的工作区 `spec_version`），`GET /api/changes/-/spec-manifest` 支持 `?since=<spec_version>` 只回 `landing_version > since` 的行，响应带当前 `spec_version` 供客户端作下次游标。 配套一致性改动：① 四个清单写点（`apply_ops` / `_write_spec_root` 后逐行对齐 / `soft_delete_change_dir` / `heal_manifest_tombstones`——第四写点为评审 P2-1 捕获后补齐）在同事务内统一盖章；② rename 旧行从硬删改软删墓碑——增量协议成立的前提是「清单行只墓碑不消失」，否则旧行消失对增量消费方是不可见盲区。选工作区 `spec_version` 作游标基轴而非行级 `version`：行级 version 是每行独立 +1 的谱系计数（样本行 v20），不同行之间不可比；`spec_version` 单调递增且既有不变量「manifest 行版本变化 ⇒ spec_version 递增」（service.py:187 注释）恰好保证印章可比性。

## D-spec_workspace-004@v1 2026-10-27-mobile-chat-visual-round4——用户四轮反馈：①子代理卡与进度视图过程块仍不满宽——根因是 turn-segment-views 里 13 处容器各挂 max-w-[calc(100%-120
状态：implemented
变更：2026-10-27-mobile-chat-visual-round4
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-27-mobile-chat-visual-round4/design.md
文件：backend/app/main.py, backend/app/modules/spec_workspace/drift_probe.py, backend/app/modules/spec_workspace/service.py, backend/app/modules/spec_workspace/tests/test_archive_scoped_reparse.py, frontend/src/app/globals.css, frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx, frontend/src/components/daemon/__tests__/turn-status-bar-phase.test.tsx, frontend/src/components/daemon/session-panel/turn-state.ts, frontend/src/components/daemon/turn-segment-views.tsx, frontend/src/components/daemon/turn-status-bar.tsx, frontend/src/components/daemon/turn-timeline.tsx, frontend/src/lib/daemon/__tests__/session-stream-turn-phase.test.ts
最近确认：未记录
理由：用户四轮反馈：①子代理卡与进度视图过程块仍不满宽——根因是 turn-segment-views 里 13 处容器各挂 max-w-[calc(100%-120px)]（2026-10-25 统一限宽，PC 防一行过长，手机被吃 30%）；②对话/进度两 tab 轮次样式不一（进度用旧 TurnStatusBadge 小字）要求统一。方案：①13 处 arbitrary 类一次替换为语义类 seg-width-cap，限宽规则收敛 globals.css 单点（.seg-width-cap=calc(100%-120px) desktop 等价 + [data-variant=mobile] 覆盖 100%）——比逐处加 mobile prop 分支轻 13 倍且防未来漂移；②turn-timeline 轮尾 viewMode 条件删除，all 视图与对话视图共用同一 RoundDivider JSX 块（meta/detail/mobile 同源同构），自动续跑徽标并入统一行，TurnStatusBadge 函数退役（dead code 删除）。

## D-spec_workspace-005@v1 2026-10-27-netdata-prod-monitoring——答：在生产服务器（124.222.127.242，Ubuntu 24.04，4 核 / 7.5G 内存 / 59G 盘用 30%）宿主机上用官方 kicksta
状态：implemented
变更：2026-10-27-netdata-prod-monitoring
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-27-netdata-prod-monitoring/design.md
文件：backend/app/main.py, backend/app/modules/spec_workspace/drift_probe.py, backend/app/modules/spec_workspace/service.py, backend/app/modules/spec_workspace/tests/test_archive_scoped_reparse.py, frontend/src/app/globals.css, frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx, frontend/src/components/daemon/turn-segment-views.tsx, frontend/src/components/daemon/turn-timeline.tsx
最近确认：未记录
理由：答：在生产服务器（124.222.127.242，Ubuntu 24.04，4 核 / 7.5G 内存 / 59G 盘用 30%）宿主机上用官方 kickstart 脚本安装 Netdata（`--stable-channel` 锁稳定通道、`--disable-telemetry` 关遥测上报），装完立即改 `/etc/netdata/netdata.conf` 的 `[web] bind to` 为 `127.0.0.1` 并重启服务——面板本身无密码认证，回环绑定 + SSH 隧道是唯一访问面，即使将来安全组误放行 19999 也不暴露。选 Netdata 而非 Prometheus+Grafana：目标是「出事后还原秒级现场」（瞬时抖动/OOM/单容器打满），单机零配置开箱即用；长期容量趋势腾讯云自带云监控已覆盖，不重复建设。容器级排查价值：生产栈五个容器（backend/frontend/postgres/redis/minio）以 docker compose 运行，Netdata 经 cgroups 自动按容器分指标，无需任何配置。仓库侧唯一改动是 deploy.md 模块卡补一条运维排查条目。

## D-spec_workspace-006@v1 2026-10-28-cgroup-v2-watermark-fix——drift_probe.py 的 `_CGROUP_LIMIT_FILES` 首候选写成了 v2 不存在的 `/sys/fs/cgroup/memory.lim
状态：implemented
变更：2026-10-28-cgroup-v2-watermark-fix
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-28-cgroup-v2-watermark-fix/design.md
文件：backend/app/modules/spec_workspace/drift_probe.py, backend/app/modules/spec_workspace/tests/test_memory_watermark.py
最近确认：未记录
理由：drift_probe.py 的 `_CGROUP_LIMIT_FILES` 首候选写成了 v2 不存在的 `/sys/fs/cgroup/memory.limit`（v2 实为 `memory.max`），导致纯 v2 宿主上 current 可读、limit 恒 None，水位告警静默失效。修法是一行候选表置换：首候选改 `/sys/fs/cgroup/memory.max`，v1 `memory/memory.limit_in_bytes` 兜底保留；docstring 的 v2 文件名同步修正。`max` 字面量（无限制）不加新分支——`_read_first_existing` 的 `int()` 已抛 ValueError 被捕获，按「该候选不可用」落回 v1 兜底，v1 也无则 None → 与无 cgroup 环境同路静默跳过，语义正确（无限制即无水位可言），仅在候选表旁注释说明。测试新增独立文件，monkeypatch 模块常量为 tmp_path 文件、monkeypatch 模块 log 符号为 MagicMock 断言事件（仓内既有结论：structlog PrintLoggerFactory 直写 stderr，caplog 抓不到，见 test_session_readiness.py:336-342 惯例）。
