---
id: task-07
title: daemon projects/ 三处排除统一
title_zh: computeIncrementalOps / buildFullManifest / packSpecDir 三处排除清单统一加 projects
author: qinyi
created_at: 2026-08-15 16:06:52
priority: P1
depends_on: []
blocks: [task-10]
requirement_ids: [FR-06]
decision_ids: [D-008@v2]
allowed_paths:
  - sillyhub-daemon/src/spec-sync.ts
  - sillyhub-daemon/tests/spec-sync-incremental.test.ts
  - sillyhub-daemon/tests/spec-sync.test.ts
goal: >
  projects/ 目录（projects/<name>.yaml 含成员机器绝对路径）从 daemon 全部三条上传链路排除：增量 computeIncrementalOps 的 walkDir 排除、全量快照 buildFullManifest 排除、回退 tar packSpecDir 排除。防三洞：增量上传绝对路径文件 / 全量回退路径照样上传 / 全量缓存含行而增量 walk 无 → 生成 delete op 误删服务器行。
implementation:
  - 定位三处排除数组/逻辑（computeIncrementalOps walkDir ~:604、buildFullManifest ~:438、packSpecDir ~:840，以实际代码为准），统一加 'projects'
  - 若三处共用常量（如 EXCLUDE_NAMES）优先改常量单点；不共用则三处分别加并注释互指（防再次漂移）
  - 注意 pull 路径（extractTar 解包）不排除——服务器若已有（历史遗留）projects 行，pull 仍落地本地无妨；仅上传链路排除
acceptance:
  - 本地 specCacheRoot 含 projects/ 时：增量 ops 不含 projects 路径的 add/update/delete；全量 manifest 不含；tar 包不含
  - 全量缓存先含 projects 行（模拟旧状态）→ 增量 walk 排除后**不**生成 delete op（缓存侧行需同步清或 diff 逻辑跳过——实现时验证此边界，确保不误删）
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/spec-sync-incremental.test.ts（新增用例：三链路排除 + 缓存残留不生 delete op）
constraints:
  - 三处必须一起改（N-01：只改增量会引入 delete op 误删）
  - 不影响 .runtime / worktrees 既有排除
---
