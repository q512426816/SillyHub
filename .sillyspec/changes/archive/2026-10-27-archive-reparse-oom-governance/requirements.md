---
author: qinyi
created_at: 2026-10-27 10:16:21
generated_by: sillyspec-fourpiece-init
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 平台用户 | 变更中心使用者，感知归档收敛时效与列表正确性 |
| 平台运维 | 消费水位/收敛/漂移日志，执行手动全量 reparse 兜底 |
| agent 会话（CLI/daemon） | spec 推送方，收件箱契约不变，零感知 |

## 功能需求

### FR-01: 归档推送触发 scoped 定向重扫（非全量）且结构性事件立即收敛
Given 一个已存在的活跃变更目录 `changes/<name>/` 与其 DB 行（location=active）
When spec-sync 推送该变更的归档移动（`changes/<name>/*` → `changes/archive/<name>/*` 的 rename/delete op）
Then `_compute_reparse_scope` 产出 scoped=[name] 且 structural=True、不置 archive_hit；`_trigger_change_reparse` 立即调度（不受 120s 节流窗拦截，single-flight 互斥保持）；reparse 后行 location='archive'、文档 path 前缀翻转、scope 外行零动作；全程不发生 scope=None 全量解析。
#### 场景：并行多变更同窗归档
- Given 工作区 W 内 5 个变更在 3 分钟内先后归档
- When 各归档推送先后到达
- Then 每次触发均为 scoped 单变更解析（互相独立），无全量重扫叠加；单工作区同一时刻至多一个 reparse 在跑（in-flight 互斥），全部收敛完成。

### FR-02: 普通文档推送维持 120s 合并窗收敛
Given 工作区 W 在 120s 窗内已执行过一次 reparse
When 又一次非结构性 scope 触发到达（普通 add/update 文档推送）
Then 该触发入尾随合并（不立即执行），窗到点合并补发——既有节流语义零回归。

### FR-03: bundle gzip 同版本单次构建
Given 两个并发请求命中同一 (workspace, spec_version) 的 bundle gzip 且缓存未热
When 两请求同时到达
Then 仅发生一次构建，另一请求等待并复用同一产物（无重复构建）。

### FR-04: 漂移探针与内存水位（只读只告警）
Given 后端运行中，lifespan 已挂载 drift_probe_loop
When 每轮探针执行
Then ①抽样核对（≤50 行/轮）DB 行 location 与磁盘目录形态，不一致仅 log.warning（零写操作、不触发任何 reparse）；②cgroup memory 水位周期落日志，超 80% 告警；无 cgroup 环境静默跳过不报错；任务随 lifespan cancel 干净关停。

### FR-05: 收敛可观测
When 每次 reparse 完成
Then 落 `reparse_converged` 日志（scope 数/耗时/触发通道 structural|coalesced），可归因可统计。

## 非功能需求
- 兼容性：零端点/零 schema/零配置开关；旧 CLI/旧 daemon 零依赖（收件箱契约不变）；Windows/Linux/macOS 兼容（路径归一化沿用现行 replace("\\","/") 惯例，cgroup 读取平台差异静默降级）。
- 回退：恢复 archive_hit 全量分支即单点回退，无数据迁移负担。
- 资源：探针唯一常驻资源=asyncio task，随 lifespan 自灭；无文件锁/子进程/句柄。

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01/FR-02 | 双时效目标（≤60s/≤120s）+ 峰值解耦 |
| D-002@v1 | —（Non-Goal） | mem_limit 不动，附录建议 |
| D-003@v1 | —（Non-Goal） | 过滤缝隙不在本变更 |
| D-004@v1 | FR-01 | scoped 承接归档，全量退位手动兜底 |
| D-005@v1 | —（Non-Goal 边界） | 不引入第二写径 |
| D-006@v1 | —（Non-Goal 边界） | 不做定时全量对账 |
| D-007@v1 | FR-01/FR-02 | 双通道时效分档 |
| D-008@v1 | FR-04 | 探针只告警不自动修复 |
| D-009@v1 | FR-03 | bundle 同版本 single-flight |
| D-010@v1 | FR-01 | structural 撞 in-flight 完成回调即时补发（≤60s 承诺收口） |
| D-011@v1 | FR-03 | bundle Future 失败传播+等待者降级自建 |

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: backend/app/modules/spec_workspace/tests/test_archive_scoped_reparse.py「归档推送触发 scoped 定向重扫（非全量）且结构性行 location/文档路径正确翻转」
FR-02: backend/app/modules/spec_workspace/tests/test_archive_scoped_reparse.py「普通文档推送维持 120s 合并窗（节流零回归）」
FR-03: backend/app/modules/spec_workspace/tests/test_archive_scoped_reparse.py「同版本 bundle 并发只构建一次 + 构建失败等待者降级自建不悬挂」
FR-04: backend/app/modules/spec_workspace/tests/test_archive_scoped_reparse.py「探针只读只告警（零写路径断言）+ 水位日志形态 + 无 cgraph 环境静默跳过」
FR-05: backend/app/modules/spec_workspace/tests/test_archive_scoped_reparse.py「reparse_converged 统计日志（scope 数/耗时/通道）」
