---
author: qinyi
created_at: 2026-08-15 06:10:00
scale: large
plan_level: full
risk_level: module-sufficient
---

# 设计文档（Design）— perf-remediation 性能审查高危修复

## 背景

2026-08-14 六代理性能审查（DB / 文件系统 / 前端 daemon）确认了 10 项有真实代码证据的性能问题。共性是「项目里已有正确范式但没推广」：Wave C 的 asyncio.to_thread 范式、批量 IN 预取范式、ql-008 的 os.scandir 单遍范式、key_prefix 索引设计，都只覆盖了部分调用点。最痛的是文件同步链路（高频 + Windows bind mount stat ~1.45ms/次）与 reparse 全链路同步 IO 阻塞事件循环。

## 设计目标

1. 事件循环解放：reparse 与 spec 写入链路的同步 FS IO 全部移出事件循环（to_thread）。
2. 消除每文件一次 DB 提交与 per-op 查询（批量化）。
3. 消除读路径大列全量搬运（scan_docs content）与 O(n) bcrypt 扫描（api_key key_prefix 过滤）。
4. 前端/daemon 的「全量拉取 + 无门控轮询」改增量与门控。
5. 行为零变更：所有优化不改变对外语义（响应结构、状态机、日志格式不变），既有测试断言不因语义变化而需要修改（若个别测试断言了实现细节如调用次数，允许按新实现调整，但业务断言不动）。

## 非目标（Non-Goals）

- 前端巨型组件拆分（milestone-details 3139 行等，渐进债另处理）
- 长列表虚拟化、bundle 优化
- PPM 计划导入 N+1（低频管理路径，量级可控）
- latest_progress / change.stages JSON 列瘦身（涉及 schema/契约，独立 change）
- LiteLLM/skills bundle 流式化（spec 树当前规模内存可控）
- 数据库索引新增（本次全部利用已有索引）

## 拆分判断

不拆分：10 项修复共享「局部惯性修复」主题、无相互依赖、每项独立可测。不批量：非模板×数据。

## 总体方案

### 段 1 · 事件循环解放（W1，收益最大）

1. **reparse 两处包 to_thread**：`change/service.py:1075`（`self._parser.parse_workspace(...)`）与 `scan_docs/service.py:172-176`（`parse_docs_tree/parse_component`）——parser 纯同步重 IO（千次 stat + read_text），包 `await asyncio.to_thread(...)`（项目已有范式：tool_gateway/service.py:322）。解析后 DB 写回仍在事件循环（原本就在）。
2. **_write_spec_root per-file 循环移入线程**：`spec_workspace/service.py:641-702`——per-file `read_bytes` + `hashlib.sha256` + `shutil.move` 整段循环体移入 `to_thread`（文件系统操作部分）；DB 写回到 loop 批量做（与段 2 合并实施）。
3. **change_writer 写文件 to_thread 补漏**：`change_writer/service.py:349-350/:264-265`（write_text + stat 同步在 async def 里）。

### 段 2 · 批量化（W1）

4. **_bump_files_processed 批量回写**：`spec_workspace/service.py:732-754`——每文件独立 session+commit 改为：内存计数，每 50 个文件或每 500ms（以先到者）批量 `files_processed = files_processed + batch` 单次 UPDATE；同步结束时终态回写保证准确。前端进度条容忍 50 文件粒度。
5. **apply_ops per-op SELECT 批量预取**：`spec_workspace/service.py:965-978` + `:1048-1059`——循环前按 ops 的 path ∪ new_path 一次 IN 预取 SpecFileManifest 成 dict（照抄同文件 :610-621 范式）。

### 段 3 · 查询收窄（W2）

6. **scan_docs list 排除 content**（Grill 修订：直接采用 fallback 方案）：`scan_docs/service.py:45-72`——无 q 时 `list_` 查询 `load_only` 排除 content 列（schema 本就 no content，纯收益）；带 q 时保留现状 SQL LIKE（候选集二次取 content 在选择性 q 下严格劣于现状，不用）。
7. **api_key 认证 key_prefix 过滤**：`auth/api_key_service.py:228-241`——候选查询加 `WHERE revoked_at IS NULL AND key_prefix = :prefix`（prefix 来自明文前 12 字符，`ix_api_keys_prefix` 索引已存在，key_prefix 字段设计目的即此）。bcrypt verify 次数从 O(全部活跃 key) 降到 O(同前缀 key，正常=1)。缓存逻辑不动。

### 段 4 · FS 惯性修复（W2）

