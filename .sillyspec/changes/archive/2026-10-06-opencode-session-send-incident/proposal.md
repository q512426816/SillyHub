---
author: flow-machine-draft
created_at: 2026-10-05T23:16:41.771Z
---
# 提案书（Proposal）— 2026-10-06-opencode-session-send-incident

## 动机

任务原话转写：修复新建会话发送双故障：①前端 TDZ 回归（handleSend 闭包引用声明在预会话早退之后的 isToolReportBody，新建会话首句点发送必抛 ReferenceError，d6fabf408 引入）②opencode 会话 SSL 证书主机名不匹配（daemon 本机直连 opencode.ai 被劫持，需走本机 Clash 7897 代理）
成功标准：
- isToolReportBody 派生上移到所有早退分支之前（session 判空安全），handleSend 依赖数组补该变量
- session-panel-pre-session.test.tsx 原先挂掉的 15 个用例全部转绿（TDZ 回归测试即现有用例）
- 服务器 OpenCode Go 供应商行 extra_env 注入 HTTPS_PROXY=http://127.0.0.1:7897，daemon 本机 Claude Code 经代理连 opencode.ai 实测 200
- 未跑全量测试（仅跑本修复相关测试文件）

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. isToolReportBody 派生上移到所有早退分支之前（session 判空安全），handleSend 依赖数组补该变量
2. session-panel-pre-session.test.tsx 原先挂掉的 15 个用例全部转绿（TDZ 回归测试即现有用例）
3. 服务器 OpenCode Go 供应商行 extra_env 注入 HTTPS_PROXY=http://127.0.0.1:7897，daemon 本机 Claude Code 经代理连 opencode.ai 实测 200
4. 未跑全量测试（仅跑本修复相关测试文件）

## 成功标准（可验证）

1. isToolReportBody 派生上移到所有早退分支之前（session 判空安全），handleSend 依赖数组补该变量
2. session-panel-pre-session.test.tsx 原先挂掉的 15 个用例全部转绿（TDZ 回归测试即现有用例）
3. 服务器 OpenCode Go 供应商行 extra_env 注入 HTTPS_PROXY=http://127.0.0.1:7897，daemon 本机 Claude Code 经代理连 opencode.ai 实测 200
4. 未跑全量测试（仅跑本修复相关测试文件）
