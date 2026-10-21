---
author: flow-machine-draft
created_at: "2026-10-21T14:35:37.254Z"
---
# 任务注册表（Tasks）— 2026-10-21-session-git-branch

- [x] task-01: 后端会话级 git 状态端点：schema（SessionGitStatusResponse）+ service（git_status.py root 决策链 + RPC + 错误映射）+ 路由（GET /sessions/{id}/git-status）——验证：backend/tests/modules/daemon/test_session_git_status.py 新用例全绿（cwd 主路径分支透出/每请求现查/no_root/no_git 空态/404/403/502）
- [x] task-02: 前端取数与展示：fetchSessionGitStatus（lib/daemon/sessions.ts）+ pnpm gen:types 重生成 api-types.ts + SessionConfigBar 档案后新增分支指示项（60s 轮询/空态隐藏/失败占位/mobile 收纳）——验证：session-config-bar.test.tsx 新用例全绿 + 既有用例零回归
- [x] task-03: 回归与收口核验：后端 daemon+git_log 相关测试面、前端组件测试全绿；lint 门过；确认 GitStatusBar/useGitLogStatus/git-log 端点零改动（FR-04）
