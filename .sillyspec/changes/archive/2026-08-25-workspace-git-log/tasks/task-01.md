---
id: task-01
title: 'daemon host-fs 四只读方法（git_log/git_refs/git_show/git_diff_file）+ daemon.ts 平名注册 + 解析边界单测'
title_zh: 'daemon host-fs 四只读方法（git_log/git_refs/git_show/git_diff_file）+ daemon.ts 平名注册 + 解析边界单测'
author: 'qinyi'
created_at: 2026-08-25 21:37:20
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-05, FR-07]
decision_ids: [D-002@v1, D-003@v1, D-006@v1]
allowed_paths:
  - sillyhub-daemon/src/host-fs-handler.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/tests/host-fs-handler-git-log.test.ts
provides:
  - contract: GitDaemonRpc
    fields:
      - 'git_log(commits.hash/parents/message+truncated)'
      - 'git_refs(refs/head+tag_peeled)'
      - 'git_show(commit+files.add/del/binary)'
      - 'git_diff_file(diff/truncated/binary)'
      - '完整字段集见 design §7.2——commits[].hash/short/parents/author_name/author_email/author_date/committer_date/message、refs[].name/short/sha/kind、files[].path/add/del/binary'
goal: 在 daemon 侧落地 git_log/git_refs/git_show/git_diff_file 四个只读 RPC 并在 daemon.ts 平名注册（design §5.2/§7.2 契约），供 task-04 backend git_log 模块直连消费
implementation:
  - 'host-fs-handler.ts 新增四方法，逐一对齐既有骨架（assertWithinAllowedRoots 白名单守卫 → runCmd 独立 argv 执行 git → 失败结构化回传不抛）'
  - 'git_log 跑 git log（--all 或 branch 二选一）+ 可选 --author + -n count + --date=iso-strict + pretty format，%x00 作字段分隔、%x1e 作记录分隔，不按行切'
  - 'git_refs 跑 for-each-ref（refs/heads refs/remotes refs/tags，format 含 %(*objectname)，annotated tag 取 peeled commit sha、无 peeled 回退 objectname）+ rev-parse HEAD'
  - 'git_show 跑 git show sha --numstat --no-renames；git_diff_file 跑 git show sha --unified=3 --no-color -- path，stdout 超 64KB 截断标 truncated、Binary files 输出标 binary'
  - '空仓库边界（git log exit 128 / rev-parse 失败）捕获转空态结构（commits 空表 / head null / refs 空表），不走红通道 error'
  - 'daemon.ts 以 ws.registerRpcHandler 平名注册 git_log/git_refs/git_show/git_diff_file（对齐 explorer_list_dir 注册形态，不走 host_fs. 前缀通道，不改 protocol.ts）'
acceptance:
  - '入参守卫全过单测（root 越界抛 forbidden；sha 匹配 ^[0-9a-fA-F]{4,40}$；branch 匹配 ^[A-Za-z0-9][A-Za-z0-9._/-]*$ 首字符禁 - 且 ≤200 字符；author ≤120 字符；path 拒 :( 开头的 pathspec magic）'
  - '解析单测覆盖中文 message、含引号、多行 body、%x1e 记录分隔、单条解析失败跳过并计数不整页失败'
  - '空仓库返回空态结构；大 diff 超 64KB 返回 truncated=true；二进制文件返回 binary=true'
  - '四方法只构造只读子命令（log/for-each-ref/show/rev-parse），branch/author/path 全部独立 argv 经 execFile 执行不经 shell'
verify:
  - 'cd sillyhub-daemon && pnpm test'
  - 'cd sillyhub-daemon && pnpm typecheck'
constraints:
  - '不新增 HostFsDelegate 方法、不改 protocol.ts 与既有十方法行为、无 git 写操作、不加新 npm 依赖（D-006 平名直连 + D-003 只读）'
  - 'git 失败结构化回传不抛（对齐 gitApply 不抛语义）；仅 root 越界与入参非法走 RpcError forbidden'
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
