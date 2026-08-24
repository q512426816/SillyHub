---
id: task-05
title: 'execution dispatch 三态分流——worktree 块前探测：direct→跳过 worktree/worktree_branch=None/prompt 直通变体（含结果落盘段 commit 指令调整）；unknown→现状'
title_zh: 'execution dispatch 三态分流——worktree 块前探测：direct→跳过 worktree/worktree_branch=None/prompt 直通变体（含结果落盘段 commit 指令调整）；unknown→现状'
author: 'qinyi'
created_at: 2026-08-24 18:53:12
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-007@v1, D-006@v2]
allowed_paths:
  - backend/app/modules/agent/execution.py
  - backend/app/modules/agent/tests/test_dispatch_worker_direct_mode.py
  - backend/app/modules/agent/tests/test_dispatch_worker_worktree.py
expects_from:
  - 'task-02 probe_workspace_git_mode：HostFsDelegate 新增方法，返 git|direct|unknown 三态（transport 异常 / HostFsDelegateUnavailable / 超时在 helper 内归 unknown，不向调用方抛出）'
goal: >
  execution.py dispatch_worker 的 per-worker worktree 块（:250-330）前接 task-02 三态探测
  分流：git 照旧 worktree 隔离；确证非 git（direct）跳过 worktree 直通工作区目录
  （root_path=工作区根、worktree_branch 保持 None、lease 不写 branch metadata、
  render_worker_prompt 直通约束变体——含结果落盘段 :141-144 的 commit 指令调整）；
  unknown 维持现状不降级直通（FR-04 / D-007@v1 路径A 语义复用）。
implementation:
  - 'dispatch_worker worktree 块（:250-330）前插探测分流：self._host_fs_delegate 非 None 且非 caller worktree 形态（worktree_path 为 None，路径A :242-243 语义不动）且 ws/root_path 就绪时调 task-02 probe_workspace_git_mode(delegate, ws)；delegate 未注入（None）→ 视 unknown 走现状'
  - 'git → 现状照旧：.worktrees/<run.id 短8> 副本、worktree_branch=workers/<短8>、创建失败 mark_worker_run_failed(worktree_create_failed) 全链路逐字节不变'
  - 'direct → 跳过 worktree 块：root_path 保持 :237 的 resolve_root_path_for_daemon(ws.root_path)（工作区根即 worker cwd）；run.worktree_branch 保持 None（路径A 语义，finalizer.py:290-297/:470-477 只选 NOT NULL 天然跳过合并/清理）；lease metadata 不写 branch——:232-233 的 ws.default_branch 回退在 direct 分支旁路，dispatch_to_daemon 传 branch=None；prompt 用直通变体'
  - 'render_worker_prompt（:126-154）增 mode 参数（默认现行为，既有调用方零改动）：mode=direct 时两段调整——①worktree 协作约束块（:145-153）替换为直通约束文案（无 commit 指令：直接在工作区目录内工作、改动立即生效、无隔离副本；同目录可能有其它分身，避免并行写同一文件——design §5.D 口径）；②结果落盘段（:141-144）去掉「随 commit 提交」改为直接写产物文件——产物收集按 run_id 查 AgentArtifact（get_worker_result），不依赖 worktree_branch'
  - 'unknown → 维持现状：仍尝试 worktree，失败按 worktree_create_failed 既有语义，不降级直通（防 RPC 故障误判，D-006@v2）'
  - '新增 test_dispatch_worker_direct_mode.py 三分支用例：git（mock 探测返 git → 断言 git_worktree_add 调用+worktree_branch 落列）/ direct（断言无 git_worktree_add、worktree_branch IS None、lease metadata 无 branch、root_path=工作区根、prompt 含直通约束且无 git add/commit 指令）/ unknown（mock 探测返 unknown 或 delegate=None → 断言仍走 worktree 尝试）'
acceptance:
  - 'git 分支照旧：探测返 git 时 worktree 创建/分支落列/失败标 failed 全链路与现状一致（既有 test_dispatch_worker_worktree.py 不改断言全绿）'
  - 'direct 分支：无 git_worktree_add 调用、run.worktree_branch 保持 None、dispatch_to_daemon 的 branch=None（lease metadata 无 branch）、root_path=resolve_root_path_for_daemon(ws.root_path)、prompt 为直通变体（含直通约束、无 git commit 指令、结果落盘段无「随 commit 提交」措辞）'
  - 'unknown 分支：走现状 worktree 尝试，不降级直通'
  - 'finalizer.py 与 converge 零改动：合并（:290-297）/清理（:470-477）仅选 worktree_branch IS NOT NULL，直通 worker 天然跳过（不触碰这两处代码，既有 finalizer 测试全绿佐证）'
  - '路径A（caller worktree_path 三参）与 worker_prompt 显式覆写两形态零回归（test_dispatch_worker_caller_worktree.py 不改断言全绿）'
verify:
  - 'cd backend && uv run pytest app/modules/agent/tests/test_dispatch_worker_direct_mode.py app/modules/agent/tests/test_dispatch_worker_worktree.py app/modules/agent/tests/test_dispatch_worker_caller_worktree.py -q --no-cov'
  - 'cd backend && uv run pytest app/modules/agent -q --no-cov -n auto'
constraints:
  - '不改 finalizer.py / converge 语义（D-007：无分支 worker 天然跳过）；不改 placement 派发路由与治理门规则'
  - '探测只在工作区维度分流：caller worktree（worktree_path 非空）与 worker_prompt 覆写两形态不受探测影响'
  - '直通 prompt 无 git commit 指令但结果落盘要求保留（get_worker_result 按 run_id 收 AgentArtifact，直通 worker 仍必须写产物文件）'
  - '探测异常语义由 task-02 契约兜底（helper 内归 unknown），execution 侧不额外 try/except 再降级'
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
