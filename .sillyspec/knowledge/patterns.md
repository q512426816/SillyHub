---
author: qinyi
created_at: 2026-06-23 02:00:00
---

# 可复用模式 (Patterns)

## Monorepo 三服务架构

```
frontend (Next.js, 浏览器)
    │  REST / SSE / WebSocket
    ▼
backend (FastAPI)  ◄──── HTTP/WS ────►  sillyhub-daemon (Node, 本地守护进程)
    │                                          │
    ▼                                          ▼
PostgreSQL + Redis                    本地 Claude 进程 (Claude Agent SDK)
```

- **backend**：中心 API 服务，持久化（PG）、消息（Redis Pub/Sub）、对外 REST/SSE/WS
- **sillyhub-daemon**：运行在用户本机，受 backend 调度管理本地 Claude 进程的生命周期（lease/heartbeat/complete），通过 HTTP/WS 与 backend 通信
- **frontend**：纯消费 backend API 的 Web 界面
- 部署：`deploy/docker-compose.yml` 编排三服务（dev 用 `docker-compose.dev.yml`）

## Backend 模块组织

backend 源码分两层（`backend/app/`）：
- `app/core/` — 基础设施：config / database / redis / security / auth / logging / telemetry / errors / audit / paths
- `app/modules/<domain>/` — 业务模块，每个模块内含 `router.py`（FastAPI APIRouter）+ service + model

FastAPI app 在 `app/main.py` 创建，所有 router 以 `prefix="/api"` 挂载（workspace / members / auth / health / qc 等）。

## 子项目间通信

- frontend → backend：REST（`/api/*`）+ SSE（流式日志）+ WebSocket
- backend → daemon：HTTP（下发任务）+ WS（lease 心跳、消息回传）
- daemon → 本地 Claude：Claude Agent SDK（spawn 子进程 + stdio）

## AgentRun + DaemonTaskLease 编排流程

交互式/任务式 agent 执行的统一编排链路：

```
backend 创建 AgentRun（持久化运行记录）
   │  + DaemonTaskLease（领租约：daemon 认领任务、心跳续约、complete 回收）
   ▼
daemon 收到 lease → claude-agent-sdk 的 SessionManager.create()/执行
   │  （interactive session 支持多轮 + persistence/recovery）
   ▼
daemon 执行输出经 adapters/ 协议解析 → WebSocket / hub-client 回传 backend
   │  backend 写 AgentRunLog（三层日志：daemon/backend/前端）
   ▼
backend 标记 AgentRun 完成 / daemon 释放 Lease
```

- backend 是编排中枢（建 run + lease、收消息、写日志），daemon 是执行体（SDK 调 Claude）。
- 改 agent 执行链路（新增 provider、改 lease 心跳、改日志回传）时沿此链路定位各环节，别只改一端。
- 与「三服务架构」互补：前者讲静态拓扑，本条讲运行时编排时序。

## daemon adapters/ 多协议抽象（stream-json / json-rpc / jsonl / ndjson / text）

`sillyhub-daemon/src/adapters/` 用统一 `ProtocolAdapter` 接口抽象 5 种 CLI 进程输出协议：`stream-json`（Claude/Codex 主用）、`json-rpc`、`jsonl`、`ndjson`、`text`（纯文本兜底）。
- 每个 provider 对应一种协议，`ProtocolAdapter` 把字节流解析成统一消息事件喂给上层。
- 新增 agent provider（如新 CLI）：在 `agent-detector.ts` 注册检测 + 在 adapters/ 复用或新增对应协议 adapter，别在调用方散写解析。
- 协议解析与上层编排（AgentRun/Lease）解耦，是 daemon 处理多 provider 输出的扩展点。

## 平台文件中心：对象存储抽象（StorageBackend + factory + MinioBackend）

`backend/app/modules/storage/` 是平台文件中心的存储底座（无 router、无表），把「对象存到哪 / 怎么存 / 怎么读」抽象成一套可替换后端，业务侧（`file` 模块）只依赖接口。新增存储后端（OSS 等非 MinIO）或改文件中心存储链路时沿此抽象走，别在业务代码散写 S3 调用。

