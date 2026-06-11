---
author: qinyi
created_at: 2026-06-10T00:00:00
---

# SillyHub Daemon -- 代码债务与风险

## 代码质量

### 🔴 高风险

1. **protocol.py 需与 server 端手动同步**
   - `protocol.py` 的消息常量必须与 `backend/app/modules/daemon/protocol.py` 保持一致
   - 没有自动化同步机制，依赖人工维护，容易遗漏导致通信失败

2. **StreamJsonBackend 全局状态 `_last_result_info`**
   - `stream_json.py` 使用 `self._last_result_info` 在 `parse_output` 和 `execute` 之间传递数据
   - 实例属性在方法间隐式共享，如果 execute 被并发调用会产生竞态条件
   - 其他 backend 使用独立的 state 对象（`_TextState`、`_JsonlState`），但 StreamJsonBackend 不一致

### 🟡 中风险

3. **daemon.py poll_loop 是空操作**
   - `_poll_loop` 当前只是 sleep + debug 日志，没有任何实际轮询逻辑
   - 注释说"等待 server 实现 `/tasks/pending` 端点"，但保留此空循环会消耗资源

4. **AgentInfo 标记为 deprecated 但未移除**
   - `agent_detector.py` 中 `AgentInfo` 类标记为 deprecated，`get_capabilities` 方法也是 deprecated
   - 仍然在 `__all__` 中导出，没有移除时间表

5. **CLI stop 命令使用 SIGTERM**
   - Windows 上 SIGTERM 的行为与 Linux 不同，可能导致进程无法优雅退出
   - PID 文件可能在异常退出时残留（虽然有 stale 检测）

6. **硬编码超时值**
   - StreamJsonBackend: `_EXECUTE_TIMEOUT = 10`（10 秒），对于复杂任务可能不够
   - WorkspaceManager: git 操作超时 60 秒
   - WebSocket 重连退避固定 5 秒，无指数退避

### 🟢 低风险

7. **hubclient 错误处理粗粒度**
   - 所有 HTTP 错误通过 `raise_for_status()` 统一处理，不区分 4xx/5xx
   - 没有重试机制，网络抖动可能导致任务失败

8. **CredentialManager chmod 在 Windows 上无效**
   - `os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)` 在 Windows 上是 no-op
   - 已有 try/except 保护但未记录 Windows 安全隐患

9. **缺少结构化配置校验**
   - DaemonConfig 直接 `json.load` + `dict.update`，没有 schema 验证
   - 损坏的 config.json 可能导致运行时错误

## 依赖风险

### 🔴 高风险

1. **websockets 库 API 不稳定**
   - `websockets>=12.0` 跨多个大版本，API 可能有破坏性变更
   - 当前使用 `websockets.connect()` 上下文管理器模式

### 🟡 中风险

2. **httpx AsyncClient 生命周期**
   - HubClient 的 `_http` 在 `__init__` 中创建，`close()` 需要显式调用
   - 如果 Daemon.stop() 路径中 `close()` 失败，可能泄漏连接

3. **hatchling 构建后端**
   - 项目使用 hatchling 但没有 hatch 配置段（`[tool.hatch]`）
   - 完全依赖默认行为，自定义构建步骤需要额外配置

### 🟢 低风险

4. **Click 版本兼容性**
   - `click>=8.0` 范围较宽，但 Click 8.x API 稳定
   - CLI 代码仅使用基础功能（group、command、option），风险低

## 架构风险

### 🟡 中风险

5. **单进程多 Agent 并发**
   - 所有 Agent 在同一进程中运行，一个 Agent 崩溃可能影响整个 daemon
   - `max_concurrent_tasks` 配置存在但未在 TaskRunner 中实际限制并发数

6. **workspace 并发访问**
   - WorkspaceManager 没有文件锁机制
   - 多个并发任务操作同一 workspace 可能产生 git 冲突
