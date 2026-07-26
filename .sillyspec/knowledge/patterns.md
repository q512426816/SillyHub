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
