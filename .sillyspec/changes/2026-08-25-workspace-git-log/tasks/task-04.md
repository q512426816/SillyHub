---
id: task-04
title: 'backend service 数据链路完整化（平名 RPC 直连/probe 两态/refs 合并/过滤/分页 lookahead/参数校验）+ router 集成测试'
title_zh: 'backend service 数据链路完整化（平名 RPC 直连/probe 两态/refs 合并/过滤/分页 lookahead/参数校验）+ router 集成测试'
author: 'qinyi'
created_at: 2026-08-25 21:37:20
priority: P0
depends_on: ['task-01', 'task-02', 'task-03']
blocks: []
requirement_ids: [FR-01, FR-04, FR-05, FR-06, FR-07]
decision_ids: [D-005@v1, D-006@v1]
allowed_paths:
  - backend/app/modules/git_log/service.py
  - backend/app/modules/git_log/tests/test_router.py
  - backend/app/modules/git_log/router.py
  - backend/app/modules/git_log/schema.py
expects_from:
  task-01:
    - contract: GitDaemonRpc
      needs: [git_log(commits.hash/parents/message+truncated), git_refs(refs/head+tag_peeled), git_show(commit+files.add/del/binary), git_diff_file(diff/truncated/binary)]
  task-02:
    - contract: GitLogModule
      needs: [GitLogCommitsResponse, GitLogCommitDetailResponse, GitLogDiffResponse, AppError错误族(404/403/502/504/422), RPC超时常量]
  task-03:
    - contract: GraphLayout
      needs: [compute_lanes(CommitRef→CommitLayout.lane+edges)]
provides:
  - contract: GitLogResponses
    fields:
      - GitLogCommitsResponse(git_mode 两态/commits.seq+lane+edges+refs/branches[]/head/has_more)
      - GitLogCommitDetailResponse(files.path+add+del+binary)
      - GitLogDiffResponse(diff/truncated/binary)
goal: >
  补全 git_log service 完整数据链路（绑定解析→probe 两态映射→平名 RPC 直连→refs/lane 合并→分页与参数校验），
  并以 mock daemon RPC 的 router 集成测试锁死七类行为，向 Wave 3 前端 hooks 供数。
implementation:
  - service 数据链路——MemberBindingResolver.resolve_member_binding_or_none 解析绑定（未绑定或 daemon_id 为空→404），root_path 经 resolve_root_path_for_daemon 改写后按平名 RPC 直连 git_log/git_refs/git_show/git_diff_file（get_daemon_ws_hub().send_rpc 显式超时 30s；不经 HostFsDelegate、不走静默降级通道，D-006 CC-02）
  - probe_workspace_git_mode 三态映射——git→git_mode=git、direct→no_git（空态响应非报错）、unknown→按 offline 502 处理不入枚举（D-006 CC-01）
  - refs 合并——git_refs 按 sha 映射进各 commit refs[]（annotated tag 用 peeled commit sha 回退 objectname，CC-04）；HEAD 写入对应 commit 的 kind=head 条目与顶层 head 字段；branches[] 取 git_refs 全量（CC-07）
  - branch/author 过滤透传——branch 非空时替代 --all 下发、author 作 --author 独立 argv；过滤后结果集外的 parent 不产生边（D-005）
  - 分页与 lane 组装——daemon 不用 --skip，count=skip+limit+lookahead(50) 全前缀 compute_lanes（task-03）后只返回窗口与窗口内可见边；seq 为全局绝对序，组装 has_more/total_in_window；skip≤2000、limit≤200（D-004/R-02）
  - 参数校验四类 422 拒绝面——sha 限 4-40 位十六进制、branch 正则禁首横杠且≤200 字符、author 限≤120 可打印字符、path 拒 pathspec magic 前缀并按 explorer _join_within_root 语义 containment 预检；全部先于 RPC（R-01）
  - 错误映射全表（explorer 同构）——not_found→404、forbidden→403、offline 与 mid-rpc 断连→502、timeout→504、method_not_found→422 版本过旧、daemon 返回缺字段→契约缺口 502 显式上报（复用 task-02 AppError 错误族）
  - 新增 backend/app/modules/git_log/tests/test_router.py——仿 backend/tests/modules/explorer/test_explorer.py 的 FakeHub+hermetic fixture 打法（monkeypatch get_daemon_ws_hub），不打真 WS
acceptance:
  - 七分支集成测试全绿——正常列表（lane/edges/refs 合并/branches[]/head/seq 断言）、非 git 工作区 git_mode=no_git 空态 200、daemon 离线 502、超时 504、method_not_found 422 版本过旧、sha 非法 422、path 越界 422 且预检先于 RPC（hub 零调用）
  - 分页与过滤契约断言——skip>0 时 RPC params count=skip+limit+50 且返回窗口 seq 为全局绝对序；branch/author 参数透传且 branch 与 --all 互斥
  - 三端点鉴权——未带 token 401、非工作区成员 403（WORKSPACE_READ 门控）
verify:
  - cd backend && uv run pytest app/modules/git_log -q --no-cov
constraints:
  - 严格只读链路，不新增 HostFsDelegate 方法 / DB 模型 / 迁移（D-003 边界）
  - 集成测试全部 mock daemon RPC，不依赖真 WS 与真 git 仓库（真机全链路冒烟归 task-07）
  - probe=unknown 一律 502 禁止静默降级；git_mode 枚举仅 git/no_git 两态
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
