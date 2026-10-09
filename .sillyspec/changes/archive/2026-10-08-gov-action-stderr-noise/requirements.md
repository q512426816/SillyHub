---
author: flow-machine-draft
created_at: 2026-10-08T09:02:41.497Z
---
# 需求规格（Requirements）— 2026-10-08-gov-action-stderr-noise

## 功能需求

### FR-01: daemon knowledge.action 返回的 output 过滤 Node 进程告警噪声行（(node:NNN) XxxWarning 行与其 (Use node --trace-warnings 续行），CLI 真实结果文案完整保留- 失败路径（action failed 前缀）同样不再携带告警噪声- tests/knowledge-governance-handler.test.ts 新增 stderr 含 ExperimentalWarning 场景用例，该文件既有用例全绿

- daemon knowledge.action 拼 output 时，必须过滤 stderr 中的 Node 进程告警噪声行（行首 `(node:NNN) XxxWarning` 形态与其 `(Use \`node --trace-warnings ...\`)` 续行）；stdout 的 CLI 真实结果文案禁止被改动或丢弃，失败路径 `action failed:` 消息同样不得携带告警噪声。

#### 场景：主路径

- Given 子进程 stderr 含两行 SQLite ExperimentalWarning 噪声；When 执行 repair-paths
  成功（exit 0）；Then 返回 output 含 stdout 真实文案（如「无法定位需人工核」）且不含
  「ExperimentalWarning」「node --trace-warnings」。
- Given 同噪声 + CLI 失败（exit≠0）；When action 抛 internal；Then 错误消息含
  `action failed: <stdout>` 且不含告警噪声。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/knowledge-governance-handler.test.ts「stderr 带 Node 实验特性告警噪声 → output 滤掉噪声、真实文案可见（成功/失败两路）」
