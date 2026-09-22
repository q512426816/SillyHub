---
id: task-01
title: 'revokePartialSegments 全树扫描撤回（FR-1.1）'
title_zh: 'revokePartialSegments 全树扫描撤回（FR-1.1）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-13 00:24:41
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-1.1]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/components/daemon/session-log-assembler.ts
  - frontend/src/components/daemon/__tests__/session-log-assembler.test.ts
target_files:
  - frontend/src/components/daemon/session-log-assembler.ts
  - frontend/src/components/daemon/__tests__/session-log-assembler.test.ts
goal: >
  修复 override 撤回令箭按 segmentId 前缀路由在 pi 引擎（pi:msg<N>:ci<C>）下静默 no-op 的缺陷：revokePartialSegments 改为全树 DFS 扫描，按 derivesFromSegmentId 移除任意位置（顶层/任意嵌套容器 children）的派生段，对齐 backend quick-0e56260f 声明的「按段 id 任意位置撤回」协议语义。
implementation:
  - 重写 revokePartialSegments（session-log-assembler.ts ~L953-987）：删除 main: 前缀特判与 treeContainsContainerWithId 容器路由分支，改为递归遍历段树（顶层数组 + tool/subagent_stub 容器 children），凡 derivesFromSegmentId(s.id, kind, segmentId) 命中的同类段移除并记入 removedIds，容器 children 变化时沿 applyToBucket/updateContainerById 同款 path-copy 不可变风格重建；无命中返回 null 保持调用方 no-op 语义。
  - 更新函数头注释：说明全树扫描语义与「main:/工具容器前缀特判已删除（语义超集）」的理由，引用 backend quick-0e56260f 协议声明与本变更 D-001。
  - 测试（session-log-assembler.test.ts）：新增 pi 前缀 segmentId（如 pi:msg588:ci1）的顶层 text partial 段收到 override 令箭后被移除（改前复现 no-op 的回归用例）；嵌套工具桶内（tool 段 children）派生段同样被移除（深度>1 用例）；Claude main: 前缀与工具容器路由既有用例断言不变；derivesFromSegmentId 唯一后缀（-2 派生段）歧义防御用例（同 segmentId 分裂段全部撤回）。
acceptance:
  - pi 前缀 segmentId 的 override 令箭使顶层与嵌套容器内全部派生段移除（新用例绿）。
  - 既有 override 撤回系列用例（main:/工具桶/no-op 场景）零改动通过。
  - removedIds 登记完整（下游 ids().delete 与 F7 全量重投影消费链不破坏）。
verify:
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/session-log-assembler.test.ts
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不改 classifySessionLog 的 OVERRIDE_RE 解析与 override 事件入口结构（仅换 revokePartialSegments 内部实现）。
  - 不动 quick-9f86d2c3 封存机制（superseded 登记在调用方，本函数不管）。
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
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