8. **_list_files_sync scandir 单遍**：`change/service.py:267-289`——rglob+is_file+stat 双 stat 改 os.scandir 显式栈（照抄 change/parser.py:496-530 ql-008 范式）。
9. **scan_docs parser stat 复用 + _safe_mtime 推广**：`scan_docs/parser.py:127-186`——每文件 4 次 stat 收敛为 1 次（size+mtime 同一 stat_result）；`:165/:247` 裸 `datetime.fromtimestamp` 与 `change/service.py:286` 统一改用 `change/parser.py:36` 的 `_safe_mtime`（抽公共位置或 import）。
10. **_load_module_map 缓存**（Grill B-3 修订）：`change/parser.py:408-465`——模块级缓存按 **(resolved map_file path, mtime) 复合键**失效（仅按 mtime 会跨 workspace 串结果），值不可变、幂等填充、dict 单键赋值原子（良性竞态容忍）；该缓存的引入使 parser 出现模块级可变状态，R-01 的「无状态」前提对缓存键失效（其余仍成立）——design 明示。收益收窄：platform_managed 布局下 map 路径恒空（预存缺陷 `_load_module_map` 找 `root/.sillyspec/docs` 实际在 `root/docs`，缓存对它零收益），收益仅在 repo-native 布局；顺手修路径探测（两处都找）作为附带修复。

### 段 5 · 前端 + daemon（W3，与 W1-W2 并行）

11. **mission 日志增量游标**（Grill B-2 修订：后端无游标，需一并加）：①后端 `agent/router.py:456-474` GET logs 增加可选 `after` 查询参数（`agent/service.py:952-981` get_run_logs 增加游标 WHERE——**语义=取比游标更新的日志：`WHERE timestamp > after`**（plan 审查修正：初版 `<=` 方向反了，永远拿旧日志），`after` 传前端已见**最早一条**的 timestamp（desc 排序下界），返回 (after, now] 增量再按 desc 排；同 timestamp 边界容忍少量重复，前端按 id 去重合并）。纯查询参数+WHERE，不动 schema（不违 NFR-04）。②前端 `mission-console.tsx:208-223` WorkerLogPanel 传 after + 增量合并 setLogs（按 id 去重）；游标失效（返回空）fallback 全量重拉一次。
12. **daemon _pollLoop 按通道拆分门控**（Grill B-1 修订：change-write 无 WS 推送）：`sillyhub-daemon/src/daemon.ts:2113-2165`——**lease 轮询分支**：WS isConnected 且距最后一条 WS 消息 < 90s 时跳过（TASK_AVAILABLE 推送兜底），断连恢复 30s；**change-write 轮询分支**：保留 30s 不变（该通道无 WS 推送，30s 轮询是唯一分发通道——protocol 无 change-write 消息类型，change_writer 模块不调 ws_hub）。
13. **daemon 落盘日志清理**：`terminal-observer.ts:78-94`（runs/<leaseId>/terminal.log）与 `policy/audit-sink.ts:174-183`（failover jsonl）——启动时清理 N=7 天前的 runs 子目录与 audit 文件；写入路径不动。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/change/service.py | reparse to_thread（:1075）；_list_files_sync scandir（:267）；_resync_change_docs to_thread（:480，同类顺手） |
| 修改 | backend/app/modules/scan_docs/service.py | reparse to_thread（:172）；list_ load_only 排除 content（:45） |
| 修改 | backend/app/modules/scan_docs/parser.py | stat 复用 + _safe_mtime 推广（:127-186/:165/:247） |
| 修改 | backend/app/modules/spec_workspace/service.py | _write_spec_root 循环入线程（:641）；_bump_files_processed 批量（:732）；apply_ops IN 预取（:965/:1048）；_prune_spec_backups to_thread（:897，同类顺手） |
| 修改 | backend/app/modules/change_writer/service.py | write_text/stat to_thread（:264/:349） |
| 修改 | backend/app/modules/auth/api_key_service.py | 认证候选 key_prefix 过滤（:228） |
| 修改 | backend/app/modules/change/parser.py | _load_module_map (path,mtime) 复合键缓存 + platform_managed 路径探测附带修复；_safe_mtime 移公共（供 scan_docs import） |
| 修改 | backend/app/modules/agent/router.py | GET logs 增加可选 after 游标参数（Grill B-2） |
| 修改 | backend/app/modules/agent/service.py | get_run_logs 游标 WHERE |
| 修改 | frontend/src/lib/agent.ts | after 参数类型补全（已支持，核对） |
| 修改 | frontend/src/components/mission-console.tsx | 日志轮询 after 增量 + id 去重合并 + 空结果 fallback（:208） |
| 修改 | sillyhub-daemon/src/daemon.ts | _pollLoop WS 健康门控（:937） |
| 修改 | sillyhub-daemon/src/terminal-observer.ts | 启动清理 N 天前日志（:78） |
| 修改 | sillyhub-daemon/src/ws-client.ts | 新增 lastMessageAt 只读 getter（task-09 门控条件消费；plan 审查补录） |
| 修改 | sillyhub-daemon/src/policy/audit-sink.ts | 同上（:174） |
| 新增/修改 | 各模块 tests/ | 每项修复的行为保持测试 + 批量回写/预取的单测 |

