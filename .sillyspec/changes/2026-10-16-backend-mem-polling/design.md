---
author: qinyi
created_at: 2026-10-16 09:42:27
generated_by: sillyspec-design-init
scale: large
---

# 设计文档（Design）— 2026-10-16-backend-mem-polling

## 背景

生产服务器（阿里云 2 核 / 1.6G 内存）反复整机卡顿，2026-10-15 夜间 backend 容器被内核 OOM 强杀 7 次（23:14~01:32），每次重启后数小时内 RSS 从 324MB 涨至 400~750MB 直到再次撑爆。诊断与代码深扫定位为三层问题叠加：

1. **急性回归（主因）**：2026-10-15 部署的知识搜索变更把 fastembed ONNX 嵌入模型（`backend/app/modules/knowledge/vector_search.py:137-154` 的 `get_embedder` 进程级单例）加载进 backend 进程且永不释放（ONNX arena 棘轮）；同文件 `:168-171` 的 `_indexes` 进程内索引跨工作区无上限无 TTL（每 ws 11~40MB 永驻），指纹失配触发全语料重嵌。
2. **慢性内存缺陷**：`backend/app/modules/spec_workspace/service.py:186-221` `_bundle_gzip_cache` 跨工作区无全局上限（~18MB/ws）；`backend/app/modules/daemon/permission_service.py:1543-1648` 权限 5 分钟超时定时器 pin 已关闭的 AsyncSession、超时回调在关闭 session 上重开事务且 `route_key is None` 路径不提交——生产 postgres `idle-in-transaction FATAL` 直接元凶；`backend/app/modules/daemon/ws_hub.py:594-647` `_pending_rpcs` 两条泄漏路径 + `:114-131` `disconnect()` 无连接身份校验（重连风暴自我放大器）；`backend/app/modules/session_attachment/router.py:61` 附件先整读后校验。
3. **慢性负载**：daemon change-write 走 30s 硬轮询（`sillyhub-daemon/src/daemon.ts:6175`，注释明确"protocol 无 change-write 消息类型、30s 轮询是唯一分发通道"）；会话列表 `GET /api/daemon/sessions?limit=500`（`backend/app/modules/daemon/router/session_crud.py:336-365`）对 `agent_run_logs` 做窗口函数派生标题，生产实测 1.4s（2026-09-09 曾 3.1s，已优化一轮仍随日志量线性）。

部署侧：容器内存配额总和 2.1G > 物理 1.6G（超卖），backend 撑顶时整机陷入 swap 抖动。

## 设计目标

1. backend 稳态内存可控：嵌入模型内存"用时有峰、闲时归零"（进程退出式确定性释放），两处无界缓存加上限，session 泄漏路径收口——目标 1.6G 机器上 backend 稳态 RSS 回落后不再单调爬升至 OOM。
2. 轮询负载减半以上：change-writes 改 WS 事件推送分发，30s 轮询降级为 120s 兜底，稳态请求率降 ~75%。
3. 会话列表查询毫秒级：标题预览持久化为列，列表路径消窗口函数。
4. 部署配额去超卖：容器配额总和 2.14G → 1.85G（1100m+300m+128m+64m+256m=1848m）。

## 非目标

- 不升配硬件、不改 Docker 拓扑（不加 sidecar 容器）、不改 nginx。
- 不动前端代码与会话列表交互（已有 SSE 事件流维持现状）。
- 不动知识搜索 pgvector 的表结构与检索语义（向量已在 PG，只治理进程内 embedding 与 CLI 端点索引缓存）。
- 不改 lease/controls 既有分发机制（leases 已有 WS 门控跳过、controls 搭心跳，行为良好）。
- 不清理 agent_run_logs 历史数据（归档策略另议）。

## 拆分判断

四组改动共享同一动机（服务器卡顿根治）且互相独立可验证，但统一在本变更内交付：拆开会导致"内存修了但轮询还在打"的半根治状态多次部署验证（小内存服务器每次部署都触发重连风暴，见背景）；单变更四 Phase 顺序执行、一次部署实测收口。

