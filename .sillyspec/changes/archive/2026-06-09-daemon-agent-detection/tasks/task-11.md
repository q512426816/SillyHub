---
id: task-11
title: "集成测试（daemon 多 runtime 注册 → 任务执行）"
priority: P1
estimated_hours: 2
depends_on:
  - task-07
  - task-08
blocks: []
allowed_paths:
  - sillyhub-daemon/tests/test_integration.py
author: qinyi
created_at: 2026-06-09 23:25:05
---

# task-11: 集成测试（daemon 多 runtime 注册 → 任务执行）

## 修改文件

| 操作 | 文件路径 |
|------|---------|
| 新增 | `sillyhub-daemon/tests/test_integration.py` |

## 实现要求

1. **Mock HubClient**：创建 `HubClient` 的 mock 对象，拦截 `register_runtime()` 调用，记录调用参数（provider、version、capabilities 等）。

2. **Mock AgentDetector**：返回预定义的 `DetectedAgent` 列表，模拟检测到多种 agent（如 claude + codex + cursor），避免依赖真实二进制。

3. **Mock AgentBackend**：每种 backend 的 `execute()` 方法返回预定义的 `TaskResult`，不真正启动子进程。

4. 测试 daemon `start()` 流程中多 runtime 注册：
   - 验证检测到 N 个 agent 就调用 N 次 `register_runtime()`
   - 验证每次注册的 provider 名称与检测到的 agent 一致
   - 验证 capabilities 字段包含正确的 protocol 和 agents 信息

5. 测试 TaskRunner 按 provider 分发执行：
   - 创建多个 claim 到的 task（不同 provider），验证 TaskRunner 选择了正确的 Backend
   - 验证 claude task 使用 StreamJsonBackend
   - 验证 codex task 使用 JsonRpcBackend
   - 验证 copilot task 使用 JsonlBackend

6. 测试全流程：detect -> register -> claim -> execute -> complete：
   - 模拟 daemon 启动，检测到 3 种 agent
   - 验证注册 3 个 runtime
   - 模拟 Hub 下发 task，daemon claim 并执行
   - 验证执行完成后回调 Hub 上报结果

7. 测试无 agent 检测到时 daemon 的行为：
   - `AgentDetector.detect()` 返回空列表
   - daemon 应正常启动，不崩溃，不注册任何 runtime
   - 日志中记录 "no agents detected" 类似信息

8. 测试部分 agent 检测失败场景：
   - 12 种 agent 中只检测到 2 种
   - 验证只注册 2 个 runtime
   - 验证 TaskRunner 只能执行这 2 种 provider 的 task
   - 其他 provider 的 task 应被跳过或标记为 unsupported

## 接口定义

本测试涉及以下接口的集成调用：

```python
# daemon.start() 主流程（来自 task-07）
async def start():
    agents = await detector.detect()
    for agent in agents:
        await client.register_runtime(provider=agent.name, ...)
    # 进入 task loop

# client.register_runtime（来自 task-07）
async def register_runtime(
    runtime_name: str,
    provider: str,
    version: str | None,
    capabilities: dict,
) -> str:  # returns runtime_id

# TaskRunner.execute_task（来自 task-08）
async def execute_task(self, task_id: str, runtime_id: str) -> TaskResult:
    provider = self._get_provider(runtime_id)
    backend = get_backend(provider)
    return await backend.execute(...)

# HubClient.claim_task
async def claim_task(self, runtime_id: str) -> Task | None

# HubClient.report_result
async def report_result(self, task_id: str, result: TaskResult) -> None
```

### 测试辅助数据

```python
MOCK_DETECTED_AGENTS = [
    DetectedAgent(name="claude", bin_path="/usr/bin/claude", version="2.1.0", protocol="stream_json", available=True),
    DetectedAgent(name="codex", bin_path="/usr/bin/codex", version="0.101.0", protocol="json_rpc", available=True),
    DetectedAgent(name="cursor", bin_path="/usr/bin/cursor-agent", version="1.2.0", protocol="stream_json", available=True),
]
```

