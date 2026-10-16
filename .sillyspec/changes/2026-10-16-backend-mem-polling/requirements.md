---
author: qinyi
created_at: 2026-10-16 09:52:30
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 平台开发者 | 本变更的实施与验证者（backend/daemon 代码） |
| 平台管理员 | 服务器部署与内存/负载指标复核 |
| 知识搜索用户 | 知识搜索功能消费方（功能不降级，向量+词面双路保持） |
| daemon（存量/新版） | change-write 分发与 WS 协议兼容方 |

## 功能需求

### FR-01: 嵌入计算子进程封装
覆盖决策：D-001@v1
Given backend 进程运行且知识搜索向量路径被调用
When get_embedder 初始化
Then MUST 返回子进程代理（EmbeddingSubprocessProxy），fastembed 模型 MUST 在独立子进程加载，主进程 MUST NOT 直接 import TextEmbedding 加载模型

#### 场景：三闸自灭
Given 嵌入子进程运行中
When ①闲置满 idle_exit_sec（默认 900s）或 ②stdin 读到 EOF（父进程死亡）或 ③连续运行满 60min
Then 子进程 MUST 退出（进程退出=内存确定性归还 OS）；下次 embed 请求 MUST 重新拉起

#### 场景：失败 fail-soft
Given 子进程 spawn 失败或连续崩溃 ≥3 次
Then 语义 MUST 与现状模型缺席一致（model_ready=false + 词面兜底 + reason），且 MUST 退避 10 分钟后重试；MUST NOT 回退为进程内加载

#### 场景：OOM 保护
Given 容器内存告急触发 memcg OOM
Then 主进程 MUST 受 oom_score_adj=-500 保护（compose 服务级设置），嵌入子进程 MUST 在启动时把自身 oom_score_adj 重置为 0（Windows/macOS 无 /proc 时 MUST fail-soft 跳过）

### FR-02: 向量索引缓存上限
覆盖决策：D-004@v1
Given _indexes 进程内缓存持有多个 workspace 索引
When 工作区数超过 KNOWLEDGE_EMBEDDING_INDEX_MAX_WS（默认 4）
Then MUST 按最久未用淘汰（LRU）；MUST NOT 无界增长

### FR-03: spec 包缓存全局帽
覆盖决策：D-004@v1
Given _bundle_gzip_cache 跨工作区累积 gzip 整包
When 总字节数超过 SPEC_BUNDLE_CACHE_MAX_BYTES（默认 128MB）
Then MUST 按最久未用淘汰；per-workspace 最新 2 版本保留策略 MUST 保持

### FR-04: 权限定时器会话治理
覆盖决策：D-004@v1
Given 权限请求挂起 5 分钟超时定时器
When _on_timeout 回调执行
Then MUST 经 session_factory() 使用全新短会话，MUST NOT 复用外层已关闭 session；全部路径（含 route_key is None 早退）MUST 显式 commit/rollback 后关闭；WS 推送 MUST NOT 跨数据库事务（pending 行 commit 后再推送）

#### 场景：idle-in-transaction 消除
Given 权限超时回调各路径执行后
Then postgres MUST NOT 出现因该路径产生的 idle in transaction 连接（生产 FATAL 根因消除）

### FR-05: ws_hub 泄漏修复与身份校验
覆盖决策：D-004@v1
Given ws_hub 处理 RPC 与连接生命周期
When ①send_rpc 被外部取消（CancelledError）或 ②resolve_rpc 遇 done future 或 ③disconnect 收到旧连接的滞后调用
Then ①② MUST 清理 _pending_rpcs 条目；③ MUST 校验连接实例身份（仅当前注册实例可 pop，对齐 _evict_stale 先例）——MUST NOT 残留条目或误踢新连接

### FR-06: 附件预检与日志截断
覆盖决策：D-004@v1
Given 附件上传 / WS 大消息日志
When 上传请求到达或超大消息被日志记录
Then 上传 MUST 先读 UploadFile.size 超限 413 再读内容；日志 MUST 截断（超 8KB 只记前后 4KB+总长标注）

### FR-07: change-write WS 事件推送
覆盖决策：D-001@v1
Given DaemonChangeWrite pending 行落库
When 四个落库点（change/service.py 新建与 match 更新、change_writer/proxy.py、spec_workspace/router.py）任一 commit 完成
Then backend MUST 经 ws_hub 向该 runtime 所属 daemon 推送 daemon:change_write_available（payload 含 runtime_id 与可空 workspace_id）；推送 MUST best-effort（离线 debug 日志，不阻塞、不重试——兜底轮询仍在）
When daemon 收到该消息
Then MUST 立即调既有 getPendingChangeWrites 拉取（幂等）；消息缺 runtime_id MUST warn 丢弃
When 旧 daemon 收到该消息
Then MUST 走既有未知类型 default 分支 warn 丢弃（daemon.ts:7797-7799 已证实），分发给 120s 兜底轮询覆盖

### FR-08: change-write 兜底轮询独立间隔
覆盖决策：D-001@v1
Given daemon _pollLoop 运行
When change-write 分支等待下一轮
Then MUST 使用独立配置 change_write_poll_interval（默认 120s，原随 poll_interval=30s）；lease 轮询节奏 MUST NOT 受影响

### FR-09: 会话标题预览持久化
覆盖决策：D-001@v1
Given agent_sessions 表
Then MUST 新增 title_fallback（String(64) nullable）列；迁移 MUST 一次性回填存量（与 session_crud.py:336-365 同口径）；零 user_input 会话 MUST 回写哨兵空串

#### 场景：列表读列
Given 会话列表请求（limit≤500）
When 组装 title
Then MUST 优先 item.title、次 title_fallback；仅两列皆 NULL 的漏网会话 MUST 收窄查询一次并回写（列或哨兵），之后 MUST NOT 再查

### FR-10: 部署配额与保护
覆盖决策：D-001@v1
Given deploy/docker-compose.yml
Then mem_limit MUST 重分配（backend 1100m 保持 + oom_score_adj: -500；frontend 300m；minio 128m；redis 64m；postgres 256m 保持）——总和 2.14G→1.85G；部署文档 MUST 补 vm.swappiness=10 建议

## 非功能需求
- 兼容性：旧 daemon MUST 对新 backend 完全兼容（未知消息丢弃+兜底轮询）；新 daemon 对旧 backend MUST 行为完整（纯兜底轮询）；嵌入失败 MUST fail-soft 与现状同语义；REST API 面 MUST 零变化（无 gen:types 义务触发）
- 三平台（Win/Linux/macOS）：子进程 /proc 写入与管道等待 MUST fail-soft/读线程实现（CLAUDE.md 规则 13）
- 可回退：镜像级回滚（backup tag 先例）即整体回退；配置键全带默认值，不配即治理后行为
- 可测试：FR-01/04/05/07/09 各机制 MUST 有对应单测（见文件清单测试行）

## 决策覆盖矩阵
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-07, FR-08, FR-09, FR-10 | 方案 A 四机制逐条落 FR |
| D-002@v1 | —（rejected） | 防复潮条目，无实施 FR |
| D-003@v1 | —（rejected） | 防复潮条目，无实施 FR |
| D-004@v1 | FR-02, FR-03, FR-04, FR-05, FR-06 | 深扫三高危+中危配套逐条落 FR |

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-02: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-03: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-04: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-05: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-06: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-07: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-08: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-09: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-10: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