**Wave 证据（scale=large）**：四个文件簇互不相交、可真并行——簇 A=backend 内存治理（knowledge/spec_workspace/permission_service/ws_hub/session_attachment/gateway_misc 及其测试）；簇 B=change-write WS 推送双端（backend protocol+四落库点 ↔ daemon protocol/daemon.ts/config.ts 及测试）；簇 C=title_fallback 持久化（agent/model.py+迁移+session_crud）；簇 D=部署配额（compose/entrypoint/部署文档）。合计 27+ 文件的读改测加部署实测，超出单会话上下文舒适吞吐（本会话还承载完整诊断上下文），需 plan 阶段编排。

## 总体方案

### Phase 1：内存治理

**1a. 嵌入计算子进程封装**（`get_embedder` 单一收口，平台 pgvector 路径与 CLI vector-search 端点同时受益）：

- 新增 `backend/app/modules/knowledge/embedding_worker.py`：独立 Python 子进程，加载 fastembed 模型，stdin/stdout 按行 JSON 协议（`{"id": ..., "op": "embed", "texts": [...]}` → `{"id": ..., "ok": true, "vectors": [[...], ...]}`）。
- 三闸自灭（非功能生命周期）：①闲置闸——15 分钟（可配 `KNOWLEDGE_EMBEDDING_IDLE_EXIT_SEC`，默认 900）无请求自写 exit；②父进程闸——stdin 读到 EOF（父进程死亡/关闭管道）立即退出；③硬寿命帽——连续运行 60 分钟无条件退出（防未预见泄漏）。
- 子进程启动时把自身 `oom_score_adj` 重置为 0（子进程会继承父进程的保护分，必须显式重置；**Windows/macOS 无 /proc——重置动作 fail-soft**：写失败仅 debug 日志跳过，三平台兼容）。主进程保护经 compose `oom_score_adj: -500` 服务级设置（docker compose v2 支持，免 entrypoint CAP_SYS_RESOURCE 权限问题）；`backend/docker-entrypoint.sh` 保留 try-best 兜底（写失败仅告警不阻塞）——内存告急时内核优先牺牲嵌入子进程，主服务存活。
- 子进程 spawn 失败沿用现有失败原因缓存语义（缓存到换模型为止）；运行中崩溃由代理自动重启，**连续 3 次崩溃**后标记不可用并退避 10 分钟再试（防崩溃循环烧 CPU）。
- 子进程 stdin 等待用**读线程**实现（Windows 无 select-on-pipe，跨平台用专用线程阻塞读 + 主循环空闲计时；三平台兼容，CLAUDE.md 规则 13）。
- `vector_search.py` 的 `get_embedder` 返回 `EmbeddingSubprocessProxy`（透明代理：embed() 经管道往返，接口签名不变）；子进程 spawn 失败/连续崩溃 → 与今天模型缺席同语义 fail-soft（`model_ready=false` + 词面兜底），**不回退进程内加载**（回退=回归 reopening）。
- `_indexes` 缓存加 LRU 上限：`KNOWLEDGE_EMBEDDING_INDEX_MAX_WS`（默认 4 个工作区），超限淘汰最久未用。

**1b. spec 包缓存全局帽**：`_bundle_gzip_cache` 加总字节上限 `SPEC_BUNDLE_CACHE_MAX_BYTES`（默认 128MB）LRU 淘汰，per-ws 2 版本保留策略不变。

**1c. 权限定时器会话治理**：`permission_service.py` `_on_timeout` 不再复用外层已关闭的 session——回调内经 `session_factory()` 开新短会话，全部路径（含 `route_key is None` 早退）显式 commit/rollback 后关闭；`enqueue_and_push` 的事务边界收窄（commit 落 pending 行后再做 WS 推送，推送移出事务）。

**1d. ws_hub 修复**：`send_rpc` 的 `CancelledError` 分支补 `_pending_rpcs` 清理；`resolve_rpc` 对 done future 早退前先 pop 条目；`disconnect()` 加连接身份校验（仅当传入 ws 与注册表中当前 ws 同一实例才 pop，对齐 `_evict_stale` 先例）。

