---
author: qinyi
created_at: 2026-10-16 10:04:00
plan_level: full
---
# 实现计划（Plan）— 2026-10-16-backend-mem-polling

## Wave 1（并行，无依赖）
- task-01
- task-03
- task-05
> batch: task-01+task-03+task-05（文件正交三批并一可减上下文重建；execute 直写模式下按序执行等效）

## Wave 2（依赖 Wave 1 完成）
- task-02
- task-04
- task-08
> batch: task-02+task-04+task-08

## Wave 3（依赖 Wave 2 完成）
- task-06
- task-09
> batch: task-06+task-09

## Wave 4（依赖 Wave 3）
- task-07

## Wave 5（依赖全部）
- task-10

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 嵌入子进程封装+索引缓存上限 | W1 | P0 | — | FR-01, FR-02, D-001@v1, D-004@v1 | embedding_worker.py 三闸自灭+代理+config 三键+LRU 上限+新测试 |
| task-02 | spec 包缓存全局字节帽 | W2 | P0 | — | FR-03, D-004@v1 | _bundle_gzip_cache 128MB LRU（config.py 与 task-01 跨 Wave 共享） |
| task-03 | 权限定时器会话治理 | W1 | P0 | — | FR-04, D-004@v1 | _on_timeout 新短会话+全路径提交+事务边界收窄+回归 |
| task-04 | ws_hub 泄漏修复与身份校验 | W2 | P0 | — | FR-05, D-004@v1 | _pending_rpcs 两径清理+disconnect 身份校验+回归 |
| task-05 | 附件预检+日志截断 | W1 | P1 | — | FR-06, D-004@v1 | size 预检 413+WS 消息日志 8KB 截断 |
| task-06 | change-write WS 推送 backend 侧 | W3 | P0 | task-04 | FR-07, D-001@v1 | protocol 常量+notify helper（daemon_id 解析）+四落库点接线+notify 单测（扩展 test_ws_hub.py） |
| task-07 | change-write WS 推送 daemon 侧 | W4 | P0 | task-06 | FR-07, FR-08, D-001@v1 | protocol.ts 对齐+分发+独立 120s 兜底+契约测试 |
| task-08 | title_fallback 持久化 | W2 | P0 | — | FR-09, D-001@v1 | 列+迁移回填（哨兵''）+列表读列自愈+测试 |
| task-09 | 部署配额与保护 | W3 | P1 | — | FR-10, D-001@v1 | compose 配额 1.85G+oom_score_adj+entrypoint 兜底+部署文档 |
| task-10 | 服务器部署实测 | W5 | P0 | task-01..task-09 | 全 FR 实证 | 打包部署+内存/轮询/查询/idle-txn 四指标实测 |

## 关键路径
task-01 → task-04 → task-06 → task-07 → task-10（WS 推送协议链 + 部署实测，最长路径）

## 全局硬约束（从 design.md 逐字抄录，绑定所有 task）
- 代码实现必须兼容 Windows、Linux 和 macOS（CLAUDE.md 规则 13）：子进程 /proc/self/oom_score_adj 写入在 Windows/macOS MUST fail-soft 跳过；stdin 等待用读线程实现（Windows 无 select-on-pipe）
- 嵌入子进程失败 MUST NOT 回退为进程内加载（回退=回归 reopening）；fail-soft 语义与现状模型缺席一致
- REST API 面零变化（OpenAPI 不变，无 gen:types 义务）；WS 消息 payload：{runtime_id, workspace_id}（workspace_id 恒携带、可为 null）
- 配置默认值精确：idle_exit_sec=900 / index_max_ws=4 / bundle_cache_max_bytes=128MB / change_write_poll_interval=120 / 硬寿命帽 60min / 日志截断 8KB
- 配额精确值：backend 1100m+oom_score_adj:-500、frontend 300m、minio 128m、redis 64m、postgres 256m（总和 1848m）
- title_fallback 三态：NULL=未计算、''=已计算无预览（哨兵）、非空=预览；title 列语义不动
- 推送 best-effort：离线 debug 日志、不阻塞、不重试——兜底轮询永在
- 错误文案/日志中文优先；WS 消息常量双端逐字对齐 daemon:change_write_available

## 全局验收标准
1. 所有单元测试通过（backend pytest 相关模块 + daemon vitest + tsc）
2. 集成冒烟：本地起 dev 栈后知识搜索向量路径可用（子进程拉起/退出）、change-write 推送端到端（backend 推→daemon 拉取）
3. （brownfield）未配置新功能时行为不变：旧 daemon 兼容、嵌入失败词面兜底、列表 title 展示逐字节一致
4. 服务器实测四指标达标（task-10）：内存闲时回落、轮询 ~75% 降、列表毫秒级、idle-in-transaction 归零

## Review Focus 盲区清单（隐含面）
| # | 输入/条件 | 合理人预期行为 | 承接落点 |
|---|---|---|---|
| 1 | 旧 daemon 收到 daemon:change_write_available 未知消息 | default 分支 warn 丢弃不崩，兜底轮询继续（已代码证实 daemon.ts:7797-7799，测试锁定） | task-07（daemon-change-write-push.test.ts 反例用例） |
| 2 | 子进程冷启期间并发 embed 请求 | 串行化等待单例拉起，不重复 spawn 多个子进程 | task-01（test_embedding_subprocess.py 并发用例） |
| 3 | 零 user_input 会话进列表 | 哨兵 '' 回写后永不再触发收窄查询 | task-08（test_session_router.py 零输入用例） |
| 4 | 迁移窗口函数在 SQLite（测试库）/PG（生产）双方言 | 同口径回填（row_number 双方言已有先例 session_crud.py:336-365） | task-08（迁移测试用例） |
| 5 | gzip 缓存淘汰后并发 pull 同版本 | 未命中重打包，无竞态写坏（put 幂等覆盖） | task-02（缓存并发用例） |

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-06, task-07, task-08, task-09, task-10 | FR-01/07/08/09/10 测试 + 服务器实测 |
| D-002@v1 | —（rejected 防复潮） | 非目标"不改 Docker 拓扑"约束 |
| D-003@v1 | —（rejected 防复潮） | 全局硬约束"MUST NOT 回退进程内加载" |
| D-004@v1 | task-01, task-02, task-03, task-04, task-05 | FR-02/03/04/05/06 测试 |
