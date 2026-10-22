---
author: flow-machine-draft
created_at: 2026-10-21T01:31:57.222Z
---
# 决策记录（Decisions）— 2026-10-21-precommit-sandbox-entries

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：答：风险①：uv 在 Low 子树若需下载依赖（根 .venv 缺失时）可能被沙箱网络策略拦——当前根环境已就绪（ql-20260923-006 实证根/backend uv env 同源可用），`.tmp/uv-cache` 重定向后无 profile 写，残余风险记为已知限制；真遇到时用户终端跑一次 hook 预热缓存即可。风险②：pre-push 两条保留 bash 包装，agent 会话内若手动触发 pre-push 仍会崩——推送属用户终端动作（流程纪律），不为其扩大改动面。死路①：icacls 改 `~/.cache` ACL——嵌套 token 根本不在 CodexSandboxUsers 组、写入拒绝在驱动白名单层而非 DACL，改了无效（探针实证），弃。死路②：削弱沙箱容器（改内核对象目录 ACL/降标签）恢复 msys 嵌套——动容器安全边界换取工具便利，方向性错误，弃。死路③：PRE_COMMIT_HOME 写入用户级环境变量——Low 子树只能写仓内路径，单值无法同时满足多仓，弃（按会话 `export PRE_COMMIT_HOME=$PWD/.tmp/pre-commit-home` 使用，已验证）。
