---
schema_version: 1
doc_type: module-card
module_id: lib-daemon
author: qinyi
created_at: 2026-06-10T16:55:00
---

# lib-daemon

## 定位
Daemon Runtime API 客户端。封装 Daemon 运行时管理和 Quick Chat 功能，以及 Provider 元数据和版本比较工具。

## 契约摘要
- `listDaemonRuntimes()` — 列出 Daemon 运行时
- `getDaemonRuntime(runtimeId)` — 获取单个运行时
- `quickChat(prompt, provider)` — 快速聊天（创建 AgentRun）
- `getQuickChatResult(runId)` — 获取聊天结果
- `PROVIDER_META` — Provider 显示元数据（label/icon/color，12 个 provider）
- `MIN_VERSIONS` — 最低版本要求（claude/codex/copilot）
- `isVersionBelow(version, minVersion)` — semver 比较工具函数
- 类型：DaemonRuntimeRead、QuickChatResponse、QuickChatResult

## 关键逻辑
- PROVIDER_META 包含 12 个 AI Agent Provider 的 UI 展示配置（Claude/Codex/Copilot/OpenCode/OpenClaw/Hermes/Gemini/Pi/Cursor/Kimi/Kiro/Antigravity）
- isVersionBelow 解析 semver 三段式版本号，支持 "v" 前缀和非标准后缀
- Quick Chat 是面向用户的简短对话接口

## 注意事项
- lib/agent.ts 中也有 listDaemonRuntimes，存在重复定义
- PROVIDER_META 的 provider 列表需与后端 daemon 检测的 provider 保持同步

## 人工备注

<!-- MANUAL_NOTES_START -->

- 2026-06-19-runtimes-layout：新增 `deleteAgentSession(sessionId)`，调用 `DELETE /api/daemon/sessions/{id}` 删除终态会话。

<!-- MANUAL_NOTES_END -->
