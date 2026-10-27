---
author: qinyi
created_at: 2026-10-27 10:37:04
generated_by: sillyspec-design-init
scale: "small"  # Step 8 规模评估落值——单文件簇（spec_workspace 一模块 4 文件）、无 Wave 真并行需求、单上下文可吞吐；架构重要性高但复杂度轴按文件/编排面计
---

# 设计文档（Design）— 2026-10-27-archive-reparse-oom-governance

## 背景

2026-10-27 上午生产实证：多个 agent 会话在 45 分钟内密集并行归档（六会话同窗收尾），每次归档推送命中 `changes/archive/` 路径的 rename/delete op → `_compute_reparse_scope` 置 `archive_hit=True` → 强制**全量 reparse**（`parse_workspace` 遍历全部 ~470 个变更目录）。全量重扫在 120s 节流窗内反复叠加，叠加常驻模型 worker（fastembed/ct2 峰值 ~1.05G），后端容器（mem_limit=2500m，2026-10-24 刚从 1100m 上调过一次）内存顶爆：云主机 dmesg 记录 `Memory cgroup out of memory: Killed process (python) anon-rss≈2.37GB`（constraint=CONSTRAINT_MEMCG），09:19 容器重建。

历史前科证明 OOM 不只挂服务：容器反复被杀曾致 `spec_file_manifest` 唯一索引静默损坏（归档后平台仍显示进行中 + spec-sync 恒 422，2026-10-19 修复留 playbook）。根因链锚点：backend/app/modules/spec_workspace/service.py:3091-3122（archive_hit 判定）、backend/app/modules/change/parser.py:143-202（三区 iterdir 均已带 scope_set 过滤——**定向解析是既有能力，归档场景被保守策略弃用**）。

## 设计目标

1. 归档/删除等结构性事件收敛 ≤60s（变更中心可见），普通文档推送维持 ≤120s（D-001）。
2. 单次收敛内存峰值与变更总数解耦：不再因归档触发全树遍历（D-004）。
3. OOM 可预警：容器内存水位周期落日志，超阈值告警（段5 设计确认）。
4. 漂移可发现不自动放大：轻量只读探针周期抽样核对，仅告警（D-008）。

## 非目标

- 后端容器 mem_limit 调整（2500m→3500m）：仅作附录运维建议供后续单独决策，本变更不动 deploy/docker-compose.yml:178（D-002）。
- 「进行中列表过滤缝隙」修正（归档未收敛行混入进行中）：独立轻量变更另行处理（D-003）。
- daemon / 前端零改动；platform_sync 收件箱契约、spec-sync 协议、DB schema 零变更。
- 不引入绕过 parser 的 Change 行直写路径（D-005 rejected 边界）；不做定时全量对账（D-006 rejected 边界 + knowledge 拒C 先例）。

## 拆分判断

单一治理域（reparse 触发链 + 配套观测），全部改动集中于 backend spec_workspace 模块一个文件簇，无跨模块并行需求，不拆分、非批量模式。

## 总体方案

**Phase 1（核心）：归档 scoped 化 + 双通道时效**

1. `_compute_reparse_scope` 收窄 archive_hit：归档路径（`changes/archive/<name>/...`）的 delete/rename op 从「置 archive_hit=True（全量）」改为「取 `<name>` 进 scoped 集 + 标记 `structural=True`」。仅两类退化情形保留全量兜底：op 恰命中 `changes/archive` 根（无名可解析）、以及既有非归档根级树形 op。
2. `_trigger_change_reparse` 双通道（D-007）：`structural=True` 的触发绕过 120s 节流窗**立即**调度（single-flight 同 workspace 互斥保持）；非结构 scope 维持现节流。structural 触发撞 in-flight reparse 时**不入 120s 硬定时尾随，改挂当前 reparse 完成回调即时补发**（D-010，Grill P2-1 采纳：硬 sleep(120s) 会使事故场景的同窗并发收敛时延≈满窗，突破 ≤60s 承诺）；非结构尾随维持 120s 合并窗不变。精度口径（Grill P3 采纳）：scoped 的**解析内存峰值∝scope 数**；目录枚举仍有 ∝条目总数的 readdir+排序开销（常数级、无解析对象累积，可接受）。
3. 安全四问消解（每问一条测试锁，见文件清单测试文件）：
   - 空目录残留：`_cleanup_empty_dirs` 在 reparse 触发**之前**执行（service.py:2865 早于 :2896），不动；
   - 旧键删除：归档变更在 archive 区被同名解析（parser.py:171 过滤后命中），`_apply_parsed` 原地更新 `location='archive'`，key 在 seen 集内不进删除环，「scoped 零删除红线」（R-08）天然保持；
   - 改名误配：`_detect_renames` 的孤儿候选 = existing ∖ parsed，scoped 下该 key ∈ parsed 不进候选（service.py:1610-1618 语义）；
   - 跨变更误伤：scope 外行零动作（R-08 收窄语义原文保证）。

