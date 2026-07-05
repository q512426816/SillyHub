---
author: qinyi
created_at: 2026-06-23 20:35:30
---

# Codex runtime conversation fix

## 问题

`/runtimes` 页面把 `codex` 放进交互式会话 provider 列表，导致 Codex 会话走 `InteractiveSessionPanel -> createSession -> daemon SessionManager.create()`。

当前 daemon 交互式 `SessionManager` 只支持 Claude Code，`codex` 会触发 `UnsupportedProviderError`。Claude Code 对话正常，是因为它走的是已实现的 Claude SDK interactive session。

## 方案

- Claude Code 继续使用现有 interactive session。
- Codex runtime 的「会话」弹窗改走已有 quick-chat SSE API：`quickChat` + `streamQuickChat` + `getQuickChatResult`。
- `InteractiveSessionChatSection` 的交互式 provider 列表只保留 `claude`，避免从 Claude 弹窗里手动选到 Codex 后再次触发 unsupported path。

## 验收

- 点击 Codex runtime 的「会话」后显示 Codex 快速对话面板。
- 发送消息调用 `/api/daemon-chat` quick-chat 路径，而不是 `/api/daemon/sessions` interactive 路径。
- Claude Code runtime 的 existing interactive 会话行为不变。
