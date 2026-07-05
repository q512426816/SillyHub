---
author: qinyi
created_at: 2026-06-09 23:01:00
---

# Proposal: Daemon Agent 检测体系扩展

## 动机

当前 daemon 只能识别 claude-code 和 sillyspec 两种 agent，`provider` 硬编码。
用户本地安装了多种 agent（codex、cursor、gemini 等），但无法被检测和利用。
参考 multica 项目的 12 种 agent provider 体系，需要完整复刻到本项目。

## 关键问题

1. **AgentDetector 只认 2 种 agent**：硬编码 `claude` 和 `sillyspec`，无法检测 codex/cursor/gemini 等常用 agent
2. **provider 字段硬编码**：daemon 注册时 `provider="claude-code"`，无法反映实际使用的 agent 类型
3. **无执行协议分类**：所有 agent 用同一套 CLI 调用逻辑，但不同 agent 的输出格式差异很大（NDJSON vs JSON-RPC vs 纯文本）

## 变更范围

- 扩展 `AgentDetector` 支持 12 种 agent provider
- daemon 启动时为每个检测到的 agent 分别注册 runtime
- 按 agent 协议类型实现不同的执行后端（stream-json / JSON-RPC / JSONL / NDJSON / text）
- 版本校验（claude >= 2.0.0, codex >= 0.100.0, copilot >= 1.0.0）
- 前端 runtimes 页面展示 provider 信息

## 不在范围内

- 模型发现（ListModels / thinking level）
- MCP 配置注入
- login-shell fallback（Windows 不适用）
- ACP 协议完整实现
- 批量注册 API

## 成功标准

- `sillyhub-daemon start` 后能检测到本地安装的所有 agent
- 每种检测到的 agent 分别在 `/runtimes` 页面显示
- 版本低于最低要求的 agent 被标记为不可用
- TaskRunner 按 provider 类型选择正确的执行协议
- 现有功能不受影响（无 agent 安装时行为不变）
