---
id: task-01
title: 'daemon scope-audit contract v2 projection (cross_repo + repos[])'
title_zh: 'daemon 投影契约 v2（cross_repo + repos[]）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-20 20:03:38
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: [D-001@v1, D-004@v2]
allowed_paths:
  - sillyhub-daemon/src/sillyspec-manager.ts
  - sillyhub-daemon/tests/sillyspec-file-diff.test.ts
target_files:
  - sillyhub-daemon/src/sillyspec-manager.ts
  - sillyhub-daemon/tests/sillyspec-file-diff.test.ts
provides:
  rpc_scope_audit_v2_fields: [rows[].cross_repo, repos[]（key/anchor{source,base,head,label}/anchor_label/totals{files,additions,deletions,planned,unplanned,untouched}/degraded/degraded_reason）]
goal: >
  daemon auditTable 投影消费 sillyspec --json 契约 v2：行级 cross_repo 与信封 repos[] 透传到
  RPC sillyspec_scope_audit result（backend 消费），repoPath 不出 daemon（D-001），旧 CLI 无键
  安全回退 null。
implementation:
  - sillyhub-daemon/src/sillyspec-manager.ts:385 SillySpecAuditRow 接口增 cross_repo?: string | null（注释更新契约 v2 说明）
  - 新增 SillySpecAuditRepoAnchor / SillySpecAuditRepoTotals / SillySpecAuditRepo 三个导出接口；SillySpecAuditTable（:395 附近）增 repos: SillySpecAuditRepo[] | null
  - auditTable()（sillyhub-daemon/src/sillyspec-manager.ts:1558-1567）rows.push 白名单补 cross_repo: asStr(raw.crossRepo)
  - auditTable() 信封投影：parsed.repos 非数组 → repos: null；是数组 → 逐条防御投影（isRecord + key 非空 string 否则整条跳过；anchor 四字段 asStr；anchor_label = /^[0-9a-f]{7,40}$/.test(base) ? base.slice(0,7) : null——语义锚/无 base → null〔D-004@v2〕；totals 六字段 asCount；degraded boolean；degraded_reason asStr；repoPath 不投影）
  - sillyhub-daemon/tests/sillyspec-file-diff.test.ts:305 auditTable describe 增用例：v2 信封夹具（三仓 repos[] + 跨仓行，按上游契约示例造）断言投影全字段 / 无 repos 键 → repos:null / 505 行截断护栏含跨仓行不受影响 / JSON.stringify(result) 不含 repoPath
acceptance:
  - v2 信封夹具下投影结果逐字段正确（cross_repo 透传、anchor_label 短化、totals 三态计数、degraded_reason、repos 数组序保持）
  - 无 repos 键（旧 CLI）→ repos 为 null，其余投影与现状逐字段一致（回退零回归）
  - 投影结果序列化后不含 repoPath 字符串（D-001）
verify:
  - cd sillyhub-daemon && pnpm typecheck
  - cd sillyhub-daemon && pnpm vitest run tests/sillyspec-file-diff.test.ts
constraints:
  - 只改投影与类型，不改 RPC method 注册/错误码/_runScopeAuditJson 共享执行器
  - repoPath 白名单排除（D-001）；anchor_label 语义锚 → null（D-004@v2）
  - 禁跑全量测试，仅跑本文件相关测试（CLAUDE.md 规则 0）
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