**1e. 杂项**：`session_attachment/router.py:61` 上传先读 `UploadFile.size`（Starlette 预知大小）超限 413 再读内容；`gateway_misc.py:530-534` WS 大消息日志截断（超 8KB 只记前后 4KB + 总长标注）。

### Phase 2：change-writes WS 推送

- `backend/app/modules/daemon/protocol.py` 新增消息常量 `DAEMON_MSG_CHANGE_WRITE_AVAILABLE = "daemon:change_write_available"`，payload `{runtime_id, workspace_id}`（workspace_id 恒携带、可为 null 的 UUID；轻通知，不带任务体）。
- `DaemonChangeWrite` pending 行的**全部四个落库点**（`change/service.py:828` 新建、`change/service.py:821-826` match 更新路径刷新既有行、`change_writer/proxy.py:410`、`spec_workspace/router.py:217`）事务提交后经新共享 helper `notify_change_write_available(session, runtime_id)` 推送——helper 内先经 `_resolve_daemon_id_for_runtime(session, runtime_id)`（`agent_task_store.py:129` / `lease_service.py:686` 现成先例）解析 daemon_id，再按 ws_hub 连接注册表定向发送（best-effort：daemon 离线仅 debug 日志，兜底轮询仍在）。
- daemon 侧 `protocol.ts` 对齐新消息类型；`daemon.ts` WS 分发收到通知即调既有 `getPendingChangeWrites` 立即拉取（复用幂等拉取，不在 WS 上传任务体）。
- 兜底轮询独立配置：`config.ts` 新增 `change_write_poll_interval`（默认 120s，原 30s 逻辑与 `poll_interval` 解耦），`_pollLoop` change-write 分支改用新间隔。

### Phase 3：会话标题预览持久化

- `agent_sessions` 加 `title_fallback` 列（String(64) nullable，chat 会话首条 user_input 前 30 字的服务端缓存；`title` 列语义不动——tool_report 自动标题与 NULL 派生路径保持）。
- 列语义三态：`NULL`=未计算（迁移前/漏网，需惰性计算）；`''`=已计算但该会话无 user_input（哨兵，防止零输入会话每轮列表重查）；非空=预览文本。
- 迁移一次性回填存量（SQL 窗口函数服务端执行，与现 router 查询同口径——`session_crud.py:336-365`）；零 user_input 会话回写哨兵 `''`。
- `session_crud.py` 列表路径：`title = item.title or item.title_fallback`；仅对 `title IS NULL AND title_fallback IS NULL` 的漏网会话跑一次收窄版窗口查询并**回写列或哨兵**（自愈，之后永不再查）。

### Phase 4：部署配额

