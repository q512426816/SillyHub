---
author: qinyi
created_at: 2026-06-13 23:59:42
---

# Requirements

> 变更：`2026-06-13-daemon-nodejs-rewrite`
> 行为规格以 Python 版 `sillyhub-daemon/` 现有实现为基准（功能等价）。

## 角色

| 角色 | 说明 |
|---|---|
| 平台开发者 | 维护 daemon 与 backend daemon 通道，关心代码栈统一与可维护性 |
| 运维 / 部署 | 负责打包 daemon 镜像、配置 server_url/token、查看日志与状态 |
| Agent Provider | 12 种 agent CLI（claude/codex/copilot/gemini/cursor/hermes/kimi/kiro/opencode/openclaw/pi/antigravity），依赖 daemon 正确解析其输出协议 |
| Backend（对端） | FastAPI daemon 模块，期望 daemon 按 protocol.py 契约通信，不感知语言切换 |

## 功能需求

### FR-01: 协议抽象层（方案B 核心）
Given 12 种 agent provider 各自有不同的 stdout 协议（stream_json / json_rpc / jsonl / ndjson / text）
When TaskRunner 按 provider 取对应 `ProtocolAdapter`
Then adapter 的 `parse(line)` 将原始行转为统一 `AgentEvent`（text/tool_use/tool_result/error/complete），协议差异 100% 收敛于 adapter，编排层零感知。

Given 一个新协议的 stdout 样本
When 开发者只新增一个 `ProtocolAdapter` 实现
Then 不改动 TaskRunner / HubClient / WsClient 即可接入（扩展点验证）。

### FR-02: provider → protocol 映射
Given provider 名称
When 调用 `getBackend(provider)`
Then 按 `PROTOCOL_PROVIDERS` 映射（stream_json:[claude,gemini,cursor] / json_rpc:[codex,hermes,kimi,kiro] / jsonl:[copilot] / ndjson:[opencode,openclaw,pi] / text:[antigravity]）懒加载返回 adapter；未知 provider 抛错。

### FR-03: 通信契约对齐（G-02，P0）
Given backend 的 `protocol.py` 定义的消息常量
When daemon 发送/接收 WS 消息
Then 类型字符串逐字一致：register / heartbeat / heartbeat_ack / task_available / lease_claim / lease_start / lease_complete / lease_messages（前缀 `daemon:`）。

Given WS 断线
When 触发重连
Then 5 秒退避重连，并保持 HTTP 轮询兜底，与 Python 版策略一致。

### FR-04: lease 生命周期
Given daemon 收到 `task_available`
When 执行一次任务
Then 完整走通 `claim(拿 claim_token) → start → 流式 messages(submit) → complete(带 patch+stats)`，状态机与 Python 版一致。

### FR-05: 凭证管理（0600）
Given 工具配置含 `{{USER_GITHUB_TOKEN}}` 占位符
When 渲染环境变量
Then 优先从 `~/.sillyhub/daemon/credentials.json` 取值，次取环境变量；凭证文件写入后权限为 `0600`（POSIX）。

### FR-06: workspace git mirror
Given 任务携带 repo_url + branch
When 准备工作区
Then 执行 git mirror / pull --ff-only，执行后 collect git diff 生成 patch + files_changed；Windows 兼容 rmtree。

### FR-07: agent 检测（12 provider）
Given 本机环境
When daemon 启动检测
Then 对 12 种 provider 按优先级（env 覆盖 → PATH 查找 → 标记不可用）探测，做 `--version` 与最低版本校验，每个检测到的 agent 注册为独立 runtime_id。

### FR-08: stdin control_request 应答
Given 子进程（如 stream_json/claude）通过 stdin 发出 control_request
When backend 等待批准
Then daemon 保持 stdin 开启并按策略应答（自动批准工具使用），避免子进程 hang。

### FR-09: CLI（commander）
Given 用户在终端
When 执行 `start / stop / status / logs`
Then 与 Python 版（Click）命令名、配置项（--server/--token）、PID 文件、日志文件路径一致。

### FR-10: 增量可交付（G-04）
Given 任一 Wave 完成
When 验收
Then `tsc` 编译通过 + `vitest` 该 Wave 单测全绿即可推进，不依赖后续 Wave。

## 非功能需求

- **兼容性（G-02）**：与 backend protocol.py 的 WS/REST/lease 契约逐字对齐，backend 无感知语言切换；credential.json/config.json 格式不变。
- **可回退**：Python 版 `sillyhub_daemon/` 保留至 W5 真实冒烟通过；任一 Wave 发现不可调和对端偏差可立即回退。
- **可测试**：1:1 迁移 Python 测试用例与 fixture，行为覆盖等价；契约用断言校验消息常量；每 Wave 双绿。
- **零/少依赖（G-05）**：运行时依赖仅 `ws` / `commander`，HTTP 用原生 `fetch`，WS 客户端用 `ws`，CLI 用 `commander`。
- **跨平台**：POSIX 下 credential 权限 0600；Windows 下权限操作降级为警告不中断；git/子进程错误处理兼容 Windows。
- **类型安全**：TypeScript strict 模式，`tsc` 零错误。
- **未上线免责**：本项目未正式上线，数据可清空，无需版本迁移/灰度。