**Phase 2（配套）：内存与可观测**

4. bundle gzip 构建同版本 single-flight（D-009）：`_bundle_gzip_cache` 增在建互斥，同 (workspace, spec_version) 并发请求等待复用产物（service.py:197-201 现状无互斥）。**Future 携带成功/失败双态**（D-011，Grill P2-2 采纳）：现行缓存 put 仅在流完整消费后发生（断连半包不入缓存），构建方异常/断连时 Future 置失败并传播，等待者捕获后降级自建——失败不传染、等待者永不悬挂。
5. 收敛统计日志：每次 reparse 完成记 `reparse_converged`（scope 数/耗时/触发通道），可观测可归因。
6. 漂移探针 + 水位（D-008）：`drift_probe.py` 周期任务（照 `scheduled_send_sweeper` 常驻模式，main.py lifespan create_task）：①周期抽样核对 DB 行 location 与磁盘目录形态一致性（只读，发现不一致 `log.warning`）；②周期读 cgroup memory.current/limit 落水位日志，超 80% 告警。零写操作、不自动触发 reparse；人工修复通道 = 既有手动 reparse 端点。

**Phase 3（兜底）**：手动全量 reparse 端点（POST /changes/reparse，既有）保持原样作为漂移修复工具；无新增定时全量。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/spec_workspace/service.py | ① `_compute_reparse_scope`：归档树形 op 改 scoped+structural 标记，返回三元组 (scope, archive_hit, structural)——纯内部函数签名变化，调用方仅 `_trigger_change_reparse`；② `_trigger_change_reparse`：structural 立即通道（跳过节流窗，保 single-flight）；③ `_build_gzip_bundle` 构建路径加同版本在建互斥；④ reparse 完成处补 `reparse_converged` 统计日志 |
| 新增 | NEW:backend/app/modules/spec_workspace/drift_probe.py | 漂移探针 + 内存水位周期任务：`drift_probe_loop(interval)` 常驻循环（cancel 透传语义同 scheduled_send_sweeper）；`check_drift_once(db)` 只读抽样核对（DB 行 location vs 磁盘目录存在性，抽样上限 N=50/轮）发现漂移仅 log.warning；`log_memory_watermark()` 读 cgroup memory.current（兼容无 cgroup 环境静默跳过）超 80% 告警。无外部字段/接口 |
| 修改 | backend/app/main.py | lifespan 内 create_task 挂 drift_probe_loop（同 scheduled_send_sweeper / session_reconnect_sweeper 既有挂载模式，关停 cancel+gather） |
| 新增 | NEW:backend/app/modules/spec_workspace/tests/test_archive_scoped_reparse.py | 测试锁：① 归档 op → scoped（非全量）且 structural=True；② 归档后行 location/文档路径经 scoped reparse 正确翻转（active→archive 四问主路径）；③ 结构性触发不受 120s 窗拦（假时钟）；④ scope 外行零动作；⑤ 同版本 bundle 并发只构建一次；⑥ 探针只读性（不触发 reparse）与水位日志形态 |

## 接口定义

本变更接口面：0 端点（无接口变更）。HTTP/WS 端点、DTO、事件 payload 零变化；仅模块内私有函数签名变化：`_compute_reparse_scope(change_dirs, ops) -> tuple[list[str] | None, bool, bool]`（原二元组加第三元 `structural`，唯一调用方 `_trigger_change_reparse` 同文件内同步）。

## 生命周期契约表

不涉及生命周期契约（本变更不触碰 session/lease/agent_run 状态机，仅文件树收敛链与只读探针）。

## 数据模型

无 schema 变更（零迁移、零新表、零新列）。