- **抽象基类 `StorageBackend`**（`storage/base.py`）定义五个能力：`put_object(key, data, content_type)`、`get_object_stream(key)`（异步迭代器、按块流式、声明为非 `async def` 以兼容异步生成器与 mock 迭代器两种实现）、`delete_object(key)`、`head_object(key) -> ObjectStat(size, content_type)`、`aclose()`。`key` 由上层 `file` 模块生成（格式 `YYYY/MM/{uuid}{.ext}`），storage 层只把它当不透明存储键透传，不假设文件命名 / 业务语义。
- **工厂选后端 `factory.py`**：`init_storage_backend(settings)` 在应用 lifespan startup 调一次，按 `settings.storage_backend` 建实现并缓存为模块级单例（重复调用幂等返回）；`_build(settings)` 是分发器，目前仅 `minio` 分支，**新增 OSS 等后端在此加分支**；`get_storage_backend()` 是 FastAPI Depends 注入点（单例未初始化时按当前 `get_settings()` 兜底建一个，避免 None）。
- **MinIO 实现 `MinioStorage`**（`minio_backend.py`）：基于 **aiobotocore**（S3 兼容异步客户端，对齐 asyncpg/httpx 异步栈），模块级 session 复用、每次 IO 经 `_client()` 上下文管理器创临时 client；首个 `put_object` 前 `_ensure_bucket()` 自动建 bucket（`create_bucket` 失败一律吞掉做幂等，`_bucket_ready` 标志位只执行一次）；流式下载用 `resp["Body"].iter_chunks(1MB)`。
- **测试不碰真实 MinIO**：`file` 模块单测经 `app.dependency_overrides[get_storage_backend]` 注入 `MockStorage`（内存实现 StorageBackend）。新增存储相关测试走同一注入路径，禁止直连真实 MinIO。
- **新增后端清单**：实现 `StorageBackend` 五方法 + 在 `_build` 注册分支 + 对齐 `aclose` / 流式读语义（尤其 OSS 等非完全 S3 兼容实现），业务代码零改动。

**file 模块使用 storage 的一致性顺序约束**（改 `file` 服务或新增同类「DB 元数据 + 外部对象」模块必守）：
- 软删：**先 commit DB 软删标记，再删对象本体**（反序 commit 失败会留下指向已删对象的 active File，下载 404 损坏功能——宁可留孤儿对象不可损坏下载）。删对象失败仅记日志、仍标软删防重复。
- 上传：`storage.put_object` 写对象 → DB commit；commit 失败时 **best-effort 补偿删除已写对象**（失败仅记日志、不掩盖原异常），避免孤儿对象堆积。
- 下载：`Content-Disposition` 用 RFC 5987 `filename*` 承载中文原名 + ASCII `filename` 回退；仅 `image/jpeg|png|gif|webp` 白名单 `inline`，其余（含 svg/html）强制 `attachment`，配合上传白名单排除 `text/html`/`image/svg+xml` 防 XSS。

## 四轨鉴权 token 分轨：JWT / shk_live_ / shpsync_ / shmcp_

平台四条互不复用的鉴权轨，按 token 前缀分流，各有专属通道：

| 轨 | 前缀/形式 | 通道 | 用途 |
|---|---|---|---|
| JWT | Bearer | `/api/*` 浏览器会话 | 登录签发 + refresh 轮换 |
| API Key | `shk_live_`（X-API-Key header） | `/api/*` | daemon 与脚本长期凭证 |
| 同步 token | `shpsync_` | platform_sync 端点 | SillySpec CLI/daemon 进度与 spec 文件回传**唯一写通道**，绑 user+workspace |
| MCP token | `shmcp_` | `/mcp` 子应用（与 /api 鉴权物理隔离） | 第三方 MCP client，scope ∈ read/dispatch/converge |

- **写通道按前缀硬校验**：凭据有效但非 shpsync_ 打 platform_sync 写通道 → 403（无凭据才是 401）；mcp_gateway 只认 shmcp_。跨轨 token 不互认，别为图省事复用。
- workspace_id 从 shpsync_ token 派生（服务层不重复校验），改 platform_sync 端点时不要再手传/手校 workspace_id。
- shmcp_ 的 McpToken 必须由真实用户签发（绑 user）；给 daemon 配 local.yaml 的 mcp 段时用非用户签发的 token，派发时会报错。
- `core/auth_deps.get_current_principal` 只覆盖 JWT/APIKey 双路径，两条专用轨各自独立鉴权。新增服务间通道时按前缀建新轨并配独立鉴权依赖，勿挂在 get_current_principal 下加例外。
- 依据：`.sillyspec/docs/SillyHub/flows/auth.md`（2026-08-18 重扫）。

## platform_sync 两套乐观锁语义：base_ts 字典序与 base_version 整数版本

平台同步层有两套冲突检测协议，**别混用**：

