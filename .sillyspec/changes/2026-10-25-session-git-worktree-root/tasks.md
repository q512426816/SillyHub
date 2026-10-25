---
author: flow-machine-draft
created_at: "2026-10-25T11:42:55.549Z"
---
# 任务注册表（Tasks）— 2026-10-25-session-git-worktree-root

- [x] task-01: 后端探测层：schema 加 root_source + git_status.py 决策链重构（current_change_id→change_key→候选路径→host_fs.stat 探测，命中取工作树、miss/异常静默落回）——验证：backend/tests/modules/daemon/test_session_git_status.py 新用例全绿（探测命中 root=工作树/miss 落回/异常不阻断/无锚跳过）+ 既有 11 用例零回归
- [x] task-02: 前端标识：SessionGitStatus 加 root_source + gen:types 三生成物 + badge 工作树标识与 Tooltip 标注——验证：session-config-bar.test.tsx 新用例全绿（worktree 标识渲染/cwd 形态无标识）+ 既有用例零回归
- [x] task-03: 回归与收口核验：后端 daemon 测试面 + 前端组件域全绿；lint/mypy/tsc 门过；线上复验路径确认（构建部署归用户触发）