## 接口定义

- 无新增对外接口。`_bump_files_processed` 内部签名不变（调用点无感）；`list_files`（scan_docs）返回 schema 不变。
- `getAgentRunLogs(workspaceId, runId, { after })`：前端调用形态变化，后端接口已存在不变。
- daemon `_pollLoop`：私有方法行为变化（门控），无对外契约。

## 生命周期契约

不涉及生命周期契约（N/A）——本变更不改 session/lease/agent_run/daemon 状态机与事件流，只优化既有路径的执行方式（to_thread/批量化/缓存）。

## 兼容策略

- reparse to_thread：解析纯读线程安全；parse 结果 DB 写回串行不变。并发 reparse 交错风险与现状相同（本就有 IntegrityError 自愈），不新增。
- _bump_files_processed 批量化：进度条粒度 50 文件/500ms，前端展示语义不变（数值最终准确）。
- api_key prefix 过滤：同前缀多 key 场景（理论极少）仍逐条 bcrypt，行为不回归；key_prefix 为空的历史行（若有）回退全扫（防御性保留 fallback 分支）。
- mission 日志增量：after 游标取前端已见最早一条的 timestamp，后端 WHERE timestamp > after 返回更新日志（方向经 plan 审查修正）；后端无更新时返回空，前端 fallback 全量重拉一次；同 timestamp 边界由前端按 id 去重吸收。
- daemon 轮询门控（Grill B-1 按通道拆分）：lease 分支 WS 健康（isConnected 且 <90s 有消息）跳过、断连恢复 30s；change-write 分支 30s 不变（无 WS 推送，轮询是唯一分发通道）。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | to_thread 并发下 parser 共享状态竞态 | P1 | parser 除 task-07 新增缓存外无共享可变状态（Grill 核实）；缓存键复合 path+mtime、值不可变、幂等填充（良性竞态） |
| R-02 | 批量进度回写崩溃丢失计数 | P2 | 终态回写放 finally；崩溃场景下 progress 表数据本就允许滞后 |
| R-03 | api_key prefix 过滤漏掉无 prefix 历史行 | P2 | key_prefix NOT NULL（Grill 核实无 NULL 行），fallback 全扫分支纯防御保留 |
| R-04 | scan_docs 搜索行为变化 | P2 | 已改用 fallback 方案（仅 q 时 LIKE，无 q 时 load_only）——无 q 路径结果集等价由测试钉死 |
| R-05 | daemon 门控后 WS 假活（连接在但不收消息） | P2 | 门控条件 = isConnected 且距最后 WS 消息 <90s；change-write 通道不门控（Grill B-1） |
| R-06 | after 游标同 timestamp 边界重复 | P2 | 前端按 id 去重合并；重复量级=同毫秒日志条数（个位数） |

## 决策追踪

- D-001@v1：不动 schema 不加迁移，纯读路径优化+批量化（覆盖全部 FR）。
- D-002@v1：FS IO 一律 to_thread（纯读线程安全）；写路径批量提交。
- D-003@v1：观测复用已上线 monitoring 三件套（慢请求/慢查询日志），不新建 metrics 层。
- 未解决：无。

## 自审（Self-Review）

- 章节齐全 ✅；每项有 file:line 依据（审查代理 + Grill 独立源码核验，个别行号微漂已在 plan 时用实际行号）✅
- Grill FAIL 修订（2026-08-15）：B-1（daemon 门控按通道拆分，change-write 不门控）、B-2（后端 logs 加 after 游标，文件清单补 agent/router+service）、B-3（module-map 缓存复合键 + R-01 前提修正 + platform_managed 收窄）全部落入正文；scan_docs 搜索直接采用 fallback 方案 ✅
- 生命周期关键词命中 → 已加「生命周期契约: N/A」豁免声明 ✅
- 测试策略：module 级；每项修复先写「行为保持」测试（优化前后结果等价）再改实现。