- **进度上行（base_ts，platform_sync.upsert_progress，POST /changes/{name}/progress）**：CLI 带 last_pushed_at 基线上行，平台按 ISO 8601 UTC **字符串字典序**比对（不转 datetime，故该列存 String 而非 DateTime）。`stored > base_ts` 判冲突 → 返回平台侧 latest_progress，**不改任何数据**；base_ts 空/缺失 → 无条件接受（首次同步/无基准）。
- **spec 文件 ops（base_version，spec_workspace.apply_ops）**：整数版本比较；`version != base_version` 且 hash 不同 → 该 op 跳过 + conflict=True + 返回 server_versions。platform_sync 对文件 ops 只透传，冲突逻辑在 spec_workspace。

改任何同步冲突行为前先分清层：进度冲突在 platform_sync、文件冲突在 spec_workspace；两边失败语义也不同（进度=只读返回不写；文件=单 op 跳过其余照落）。依据：`.sillyspec/docs/SillyHub/glossary.md` 乐观锁词条、`.sillyspec/docs/backend/modules/platform_sync.md`。

## Spec 文件增量同步协议：manifest 比对 + FileOp 上行 + apply_ops 单写者

CLI/daemon 与平台之间的 spec 文件树同步是**服务器权威增量**（2026-08 起，替代旧「整树 tar 全量覆盖无冲突检测」），三步：

1. `GET /changes/-/spec-manifest`（Bearer shpsync_）拉服务器全量清单——per-file content_hash + version，**含 exists=False 软删行**（据此识别服务端已删文件并对齐下发 delete）。
2. daemon/CLI 本地扫描 spec 树与清单逐文件 hash diff，算 FileOp ops（add/update/delete/rename，各带 base_version）；hub 404（服务器无清单）→ 首推全量。
3. `POST /changes/-/spec-sync {ops[]}` 单事务全成全败，apply_spec_ops 落盘。

apply_ops（spec_workspace，SpecFileManifest **唯一写者**）关键语义，新增同步行为时勿破坏：

- 预校验全部 op 路径 containment + `.runtime` 排除 → 越界 422 **整体不落盘**。
- `local.yaml` 写 op 静默丢弃（服务器排除项，幂等重推无副作用；delete 放行清存量行）。
- base_version 过期且 hash 不同 → conflict（**HTTP 仍 200**，返 server_versions 交 daemon 侧人工拍板）；**同 hash 豁免**为 no-op，不误报冲突。
- delete = move 到 `spec-backups/{ws}/{ts}/{path}` + exists=False 软删（30 天机会式修剪），不物理删。
- 落盘后事务外 best-effort 触发 change reparse：有 change_dirs 标注 → scoped；含 archive 路径 → 全量；无标注扫 ops 内 changes/ 前缀兜底；零 changes 路径零触发。

依据：`.sillyspec/docs/SillyHub/flows/spec-incremental-sync.md`。

## Daemon 代写队列：占坑 commit + lease-polling claim + GC 回灌

backend 无可达文件系统（daemon-client 唯一模式）时，「远端写盘」任务（建变更目录 / 变更文档在线编辑 / spec 整树回灌）经独立表 `daemon_change_writes` 下发 daemon 代写——**与 DaemonTaskLease 的 agent-run 语义分离**，不启动 agent。三类生产者：change_writer.proxy_create_change、change._enqueue_edit_write、spec_workspace.sync-manual（kind=spec-sync）。

并发正确性关键约定（改此链路勿破坏）：

- **占坑行先 commit 再建 write 行**：Change + ChangeDocument 行先落库钉住双表唯一键，防与 reparse 并发撞键 500。回执是异步跨请求的，**占坑-回滚不能并进单事务**（失败回滚用独立 session，显式删 docs 兼容 SQLite FK 关闭）。
- daemon 侧 lease-polling：GET pending → claim（claim_token 轮转；PG `SELECT ... FOR UPDATE SKIP LOCKED`，SQLite 退化事务内状态校验）→ 宿主写盘（**幂等覆盖写**）→ complete 回执；期间 report progress 刷新 claimed_at，防活跃任务被超时回收。
- **GC 回灌不置 failed**：claimed 超时（create/edit 60s；spec-sync 600s 独立长窗）→ 回灌 pending 自动重 claim 重做（写幂等无死循环）；GC 在 pending 端点顺带触发，无后台调度。
- 生产者轮询回执（周期 ≤1s）：done → 直接返回；failed / 超时 → 回滚占坑行 + 抛 ChangeWriteError（结构化 code 供前端 toast）。

依据：`.sillyspec/docs/SillyHub/flows/daemon-change-write.md`。

## 2026-06-22 — 单类巨石拆 facade+子包的 import 策略（避免 module-level 循环 / 跨域调用 / 测试 patch 跟随）

