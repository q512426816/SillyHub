---
id: task-01
title: 'daemon 只读快照——linked_repos_snapshot RPC（spawn workspace status --json + config cat，归一零写盘）（FR-01）'
title_zh: 'daemon 只读快照——linked_repos_snapshot RPC（spawn workspace status --json + config cat，归一零写盘）（FR-01）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-10 23:16:34
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1, D-005@v1]
allowed_paths:
  - sillyhub-daemon/src/linked-repos-snapshot.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/tests/linked-repos-snapshot.test.ts
target_files:
  - NEW:sillyhub-daemon/src/linked-repos-snapshot.ts
  - NEW:sillyhub-daemon/tests/linked-repos-snapshot.test.ts
provides:
  daemon-snapshot:
    handler: "linked_repos_snapshot RPC（平名注册，protocol 零改动）"
    shape: "{projects:[{name,path,role,state,detail}],repos:[{key,path}],fetched_at}（role 空串→null；path 问号/空→null 交 backend 兜底）"
    readonly: "只读铁律——spawn workspace status --json 与 config cat --spec-dir 两条读命令，零写盘（D-005）"
    degrade: "unknown command → 该源 skipped 标注（源级降级非整体失败）"

goal: >
  daemon 只读快照例程——按 RPC 请求现读本机两类 sillyspec 配置归一返回，与下行落盘写链路严格分离
implementation:
  - 新建 src/linked-repos-snapshot.ts——runLinkedReposSnapshot(payload, deps)：spawn workspace status --json（cwd=root_path）解析 projects；spawn config cat --spec-dir root_path（钉住防父目录漂移）解析 local.yaml repos 段（key→path）与 projects 块（相对路径，R-01 兜底源）；execFile 数组形参+60s 超时（对齐 linked-repos-sync.ts 先例）；归一 role 空串→null、path 问号→null；unknown command → 该源空数组+skipped 标注
  - daemon.ts 的 _registerLinkedReposRpcHandler 内追加平名注册 linked_repos_snapshot（root_path 必填缺失 throw）
  - tests/linked-repos-snapshot.test.ts——命令拼装（数组形参/--spec-dir 在场）/JSON 解析归一/repos 段与 projects 块提取/源级降级/零写盘断言（mock exec 断言仅两条读命令）
acceptance:
  - FR-01 daemon 面达成——快照含 projects/repos 双源+fetched_at；零写盘（测试断言 spawn 命令清单）
  - 源级降级——mock unknown command 该源 skipped 标注非整体失败
  - vitest 全绿
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/linked-repos-snapshot.test.ts
constraints:
  - 只读——禁用任何写命令（workspace add/register-repo 属下行链路）
  - config cat 输出只提取 repos 段与 projects 块，其余不进快照（R-02 最小面）
  - 禁跑全量测试（CLAUDE.md 规则 0）
---