- `deploy/docker-compose.yml`：backend 1100m 维持（嵌入子进程峰值在其内）+ 服务级 `oom_score_adj: -500`；frontend 400m→300m、minio 256m→128m、redis 128m→64m；postgres 256m 维持。配额总和 2.14G→1.85G。
- 部署文档（`deploy-to-server` skill 常见坑）补：服务器建议 `vm.swappiness=10`（sysctl 手动操作，不入库）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | NEW:backend/app/modules/knowledge/embedding_worker.py | 嵌入子进程：模型加载 + 行协议 + 三闸自灭 + oom_score_adj 自重置 |
| 修改 | backend/app/modules/knowledge/vector_search.py | get_embedder 返回子进程代理（接口签名不变）；_indexes 加 LRU 工作区上限 |
| 修改 | backend/app/core/config.py | 新配置键：KNOWLEDGE_EMBEDDING_IDLE_EXIT_SEC(900)/KNOWLEDGE_EMBEDDING_INDEX_MAX_WS(4)/SPEC_BUNDLE_CACHE_MAX_BYTES(128MB) |
| 修改 | backend/app/modules/spec_workspace/service.py | _bundle_gzip_cache 全局字节帽 LRU 淘汰 |
| 修改 | backend/app/modules/daemon/permission_service.py | _on_timeout 新开短 session + 全路径 commit/rollback；enqueue_and_push 事务边界收窄 |
| 修改 | backend/app/modules/daemon/ws_hub.py | _pending_rpcs 泄漏两径清理；disconnect 连接身份校验 |
| 修改 | backend/app/modules/daemon/router/gateway_misc.py | WS 大消息日志截断 |
| 修改 | backend/app/modules/session_attachment/router.py | 上传先查 size 超限 413 再读内容 |
| 修改 | backend/app/modules/daemon/protocol.py | 新消息常量 DAEMON_MSG_CHANGE_WRITE_AVAILABLE |
| 修改 | backend/app/modules/daemon/ws_hub.py（同上文件，另一处） | 新增 notify_change_write_available 定向推送 helper（producer=三创建点 commit 后调用 → 消费方=daemon WS 分发） |
| 修改 | backend/app/modules/change/service.py | DaemonChangeWrite 新建（:828）与 match 更新（:821-826）两处 commit 后推送通知 |
| 修改 | backend/app/modules/change_writer/proxy.py | DaemonChangeWrite 创建后（:410）commit 后推送通知 |
| 修改 | backend/app/modules/spec_workspace/router.py | DaemonChangeWrite 创建后（:217）commit 后推送通知 |
| 修改 | backend/app/modules/agent/model.py | AgentSession 加 title_fallback 列（String(64) nullable） |
| 新增 | NEW:backend/migrations/versions/20261016100000_agent_session_title_fallback.py | 加列 + 存量窗口函数回填（一次性服务端执行） |
| 修改 | backend/app/modules/daemon/router/session_crud.py | 列表读 title_fallback；漏网会话收窄查询 + 回写（自愈） |
| 修改 | backend/docker-entrypoint.sh | oom_score_adj try-best 兜底（主保护经 compose 服务级设置） |
| 修改 | deploy/docker-compose.yml | mem_limit 重分配（2.14G→1.85G）+ backend oom_score_adj: -500 |
| 修改 | sillyhub-daemon/src/protocol.ts | 新消息类型 CHANGE_WRITE_AVAILABLE 与 payload 类型（与 backend 逐字对齐） |
| 修改 | sillyhub-daemon/src/daemon.ts | WS 分发新消息→立即 getPendingChangeWrites；_pollLoop change-write 分支改用独立间隔 |
| 修改 | sillyhub-daemon/src/config.ts | 新增 change_write_poll_interval 默认 120 |
| 新增 | NEW:backend/app/modules/knowledge/tests/test_embedding_subprocess.py | 子进程封装测试（行协议/三闸自灭/失败 fail-soft/连续崩溃退避/oom_score_adj 重置 fail-soft） |
| 修改 | backend/app/modules/daemon/tests/test_ws_hub.py | _pending_rpcs 清理与 disconnect 身份校验回归 + notify_change_write_available 单测（离线 debug 日志/daemon_id 解析/best-effort 不抛） |
| 修改 | backend/app/modules/daemon/tests/test_permission_http_uplink.py | _on_timeout 新 session + 全路径 commit 回归 |
| 修改 | backend/app/modules/daemon/tests/test_session_router.py | title_fallback 读列/零输入哨兵/漏网自愈用例 |
| 修改 | sillyhub-daemon/tests/protocol.contract.test.ts | 新消息类型双端契约测试 |
| 修改 | sillyhub-daemon/tests/config.test.ts | change_write_poll_interval 默认值测试 |
| 新增 | NEW:sillyhub-daemon/tests/daemon-change-write-push.test.ts | WS 推送分发→立即拉取 + 旧 backend 纯兜底轮询测试 |
| 修改 | .zcode/skills/deploy-to-server/SKILL.md | 常见坑补 vm.swappiness=10 建议 |

数据流标注（新增对外字段）：WS 消息 `daemon:change_write_available`——producer=backend 四落库点（commit 后经 ws_hub 定向发送，payload `{runtime_id, workspace_id}`）→ 消费方=sillyhub-daemon `daemon.ts` WS 分发（protocol.ts 类型对齐）→ 动作=调既有 `getPendingChangeWrites(rid)` REST 拉取。REST API 面零新增零修改（OpenAPI 不变，无需 gen:types）。配置键均为服务端/daemon 侧环境变量，不入 OpenAPI。

## 接口定义