> 来源：2026-06-22-daemon-service-split（DaemonService 3324 行拆 runtime/lease/run_sync/session/patch 5 子包）。decisions.md D-005/D-006。

- **循环 import 坑**：facade 顶部模块级 `from .subpackage.service import SubService` + 子 service 顶部 `from .service import SomeError`（异常类暂留 facade）= 双向模块级循环，import 即 `ImportError`。
- **解法（D-005）**：facade `__init__` 内**函数级 lazy import** 子 service 类（router.py:624 同款模式），子 service 顶层 import facade 异常类。依赖单向（子→facade），循环解除。
- **跨域调用（D-006）**：子 service 调未迁/跨域方法持 `self._facade` 引用——facade `__init__` 构造子 service 后注入 `self._x._facade = self`，方法体 `self._facade.cross_domain_method()`。`TYPE_CHECKING` import facade 类型避免运行时循环。全部子域迁完后 facade 保留委托，引用继续兼容，**不耦合 Wave 顺序**。
- **测试 patch 跟随**：模块级符号（如 `get_redis`）从 facade 迁子 service 后，测试 `patch("...daemon.service.get_redis")` 失效，patch 目标必须跟随到子包模块（`...daemon.run_sync.service.get_redis`）。源码 API 零变化，仅 patch 物理位置变。
- **grep 调用点范围**：迁移方法时 grep 调用点必须搜 `router.py` + 全 `backend/app/` + `tests/`，不能只搜当前文件——router 可能直接调 service 私有方法。
- **异常类最终归位**：收尾阶段把异常类从 facade 迁各子包定义 + facade re-export（显式列出禁 `import *`），此时 facade 可模块级 re-export 子包符号（子包不反向 import facade，单向无循环）。
- **通用**：任何"单类拆子包 + facade 兼容（签名不变/router 零改动）"的重构适用此 import 策略组合。

## 2026-06-24 — Codex Interactive Session 沉淀的通用经验（provider-neutral driver）

> 来源：2026-06-23-codex-interactive-session（D-001@v1 ~ D-010@v1）。把单一 provider 的 interactive session 控制层抽象成 provider-neutral driver 的实践。

- **Provider driver 抽象（D-001@v1, D-009@v1）**：把 SessionManager 从「只驱动单一 provider SDK」改为「按 provider 选 driver」。`SessionManagerDeps.drivers: Partial<Record<'claude' | 'codex', InteractiveDriver>>`，driver 契约 provider-neutral（`start`/`consume`/`interrupt`），driver 内部各自做 provider 协议 ↔ provider-neutral `UserTurnInput` 转换。session 生命周期层不依赖具体 SDK 类型；新增 provider 只加 driver，不触碰 SessionManager 控制面。
- **Codex app-server stdio JSON-RPC 长驻 driver（D-002@v1, D-004@v1）**：`codex app-server --listen stdio://` 作为长驻子进程，driver 内做 `initialize` → `notifications/initialized` → `thread/start` → 串行 `turn/start`；`thread/resume(threadId)` 支持 reopen/recovery；消息映射成 flat message 上报 backend。interactive 与 batch 是**两套审批策略隔离点**，别共用审批状态。
- **Fail-closed 审批策略（D-006@v1, D-008@v1）**：provider-neutral server request 默认走 `PermissionResolver`，backend send 失败/超时/session 已结束/driver 被 interrupt 时返回 deny/cancel，**绝不无条件自动 accept**。权限 deny 时返回**空 profile**（不扩权），而非按请求 granted。
- **MCP elicitation 复杂场景如实标注（D-008@v1, D-010@v1）**：可归一化成现有 `AskUserDialogCard` 的简单 form/url 才阻塞等待用户；不支持的复杂 schema fail-closed 并上报 error，**不写成「全面支持 MCP elicitation」**。
- **缺 thread id 的 Codex session 不能伪造（D-007@v1）**：ended/failed Codex session 若缺 threadId，应显示失败且**不伪造新 thread**（避免历史串线）。

## 2026-06-24 — codex turn 收敛强契约：turn/completed 不可被 parse 吞信号

> 来源：ql-20260624-007-a9e3（json-rpc.ts parseTurnCompleted）。

