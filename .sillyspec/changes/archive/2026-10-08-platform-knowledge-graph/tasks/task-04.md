---
id: task-04
title: 'daemon handler 测试：注入矩阵/放行样本/钳制/三态回码/裁剪（全注入零子进程）'
title_zh: 'daemon handler 测试：注入矩阵/放行样本/钳制/三态回码/裁剪（全注入零子进程）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-08 17:50:00
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-001@v2]
allowed_paths:
  - sillyhub-daemon/tests/knowledge-governance-handler.test.ts
  - sillyhub-daemon/tests/runtime-handler.test.ts
target_files:
  - sillyhub-daemon/tests/knowledge-governance-handler.test.ts
  - sillyhub-daemon/tests/runtime-handler.test.ts
goal: >
  graph handler 用例全覆盖注入面与回码契约（R-01 安全门的测试钉子）；全注入 sillyspecCmd/rootsProvider，
  不发真子进程（文件头注释惯例）。
implementation:
  - graph 用例组：①子命令白名单外（'impact;'/'rm' 等）→ validation_rejected ②三参数注入矩阵——anchor/anchor2/search 各过 [`; rm -rf`, "`id`", "$(cmd)", '"quoted"', 'a\nb', 'a\tb', 'a%b', 'a^b', "a'b"] 全拒 ③正常样本放行（decision:decisions/unmapped.md#D-002@v2、backend/app/modules/knowledge/router.py、FR-core-engine-001、2026-10-08-x）④edges：'all' 与 16 边型放行、'foo;bar' 拒 ⑤depth 0/4 钳 1/3、limit 0/99 钳 1/50、search 201 字符拒 ⑥命令拼装断言（mock sillyspecCmd 捕获命令串含引号包裹锚点与 --json）⑦旧 CLI 三态（stdout 含 'knowledge <' → cli_subcommand_missing；handler 未注册路径模拟 method_unregistered 由 daemon.ts 注册测试或注释说明；summary/nodes 特定错误 → cli_feature_missing:summary）⑧ok:false 信封 → 对应回码 ⑨orphans items>50 → 截 50 且 count 原值
acceptance:
  - 注入矩阵零漏网（任一恶意样本到达命令串即用例失败）
  - pnpm test 全绿
verify:
  - cd sillyhub-daemon && pnpm test -- knowledge-governance
  - cd sillyhub-daemon && pnpm typecheck
constraints: >
  全注入零真子进程（文件头注释惯例）；注入矩阵任一漏网即用例失败
---
# task-04