**无 REST 端点新增/修改**（OpenAPI 零变化，api-types 无需重生成）。

1. WS 协议消息（backend `protocol.py` ↔ daemon `protocol.ts` 双端 1:1）：
   - 常量：`DAEMON_MSG_CHANGE_WRITE_AVAILABLE = "daemon:change_write_available"` / `MSG.CHANGE_WRITE_AVAILABLE = 'daemon:change_write_available'`
   - payload：`{"type": "daemon:change_write_available", "runtime_id": "<uuid>", "workspace_id": "<uuid|null>"}`；daemon 侧 handler 校验 runtime_id 非空，非法丢弃 warn（对齐 tombstone 分发先例）。
2. 嵌入子进程行协议（`embedding_worker.py`，私有协议不经网络）：
   - 请求：`{"id": int, "op": "embed", "texts": [str, ...]}\n`
   - 响应：`{"id": int, "ok": true, "vectors": [[float, ...], ...]}\n` 或 `{"id": int, "ok": false, "error": str}\n`
   - 生命周期：stdin EOF → exit(0)；闲置 `idle_exit_sec` → exit(0)；运行满 60min → exit(0)。
3. 代理类：`class EmbeddingSubprocessProxy: def embed(self, texts: list[str]) -> list[list[float]]`（同步签名与 FastembedEmbedder 一致，调用点零改动）；`get_embedder(model_name) -> tuple[EmbeddingSubprocessProxy | None, str | None]` 签名不变。
4. 配置键（Settings 字段 / daemon config）：见文件变更清单 config.py 行；daemon `change_write_poll_interval: number`（默认 120，秒）。

## 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| change_write_available 推送（新增） | backend（三创建点 commit 后） | daemon（WS 分发） | runtime_id, workspace_id? | 无状态翻转（通知触发拉取） |
| pending change-writes 兜底轮询（改动=间隔 30s→120s） | daemon（_pollLoop） | backend（GET pending-change-writes） | runtime_id | 行状态不变（读 pending） |
| claim / complete change-write（存量不动） | daemon | backend | task_id, token / status | pending→claimed→completed |

lease/session/heartbeat 生命周期事件全部存量不动（leases WS 门控、controls 心跳搭车维持现状，见非目标）。

## 数据模型

`agent_sessions` 新列 `title_fallback VARCHAR(64) NULL`：

- 写入：迁移一次性回填（窗口函数按 `(timestamp asc, id asc)` 取每会话首条 `channel='user_input'` 的 `substr(content_redacted,1,64)`，与 `session_crud.py:294-321` 现口径一致）；此后由列表路径惰性回写自愈。
- 读取：`list_sessions` 组装 `title = title or title_fallback or（漏网收窄查询+回写）`。
- `title` 列语义不变（tool_report 自动标题；chat 恒 NULL 走派生——派生结果现落 title_fallback）。

## 兼容策略（brownfield 必填）

