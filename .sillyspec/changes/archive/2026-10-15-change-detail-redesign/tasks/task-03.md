---
id: task-03
title: "Assets panel — standalone graph section and asset groups"
title_zh: "产出面板：图谱独立分区 + 六组资产形态改造"
author: qinyi
created_at: 2026-10-16 00:25:57
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-05, FR-06]
decision_ids: [D-001@v1, D-003@v1, D-016@v1]
allowed_paths:
  - frontend/src/components/changes/detail/change-assets-card.tsx
  - frontend/src/components/changes/detail/change-assets-graph.tsx
  - frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx
  - frontend/src/components/changes/detail/__tests__/change-assets-graph.test.tsx
  - NEW:frontend/src/components/changes/detail/__tests__/change-assets-fallback.test.tsx
target_files:
  - frontend/src/components/changes/detail/change-assets-card.tsx
  - frontend/src/components/changes/detail/change-assets-graph.tsx
  - frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx
  - frontend/src/components/changes/detail/__tests__/change-assets-graph.test.tsx
  - NEW:frontend/src/components/changes/detail/__tests__/change-assets-fallback.test.tsx
goal: >
  知识图谱脱离资产卡内嵌、成为可独立挂载的分区；六组资产由「固定高度+组内滚动」改为自然高度+最多 5 行+展开全部；在途态不渲染归档留档组；资产卡主查询失败由整卡消失改为分区级错误说明（归档态归档留档保底渲染）。
implementation:
  - "frontend/src/components/changes/detail/change-assets-graph.tsx 由「资产卡内嵌分区」改为可独立挂载：导出画布高度常量 DEFAULT_CANVAS_HEIGHT = 420（原内嵌 280px；props 可覆盖），右侧节点详情栏与层级 chips 保留"
  - "图谱空态由「三态整区静默 return null」改为分区级显式空态：容器保留（标题 + 层级 chips 禁用态 + 一行三态文案——「图谱数据不可用」/「图谱数据暂不可用，稍后自动重试」/「本变更暂无图谱邻域」）；retry:false 口径不变（不轰炸）"
  - "frontend/src/components/changes/detail/change-assets-card.tsx：移出图谱分区挂载（改由「产出」tab 独立挂载，见 task-07）；六组资产分组由固定 h-64 + 组内滚动改为自然高度、每组最多直接显示 5 行 + 超出给「展开全部 N 条」（可收起）"
  - "在途态（isTerminalChange 为假）不渲染「归档留档」分组——不得以空态或占位形态出现；归档态保留该组（patch/delta 统计 + 文件清单「看 diff」入口）"
  - "主查询 isError 由「整卡 return null」改为卡头保留 + 分区级错误说明（一行「沉淀资产暂不可用」）；归档态下「归档留档」保底渲染（走其自身 patch 摘要取数路径，不依赖主查询成功）"
  - "四个弹窗（测试文件 / 模块文档 / patch 单文件 diff / 知识条目）机制原样保留，不改交互"
  - "测试：改造 frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx 与 change-assets-graph.test.tsx 既有用例适配新形态；新增 frontend/src/components/changes/detail/__tests__/change-assets-fallback.test.tsx 覆盖资产卡错误分支与归档保底渲染"
acceptance:
  - "图谱分区不再位于资产卡分组网格内（DOM 上不嵌套于资产卡 section）；默认画布高度 420（常量可覆盖）"
  - "图谱三态（失败/不可用/空）各自渲染对应文案且分区容器仍在场（MUST NOT 整区消失）"
  - "六组中任一组的可见行数 <=5，超出时渲染「展开全部 N 条」；展开后可见全部且可收起；MUST NOT 出现组内独立滚动容器"
  - "在途态 DOM 中不含「归档留档」文本；归档态含 patch 统计行与「看 diff」入口"
  - "主查询失败时资产卡卡头仍在场且有错误说明；归档态失败时「归档留档」仍渲染（保底）——本卡同时是实现方与断言方（change-assets-fallback.test.tsx），不得把断言留给 task-08"
verify:
  - "cd frontend && pnpm exec tsc --noEmit"
  - "cd frontend && pnpm exec vitest run frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx frontend/src/components/changes/detail/__tests__/change-assets-graph.test.tsx frontend/src/components/changes/detail/__tests__/change-assets-fallback.test.tsx"
constraints:
  - "不改 GraphCanvas（frontend/src/components/knowledge/graph-canvas.tsx）本体：只调高度与空态外壳"
  - "不改资产聚合端点与 DTO（后端零改动）；getChangeAssets 取数口径不变"
  - "四个弹窗的机制与文案 MUST NOT 变更（既有用例断言是其钉子）"
  - "禁硬编码 hex；分组容器用既有 IssueRow/Counter 等 primer 原子件，不自造彩色 span"
  - "归档留档保底渲染 MUST 走其自身 patch 摘要取数路径，MUST NOT 依赖资产主查询成功（否则保底无效）"
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