## 兼容策略（brownfield 必填）

- 未配置新功能时行为不变：本变更无配置开关，行为变化即交付语义（归档收敛路径变化）；对旧 CLI/旧 daemon 零依赖——收件箱契约不变，daemon 恒发 rename op 的现状照旧被 scoped 承接。
- 回退路径：改动集中于 `_compute_reparse_scope` 一处判定，回退 = 恢复「归档树形 op → archive_hit=True」分支（单点回退，无数据迁移负担）。
- 不改变的 API / 表结构：platform_sync 全部端点、spec-sync 协议、changes/change_documents/spec_file_manifest 表结构均不动。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | scoped 语义边界外漏（同窗归档+删除交错、daemon 陈旧缓存重推退化为 delete+add）致部分行不收敛 | P0 | 四问测试锁全覆盖交错场景；漂移探针周期抽样告警兜底；手动全量 reparse 端点修复 |
| R-02 | structural 立即通道被恶意/异常高频推送打爆（风暴） | P1 | single-flight 同 workspace 互斥保持（in-flight 入尾随）；scoped 成本∝单目录（<1s 量级）实测锚定 |
| R-03 | 探针周期任务泄漏/常驻失控 | P1 | 照 scheduled_send_sweeper 模式：lifespan cancel + await gather 干净关停；单轮异常 log 吞掉不崩循环 |
| R-04 | bundle 在建互斥引入慢请求排队（构建慢时等待者超时） | P2 | 等待共享同版本 Future，构建完成即返回；构建失败 Future 置失败传播、等待者降级自建（D-011）；构建本身已有流式分块（审计 P1-性能④） |
| R-05 | 内存水位读取在无 cgroup 环境（本地 dev/Windows）报错 | P2 | 探测失败静默跳过（log 一次 debug），不影响主循环 |
| R-06 | 探针为新增常驻任务，需自灭保证 | P1 | 探针唯一常驻资源 = asyncio task，随 lifespan cancel 死；无文件锁/子进程/句柄（非功能生命周期面自灭条件） |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | 设计目标 1/2（≤60s/≤120s 双时效 + 峰值解耦）→ FR-01/FR-02 | 已覆盖 |
| D-002@v1 | 非目标第 1 条（mem_limit 附录建议不实施） | 已覆盖 |
| D-003@v1 | 非目标第 2 条（过滤缝隙 Non-Goal） | 已覆盖 |
| D-004@v1 | 总体方案 Phase 1（scoped 承接 + 全量退位手动兜底）→ FR-01 | 已覆盖 |
| D-005@v1 | 非目标第 4 条（不引入第二写径边界） | 已覆盖 |
| D-006@v1 | 非目标第 4 条 + Phase 3（不做定时全量对账） | 已覆盖 |
| D-007@v1 | 总体方案 Phase 1.2（双通道时效）→ FR-01 | 已覆盖 |
| D-008@v1 | 总体方案 Phase 2.6（探针只告警）→ FR-04 | 已覆盖 |
| D-009@v1 | 总体方案 Phase 2.4（bundle 同版本 single-flight）→ FR-03 | 已覆盖 |
| D-010@v1 | 总体方案 Phase 1.2（structural 撞 in-flight 完成回调即时补发）→ FR-01 | 已覆盖 |
| D-011@v1 | 总体方案 Phase 2.4（Future 失败传播+等待者降级自建）→ FR-03 | 已覆盖 |

多裁定组合推演：D-001（增量主通道）× D-007（立即通道）× D-008（不自愈）组合 = 结构性风暴下若 scoped 有漏路径 → 探针只告警 → 需人工手动全量；无自动放大回路、无状态死锁（探针只读、修复通道人工触发幂等）。其余裁定两两无耦合。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale——scale 留空待 Step 8 规模评估落值）
- [x] 引用所有当前版本 D-xxx@v1（D-001..D-009 全部入决策追踪表）
- [x] 生命周期关键词豁免短语已按识别格式紧邻书写（「不涉及生命周期契约」）
- [x] UI 原型分级：跳过——纯后端逻辑无界面变化（用户设计确认轮已知悉）
- [x] 无「⚠️ 自审存疑」残留项（四问消解均有代码锚点+测试锁规划；R-01 交错场景为最大剩余风险，已配探针+手动兜底双层应对）