## 边界处理

1. **无 agent 检测到**：`detect()` 返回空列表，daemon 不注册任何 runtime，不崩溃，日志记录无 agent 的提示信息
2. **register_runtime 抛出网络异常**：daemon 应捕获异常，记录日志，继续注册下一个 agent（不因单个失败中断全部注册）
3. **claim_task 返回 None**：无可用 task 时 TaskRunner 等待后重试，不崩溃
4. **execute 过程中子进程异常**：backend.execute 抛出异常时，TaskRunner 应捕获并上报错误结果（非挂起）
5. **provider 不在已知 Backend 列表中**：TaskRunner 应跳过该 task 并记录警告日志，不崩溃
6. **同一 provider 检测到多个版本**（如环境变量和 PATH 各一个）：以环境变量优先，只注册一个 runtime
7. **daemon 启动中途 HubClient 连接断开**：注册循环应处理连接异常，优雅退出或重试

## 非目标

- 不测试真实 agent 二进制调用（仅 mock）
- 不测试后端 HTTP API 路由
- 不测试前端页面
- 不测试 WebSocket 连接（ws_hub）
- 不测试并发安全（多 task 同时执行）—— V2 再说

## 参考

- design.md: Phase 1（Agent 检测）— DetectedAgent 结构
- design.md: Phase 2（Daemon 注册改造）— 多 runtime 注册循环
- design.md: Phase 3（执行协议层）— Backend 分发逻辑
- design.md: 接口定义 — AgentBackend 抽象接口
- plan.md: Wave 3（task-07: Daemon 多 runtime 注册、task-08: TaskRunner provider 分发）
- plan.md: 依赖关系图 — task-07 和 task-08 均为 task-11 的直接依赖

## TDD步骤

1. 创建 `test_integration.py`，搭建 mock 基础设施：`MockHubClient`、`MockAgentDetector`、`MockBackend`
2. 编写 `test_daemon_registers_all_detected_agents`：检测到 3 个 agent -> 验证 `register_runtime` 被调用 3 次，参数正确
3. 编写 `test_daemon_no_agents_detected`：返回空列表 -> 验证 `register_runtime` 未被调用，daemon 不崩溃
4. 编写 `test_taskrunner_dispatches_by_provider`：claude task -> StreamJsonBackend，codex task -> JsonRpcBackend
5. 编写 `test_full_flow_detect_register_claim_execute`：全流程串联测试，验证最终 `report_result` 被正确调用
6. 编写 `test_register_runtime_failure_continues`：第一个 agent 注册失败 -> 第二个 agent 仍然尝试注册
7. 编写 `test_unsupported_provider_task_skipped`：Hub 下发一个没有对应 backend 的 task -> 验证 task 被跳过
8. 运行全部测试确认通过

## 验收标准

| # | 验收项 | 通过条件 |
|---|--------|---------|
| 1 | 多 runtime 注册 | 检测到 3 个 agent 时 `register_runtime` 被调用 3 次，每次 provider 不同 |
| 2 | 注册参数正确 | 每次注册的 provider 与检测到的 agent name 一致 |
| 3 | 无 agent 不崩溃 | detect 返回空列表时 daemon 正常退出，register_runtime 未被调用 |
| 4 | TaskRunner 分发 | claude task 走 StreamJsonBackend，codex task 走 JsonRpcBackend |
| 5 | 全流程串联 | detect -> register -> claim -> execute -> report_result 完整执行，结果正确 |
| 6 | 注册失败容错 | 单个 agent 注册失败不影响其他 agent 的注册 |
| 7 | 不支持 provider 跳过 | Hub 下发未知 provider 的 task 时 TaskRunner 跳过并记录日志 |
| 8 | execute 异常处理 | backend.execute 抛异常时 TaskRunner 上报错误结果，不挂起 |
| 9 | claim_task 返回 None | 无 task 时 TaskRunner 不崩溃，进入等待循环 |
| 10 | pytest 全通过 | `pytest sillyhub-daemon/tests/test_integration.py -v` 无失败用例 |
