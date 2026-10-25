---
id: task-01
title: 'daemon 双指令——gitDirtyFiles/gitWorktreeDiff 实现与平名注册 + 解析单测（含 untracked exit 1 语义、porcelain 末段 rejoin、u 条目、ignored 聚合、中文/空格路径、detached HEAD 用例）'
title_zh: 'daemon 双指令——gitDirtyFiles/gitWorktreeDiff 实现与平名注册 + 解析单测（含 untracked exit 1 语义、porcelain 末段 rejoin、u 条目、ignored 聚合、中文/空格路径、detached HEAD 用例）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-25 20:18:25
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-003@v2, D-006@v1, D-010@v1, D-011@v1]
allowed_paths:
  - sillyhub-daemon/src/host-fs-handler.ts
  - sillyhub-daemon/src/daemon.ts
  - NEW:sillyhub-daemon/tests/host-fs-handler-git-dirty-files.test.ts
target_files:
  - sillyhub-daemon/src/host-fs-handler.ts
  - sillyhub-daemon/src/daemon.ts
  - NEW:sillyhub-daemon/tests/host-fs-handler-git-dirty-files.test.ts
provides:
  - RPC git_dirty_files({root}) → {head_short, empty, files[{path,status,additions,deletions,binary}], ignored[{path,is_dir}], error}
  - RPC git_worktree_diff({root,path}) → {status, head_short, diff, truncated, binary, error}
goal: >
  daemon 新增两个只读平名 git RPC——文件级状态清单与工作区单文件 vs HEAD diff，
  为 backend 新端点（task-02）提供采集能力；这是三层链路的最底层（D-006）。
implementation:
  - sillyhub-daemon/src/host-fs-handler.ts 紧邻 gitStatus(:1642)/gitDiffFile(:1567) 新增 gitDirtyFiles：① runCmd `git status --porcelain=v2 --no-renames --no-show-stash`，`1` 条目按行内首个 `\t` 切出 path（前段单空格分字段），XY 含 D→deleted、含 A→added、其余→modified；`?`→untracked；`u`(unmerged)→modified（D-011）；② runCmd `git ls-files --others --ignored --exclude-standard --directory`，目录行（尾 `/`）→ is_dir=true，散落忽略单文件逐条（D-003@v2）；③ runCmd `git diff HEAD --numstat --no-renames` 按 path join 行数，`-` 二进制行→binary=true 行数 null，untracked 不在 numstat→行数 null；`branch.oid (initial)`→empty=true 清单空数组；全程 GIT_QUOTEPATH_OFF_ARGS + 30s 读超时，失败不抛走 error 通道
  - 同文件新增 gitWorktreeDiff：先 runCmd `git status --porcelain=v2 --no-renames --no-show-stash -- <path>` 单文件判态——modified/deleted → runCmd `git diff HEAD --unified=3 --no-color -- <path>`（!ok→error）；untracked → 局部 execFile（对齐 runGitFetch 先例 host-fs-handler.ts:1661，不走 runCmd ok 通道）`git diff --no-index --unified=3 --no-color -- /dev/null <root>/<path>`，exit 0/1 均成功（1=有差异常态）、≥2 或 killed 才 error，stderr 的 CRLF warning 行不进 error 文案（D-010）；64KB 字节截断 + `Binary files` binary 检测对齐 gitDiffFile(:1602-1612)
  - sillyhub-daemon/src/daemon.ts:7803 附近对齐 git_status 注册形态，平名注册 git_dirty_files / git_worktree_diff 两 RPC handler
  - NEW:sillyhub-daemon/tests/host-fs-handler-git-dirty-files.test.ts：对齐既有 tests/host-fs-handler-git-log.test.ts 桩测形态——四态映射表驱动（含 path 含空格+中文、rename 拆 D+A 两条）、u 条目归类、ignored 聚合（目录行+散落单文件）、numstat join（二进制 `-`、untracked 缺行）、worktree-diff 分流（untracked exit 1 成功语义/exit 2 error/CRLF warning 不进文案）、root 越界 RpcError forbidden、空仓库空态、detached HEAD 正常返回
acceptance:
  - 上述全部用例在 vitest 单文件运行通过（聚焦测试，不跑全量）
  - 两方法遵守不抛错误约定：任何 git 失败返回 error 字段而非抛异常（对齐既有五 git 方法）
  - RPC 注册为平名（无 host_fs. 前缀），backend 可按 method 名直连调用
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/host-fs-handler-git-dirty-files.test.ts
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
constraints:
  - 全部只读 git 子命令（status/ls-files/diff），禁任何写操作（add/commit/checkout 等）
  - execFile argv 数组防注入 + assertWithinAllowedRoots + assertGitPathspec + GIT_QUOTEPATH_OFF_ARGS（既有守卫，不得绕过）
  - 不改动既有五 git 方法（gitLog/gitRefs/gitShow/gitDiffFile/gitStatus）的任何行为
  - daemon ESM import 必须带 .js 扩展名（知识库 conventions 已知坑）
  - 不新增运行时依赖；兼容 Windows/Linux/macOS（路径 POSIX 化）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
