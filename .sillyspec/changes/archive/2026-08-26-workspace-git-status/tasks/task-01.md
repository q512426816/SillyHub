---
id: task-01
title: 'daemon git_status 方法（fetch 15s 局部 execFile 降级/porcelain v2 解析/numstat --no-renames 单源/空仓库与 detached 建模）+ 平名注册 + 单测'
title_zh: 'daemon git_status 方法（fetch 15s 局部 execFile 降级/porcelain v2 解析/numstat --no-renames 单源/空仓库与 detached 建模）+ 平名注册 + 单测'
author: 'qinyi'
created_at: 2026-08-26 23:21:52
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02, FR-03, FR-06]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - sillyhub-daemon/src/host-fs-handler.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/tests/host-fs-handler-git-log.test.ts
provides:
  - contract: GitStatusRpc
    fields:
      - 'git_status(root) → branch(string|null)/detached(bool)/upstream(string|null)/ahead(int|null)/behind(int|null)'
      - 'files_changed(int|null)/additions(int|null)/deletions(int|null)/untracked_count(int|null) + head_short(string|null) + empty(bool)'
      - 'fetch_performed(bool)/fetch_error(fetch_timeout|fetch_failed|no_remote|null)/error(string|null)——十四字段与 design §7.2 逐字一致'
goal: '在 daemon 侧落地 git_status 只读 RPC（fetch 15s 局部 execFile 降级/porcelain v2 解析/numstat --no-renames 单源/空仓库与 detached 建模）并在 daemon.ts 平名注册（design §5.2/§7.2 契约），供 task-02 backend status 端点直连消费'
implementation:
  - 'host-fs-handler.ts 新增 git_status 方法（root 唯一入参，零新增注入面），骨架对齐既有四 git 方法（assertWithinAllowedRoots 白名单守卫 → runCmd 独立 argv → 失败结构化回传不抛），成为 host-fs 第 5 个平名 git 方法'
  - 'fetch 降级（D-001）：fetch 单独执行不经 runCmd（其超时把 killed/signal 丢弃、stderr 为空串无法判别），改用本文件 runCommand(:1463) 同款局部 execFile 跑 git fetch --quiet，15s 超时读 err.killed/signal 判定 → fetch_timeout；非零退出 → fetch_failed；先 git remote 预检（无 remote 时 fetch --quiet 静默 exit 0 退出码探测不到）→ no_remote；失败仅记 fetch_error 不阻断后续两步'
  - 'porcelain v2 解析：git status --porcelain=v2 --branch --no-show-stash；# branch.head 值为 "(detached)" 时 detached=true 且 branch 返回 head_short；# branch.upstream 缺失 → upstream=null；# branch.ab 缺失（无 upstream）→ ahead/behind=null；"? " 条目计 untracked_count（CC-05 单源化后 porcelain 仅负责 untracked）'
  - 'head_short 取 # branch.oid 前 8 位截断；branch.oid 为 "(initial)" 兼作空仓库判据（empty=true，branch/upstream/ahead/behind/dirty 计数全 null）；空仓库下 git diff HEAD exit 128 容错转空态，不走红通道 error'
  - 'numstat 汇总：git diff HEAD --numstat --no-renames 覆盖 staged+unstaged 相对 HEAD 工作树全貌；files_changed ≡ numstat 行数（单源无 fallback）；binary 行 "-" 计入 files_changed 不计行数；index-only 差异（staged 后 worktree 还原为 HEAD）不在本口径内，声明排除'
  - 'daemon.ts +1 行 ws.registerRpcHandler 平名注册 git_status（对齐既有四 git 方法注册形态，不走 host_fs. 前缀通道，不改 protocol.ts）'
acceptance:
  - 'porcelain 六类形态解析单测断言全过：正常（upstream+branch.ab）/无 upstream（ahead/behind=null）/detached（branch=head_short）/空仓库 "(initial)"（empty=true 计数全 null）/untracked 混合计数/binary numstat 行（计文件不计行）'
  - 'fetch 三分支降级单测：超时判定走 err.killed/signal 而非 stderr、非零退出 fetch_failed、git remote 预检 no_remote；失败后 branch/dirty 字段仍正常返回（不阻断 ②③）'
  - '命令构造只读断言：仅 fetch/status/diff/remote 只读子命令、全部独立 argv 经 execFile 执行不经 shell（FR-06）'
  - '空仓库返回 empty=true 空态结构（git diff HEAD exit 128 容错不走红通道）；daemon.ts 断言第 5 个平名 git 方法 git_status 注册'
verify:
  - 'cd sillyhub-daemon && pnpm test'
  - 'cd sillyhub-daemon && pnpm typecheck'
constraints:
  - '不改 runCmd 签名与既有四 git 方法行为（fetch 用局部 execFile，runCommand :1463 先例）；零新 npm 依赖、不改 protocol.ts'
  - '无 git 写操作（fetch 为网络同步非本地写）；git 失败结构化回传不抛，仅 root 越界走 RpcError forbidden'
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
