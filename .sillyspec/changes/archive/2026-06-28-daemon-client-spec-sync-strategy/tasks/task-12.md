---
author: qinyi
created_at: 2026-06-30T10:20:00
task_id: task-12
status: implemented
---
# task-12: backend 测试（透传+落库+真实值+零回归）

## 状态：已实现（回填蓝图，代码已 apply）
**实现位置**：`backend/tests/modules/workspace/` + `backend/tests/modules/agent/` + `backend/tests/modules/daemon/`（WorkspaceCreate spec_strategy 字段测；daemon-client 创建带 strategy 落库测含 scan_generate_daemon_client 分支；dispatch lease payload 含 specStrategy 测；AgentRun.spec_strategy 读真实值测；server-local 零回归测）

## 目标
backend 测试覆盖 strategy 透传链路 + 落库 + AgentRun 真实值 + server-local 零回归。

## 验收标准（已通过）
- [x] WorkspaceCreate spec_strategy 字段测
- [x] daemon-client 创建带 strategy 落库测
- [x] dispatch lease payload 含 specStrategy 测
- [x] AgentRun.spec_strategy 读真实值测
- [x] server-local 零回归测

## 覆盖
FR-01~FR-03, FR-12。参考 design §5.4 Phase4。
