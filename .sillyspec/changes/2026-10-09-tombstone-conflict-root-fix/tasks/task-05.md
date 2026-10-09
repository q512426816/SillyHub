---
id: task-05
title: 'sillyspec 仓 CLI 归因记账（纯墓碑归因+幂等合并+全绿清理+type 透传）'
title_zh: 'sillyspec 仓 CLI 归因记账（纯墓碑归因+幂等合并+全绿清理+type 透传）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-09 11:58:09
priority: P0
depends_on: []
blocks: [task-04]
repo: sillyspec
base_commit: 4fd3a0bec5a97789fb9a62b4438479329ab38cad
requirement_ids: [FR-01]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - src/spec-sync.js
  - src/progress/stage-machine.js
  - test/spec-sync-platform-deleted-receipt.test.mjs
  - test/spec-sync-tombstone-attribution.test.mjs
  - docs/sillyspec/file-lifecycle.md
target_files:
  - src/spec-sync.js
  - src/progress/stage-machine.js
  - test/spec-sync-platform-deleted-receipt.test.mjs
  - NEW:test/spec-sync-tombstone-attribution.test.mjs
  - docs/sillyspec/file-lifecycle.md
goal: >
  sillyspec CLI 纯墓碑冲突按被删变更归因记账并自动清理（FR-01 四场景）——杜绝「一个根因伪装成
  91 条冲突」的累积机制。跨仓任务（repo: sillyspec，仓根 C:/Users/qinyi/IdeaProjects/sillyspec），
  在该仓自己的 dogfood 流程内收口（flow start --input 已做改动+成功标准 → flow done 实测门）。
implementation:
  - src/spec-sync.js 纯墓碑分支（realPaths.length===0 && tombstoned.length>0，约 636-657 行）改造：从 body.platform_deleted 路径剥被删变更名（changes/<name>/ 与 changes/archive/<name>/ 两前缀），按被删变更落 .runtime/spec-sync-conflict-<被删变更>.json（不再用当轮同步标签）；记录 {change, kind:'tombstone', created_at（首见保持）, last_seen（刷新）, platform_deleted（该变更名下路径并集）, note}；文件已存在幂等合并；剥不出的路径归 __unattributed__ 聚合记录
  - 横幅改单根因叙事：每个被删变更一行「变更 X 被平台删除墓碑拒收（N 路径）」
  - 全绿同步（body.conflict 假且无拒收）新增清理：扫描 .runtime/ 全部 spec-sync-conflict-*.json，删除纯墓碑形态记录——判定式 conflicting_paths 为空 且 platform_deleted 非空（kind 无关，覆盖现行 kind:'spec-tree' 存量与 91 条旧格式；混合形态永不清理）
  - src/progress/stage-machine.js _listPendingConflicts（约 365-383 行）type 判定：记录 JSON 有 kind 字段时优先透传（kind='tombstone' → type 'tombstone'），文件名前缀判定保留兜底
  - test/spec-sync-platform-deleted-receipt.test.mjs 扩展既有 2 用例（归因文件名/幂等合并/全绿清理）
  - 新增 test/spec-sync-tombstone-attribution.test.mjs：多路径剥名矩阵/归档区前缀/__unattributed__ 桶/混合形态不误清/存量 kind:'spec-tree' 纯墓碑被清理判定/type 透传
acceptance:
  - 纯墓碑拒收后 .runtime/ 下每个被删变更最多一条记录（重复同步幂等合并，created_at 首见保持）
  - 全绿同步后纯墓碑记录清零；混合形态（conflicting_paths 非空）保留
  - progress show --json 的 pending_conflicts 中墓碑记录 type='tombstone'
  - 归档区前缀路径正确归因；剥不出变更名入 __unattributed__
verify:
  - cd C:/Users/qinyi/IdeaProjects/sillyspec && npm test -- test/spec-sync-tombstone-attribution.test.mjs test/spec-sync-platform-deleted-receipt.test.mjs
  - cd C:/Users/qinyi/IdeaProjects/sillyspec && npm run lint
constraints:
  - CLI 一律在主仓库根目录跑（sillyspec 仓自身 CLAUDE.md 规则 14；本仓规则 22 同义）
  - 触及 src/stages/* 或文件生命周期代码时同步 docs/sillyspec/file-lifecycle.md（本 task 改冲突记录文件名/格式——sync-conflict-*.json 运行时文件类型，需同步该文档「新增/删除运行时文件类型」节）
  - 收口走该仓轻量变更（flow start/flow done 实测门），不裸提交
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