- **turn/completed 是 codex 的 claude-result 等价收尾信号**：codex app-server 是被动 server，单 turn 完成后不自动 exit，**唯一**的单 turn 收尾信号就是 turn/completed notification。
- **强契约不可吞**：parseTurnCompleted 原在 `params.turn` 缺失/非 object 时 `return null`，把收尾信号当"非法 notification"吞掉 → complete event 不产出 → consume 卡在 `await currentTurnPromise` → `notifyRunResult` 永不执行 → backend AgentRun 永卡 active。对齐 claude：result 一到即 `onResult`，零吞信号；codex 同理：turn/completed 一到必产 complete event（params.turn 异常时降级 unknown→driver 转 failed 上报）。
- **为什么 claude 不卡、codex 卡**：claude 走 SDK 强契约（每 turn 必 yield result，generator 自然结束）；codex 靠自己 spawn+readline 解析 turn/completed 推断 turn 边界，信号被吞就永久挂起。
- **daemon-network-resilience 变更救不了这种卡死**：那个变更针对"回传调用失败"（notifyRunResult 调了但网络丢）；这里是"压根没调 notifyRunResult"。属更上游缺陷。
- 诊断兜底：codex 子进程 stdout 现已落盘 `~/.sillyhub/daemon/runs/codex-interactive/<sessionId>.log`，下次卡死秒级看 turn/completed 是否到达。
- 用户决策：**不加 turn 超时兜底**（会误杀推理模型正常长 turn），靠对齐 claude 强契约（不吞收尾信号）根治。

## aiosqlite 不支持 SELECT FOR UPDATE：并发唯一性守卫用部分唯一索引+IntegrityError 捕获

agent 模块测试跑 SQLite（aiosqlite），FOR UPDATE 语法不被支持（直接报错，不是静默忽略），需要并发防重的场景（如懒建 mission 防同 turn 双建）应：DB 层建部分唯一索引（WHERE 业务活跃条件）兜底 + 应用层捕获 IntegrityError 后 rollback 重查复用先到者。本仓先例：uq_agent_missions_session_active（20260822090000 迁移）+ mcp_tools 懒建守卫。来源：2026-08-22-team-session-unify task-05。

## Claude Agent SDK 0.3.181 的 task_* 生命周期系统消息可消费

SDK 0.3.181（捆 CLI 2.1.181+）运行时确实发射 `system/task_started`（task_id+tool_use_id+description+subagent_type）、`task_notification`（status:completed|failed|stopped + output_file，~64s 量级延迟）、`task_updated`（patch.status/end_time）与 `background_tasks_changed`；**task_progress 短任务零发射**（"正在做什么"展示需回退 transcript 推导）。消费点：session-manager `_onMessage` system 分支（2026-08-27-background-subagent-progress task-03），持久化方言 `[TASK_*]` stdout 单行 JSON 行带 parent_tool_use_id。（来源：同变更 task-01 spike 静态+动态双实证）

## 2026-08-27 — 会话 token 两套口径：计费量（跨调用可加）vs 上下文量（瞬时，取最近一次调用）

- **语义勘误**：Anthropic 原生 stream 事件里 `cache_read/cache_creation_input_tokens` 是**本调用**的缓存前缀量（replace 取最新 = 最近一次调用的缓存读取），不是"会话级累计快照"（ql-20260710-001 旧注释误读；batch stream-json.ts 实为 :498-511 逐调用 `+=`，:552/1143-1148 引用有误）。
- **SDK result usage 聚合口径**（7 会话 28 轮 DB 实证，spike-r09.md）：`SDKResultSuccess.usage.input_tokens` = 该 query 内 Σ 逐调用 input；跨轮不累计（与 daemon 会话累计计数器是两个量）。
- **设计教训**：上下文窗口用量（CtxUsageRing 分子）必须是"最近一次调用的 input+cache_read+cache_creation"（`AgentRun.ctx_tokens`，last-write-wins、终态不覆盖）；各轮 input_tokens 求和会跨轮重复计历史（6 轮 394 万 vs 200K 窗口爆表）。实时/终态口径必须同类（本轮计费量），否则轮结束数字跳变。
- 关联变更：2026-08-27-session-token-usage-fix（D-001@v2/D-006）。

## antd v6 App.useApp() 无 <AntdApp> provider 时 message 为 undefined——组件测试须包 AntdApp

组件内 `const { message } = App.useApp()` 在无 `<App>` provider 的测试环境（testing-library 裸 render）返回的 message 是 **undefined**（antd v6 无静态 fallback），点击路径调 message.success 抛 `TypeError: message.success is not a function`。生产有全局 AntdProviders 兜住；测试 render helper 统一包 `<AntdApp>` 对齐生产。另：测试里 mock navigator.clipboard 勿用裸 `Object.defineProperty`（默认 writable:false 会把属性锁死，污染后续用例的 Object.assign 赋值——configurable+writable 都给 true）。（来源：2026-09-23-md-card-render task-02）