1. **旧 daemon + 新 backend**：旧 daemon 不识别 `daemon:change_write_available`——WS 分发按未知类型 warn 丢弃（daemon.ts 分发 switch default 分支既有行为，execute 中以测试锁定）；change-write 分发退化为 120s 兜底轮询（原 30s 变慢，功能不丢）。
2. **新 daemon + 旧 backend**：无推送消息，纯兜底轮询 120s；行为=间隔变慢，功能完整。
3. **嵌入子进程失败**：与今天模型缺席同语义 fail-soft（`model_ready=false`、词面兜底、reason 标注），不回退进程内加载。
4. **未配置新配置键**：全部带默认值（900s / 4ws / 128MB / 120s），不配即启用治理后行为。
5. **title_fallback 回填失败/漏网**：列表路径收窄查询兜底 + 回写自愈，展示行为与现状逐字节一致。
6. **不改的 API/表**：REST 面零变化；`title` 列与 tool_report 写路径不动；lease/controls 分发不动。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 子进程封装后嵌入查询冷启动 1~3s（模型重新加载） | P2 | 闲置闸默认 15min 宽松；高频期不触发退出；仅低频服务器受益于内存归零 |
| R-02 | oom_score_adj 在容器内写 /proc 受限 | P2 | entrypoint 启动时探测写失败仅告警不阻塞（保护缺失=现状，非回归）；execute 中容器内实测验证 |
| R-03 | 推送消息旧 daemon 分发行为未逐字验证（假设 default 分支忽略） | P1 | execute 首个任务先写"旧 daemon 收到未知消息"回归测试锁定，假设不成立则 payload 加版本门 |
| R-04 | title_fallback 迁移在大表上回填耗时锁表 | P2 | 项目未上线允许维护窗口；回填分批（按 id 区间）+ 会话量级当前有限 |
| R-05 | permission_service 事务边界调整改动审批链路，回归面大 | P1 | 全路径单测（超时/应答/route_key None/通知失败四态）+ 既有 permission 测试套件全绿门槛 |
| R-06 | ws_hub disconnect 身份校验改变断连语义 | P1 | 对齐 _evict_stale 既有先例；WS 重连套件回归 |
| R-07 | 配额调低致 frontend/minio 高峰被限 | P2 | 实测用量远低于新配额（83M/40M vs 300M/128M）；服务器监控一个部署周期后复核 |
| R-08 | 子进程三平台兼容（Windows/macOS 开发机） | P1 | /proc 写入 fail-soft 跳过；stdin 等待用读线程（非 select）；CI 三平台跑 daemon/backend 测试 |

## 非功能生命周期

本变更引入**嵌入子进程**（长驻候选 + 持有模型内存 + stdin/stdout 管道）——三闸自灭：

1. 闲置闸：15min（可配）无 embed 请求 → 子进程主动 exit；
2. 父进程闸：stdin EOF（父死亡/管道关）→ 立即 exit；
3. 硬寿命帽：连续运行 60min → 无条件 exit。

父环境消失后靠闸 2 自灭（不依赖 spawn 侧环境变量）；代理侧子进程退出后下一请求重新拉起（幂等）。WS 推送 helper 无新建常驻任务（同步发送 + 离线丢弃）；permission 定时器存量 5min 生命周期不变，仅治理其 session 持有。

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 方案 A 四机制 | 总体方案 Phase 1-4 全文；文件清单 | 已覆盖 |
| D-002@v1 rejected（sidecar 容器） | 非目标"不改 Docker 拓扑" | 已覆盖（防复潮） |
| D-003@v1 rejected（进程内缓解） | Phase 1a"不回退进程内加载"；兼容策略 3 | 已覆盖（防复潮） |
| D-004@v1 三处高危纳入 | Phase 1a 索引帽 / 1b 缓存帽 / 1c 权限会话治理 + 1d/1e | 已覆盖 |

多裁定组合推演：本变更四条 confirmed 决策互不约束（D-001 选路线、D-004 定任务面，无状态升降/回退路径交叉）——**无组合约束**。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/生命周期契约表/数据模型/兼容策略/风险登记/非功能生命周期/决策追踪）
- [x] frontmatter 字段齐全（author/created_at/scale——scale 留空待 Step 8 评估落值）
- [x] 引用所有当前版本 D-001@v1~D-004@v1
- [x] 涉及 daemon/lease/heartbeat 关键词 → 生命周期契约表已含（新增推送事件 + 改动轮询 + 存量不动行）
- [x] UI 原型：不涉及前端文件，跳过原因=前端零改动（见非目标）
- [x] 文件清单路径已逐一核准（NEW: 前缀用于新建文件；其余为仓内已存在文件）
- [x] 不确定问题标注：「⚠️ 自审存疑」无——R-03 的旧 daemon 未知消息行为已由 Design Grill 独立审查代码证实（daemon.ts:7797-7799 default 分支 warn 丢弃）
- [x] Design Grill 修正回填：锚点 :294-321→:336-365（两处）、配额 1.75G→1.85G 算术修正、workspace_id 恒携带可空、notify 签名补 daemon_id 解析、零输入会话哨兵 ''、match 更新路径补第四通知点、spawn 失败缓存与连续崩溃退避、compose oom_score_adj 主路径 + entrypoint 兜底、R-08 三平台兼容、测试文件与部署文档补入清单
