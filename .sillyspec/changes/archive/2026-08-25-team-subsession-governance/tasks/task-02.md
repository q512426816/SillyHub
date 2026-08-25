---
id: task-02
title: extract-shared-worktree-helper-from-execution
title_zh: 抽取 execution.py worktree 块为派发共享 helper
author: qinyi
created_at: 2026-08-25 20:57:40
priority: P0
depends_on: [task-01]
blocks: [task-05]
requirement_ids: [FR-02]
decision_ids: []
allowed_paths:
  - backend/app/modules/agent/execution.py
provides:
  - contract: worktree 共享 helper（dispatch_worker 现路径与 task-05 子会话派发同源复用，design §5.B）
    fields: [git 模式探测分流, direct 旁路, git_worktree_add 副本创建, root_path 与 worktree_branch 输出]
expects_from: []
goal: >
  把 dispatch_worker 内的 worktree 块（三态 git 模式探测 + direct 旁路 + per-worker
  worktree 创建）抽为无隐藏全局态的共享 helper（design §5.B），旧路径行为逐字节
  等价，新子会话派发路径（task-05）同源复用，消除双实现漂移风险。
implementation:
  - 把 dispatch_worker 内三段抽为共享 helper（落 execution.py 模块级函数或 MissionExecutionService 方法）——三态 git 模式探测（delegate 注入且非 caller worktree 形态才探测，任何异常恒归 unknown 不抛）、direct 旁路（branch 置 None、root_path 保持工作区根、不写 run.worktree_branch）、per-worker worktree 创建（.worktrees/短8 目录 + workers/短8 分支 + base_ref 空值兜底 HEAD）。
  - 失败语义原样保留——HostFsDelegateUnavailable 归 hostfs_unavailable、ok=False 归 worktree_create_failed，统一 mark_worker_run_failed 标 failed 后返回失败结果，不崩 mission。
  - dispatch_worker 改调 helper，行为逐字节等价；helper 输出 root_path、worktree_branch 与 git_mode（供 prompt 变体选择），不依赖 dispatch_worker 局部变量，task-05 可独立调用。
acceptance:
  - 既有 dispatch_worker 全路径行为零回归——direct 旁路、unknown 走现状建副本、worktree 创建失败标 failed 不派 lease。
  - helper 无隐藏全局态、输入输出闭合，可在子会话派发路径独立复用。
verify:
  - cd backend && uv run pytest -q --no-cov app/modules/agent/tests/test_team_mode_dispatch.py app/modules/agent/tests/test_dispatch_worker_worktree.py app/modules/agent/tests/test_dispatch_worker_caller_worktree.py
  - cd backend && uv run mypy app && uv run ruff check .
constraints:
  - 纯重构不改语义——不动 render_worker_prompt 文案、不动路径A（caller worktree）短路语义与 D-008 红线（路径A 绝不写 run.worktree_branch）。
  - 不动 worktree 引擎语义——HostFsDelegate.git_worktree_add 与探测契约不动（direct 仅认 daemon 真答非 git，异常恒 unknown）。
  - 不动 dispatch_to_daemon 派发段与 lease 写入——那是 task-05 要替换的执行段，本卡不碰。
  - 新增单测归 task-15；本卡以既有 worktree 测试集守护零回归。
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
