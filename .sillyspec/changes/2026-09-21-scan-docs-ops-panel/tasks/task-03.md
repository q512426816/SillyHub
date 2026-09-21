---
id: task-03
title: 'frontend ops panel (ScanDocsStatsPanel + mount + tests)'
title_zh: '前端运营面板（组件 + 挂载 + 测试）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-21 09:58:52
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-03, FR-04, FR-07]
decision_ids: [D-001@v1, D-002@v1, D-003@v1]
allowed_paths:
  - NEW:frontend/src/components/scan-docs-stats-panel.tsx
  - NEW:frontend/src/components/__tests__/scan-docs-stats-panel.test.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx
target_files:
  - NEW:frontend/src/components/scan-docs-stats-panel.tsx
  - NEW:frontend/src/components/__tests__/scan-docs-stats-panel.test.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx
expects_from:
  - task-02: getScanDocsStats + scanDocsStatsQueryKey（frontend/src/lib/scan-docs.ts）与生成类型 ScanDocsStatsOut
goal: >
  扫描文档页顶部的运营指标面板：复刻知识库 OpsDashboard 视觉（四子卡大卡 2/3 +
  榜单 1/3），承载覆盖率/陈旧/密度/新鲜四指标与注入频次/最近更新双榜，三态健壮。
implementation:
  - NEW:frontend/src/components/scan-docs-stats-panel.tsx：布局对齐 frontend/src/components/knowledge/ops-dashboard.tsx（lg:grid lg:grid-cols-3、指标大卡 lg:col-span-2 内 sm:grid-cols-2）；覆盖率子卡=综合百分比+「七件套 a/b · 模块文档 c/d」明细+svg polyline 8 周趋势（stroke=currentColor）；陈旧子卡=button 开合内嵌清单（路径+最后修改时间/未知，上限 200 滚动）；密度子卡=篇/项目+原生 title 口径注记；新鲜子卡=recent_updated/total；右侧榜双 tab——「🔥 注入频次」（默认：路径+hits_30d，头部小结「近 30 天 N 次 · M 篇」）与「🕘 最近更新」（路径+相对时间），注入数据全零时空态文案「暂无注入数据（CLI 升级后自动汇聚）」；三态：isPending/isError/空文档占位（对齐 ops-dashboard 三态形态）
  - frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx：PageHeader 之下、pageError 条之上挂 <ScanDocsStatsPanel workspaceId={workspaceId} />（对齐知识库页 OpsDashboard 挂点位置语义）；面板走组件内 useQuery 独立数据链
  - NEW:frontend/src/components/__tests__/scan-docs-stats-panel.test.tsx：mock lib 的 getScanDocsStats——指标渲染（覆盖率百分比/两档明细/陈旧数字/密度/新鲜）、陈旧清单开合、双榜 tab 切换、注入空态、isPending/isError 三态
  - frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx：补 mock stats 接口防挂载请求泄漏 + 一条面板挂载冒烟断言
acceptance:
  - 面板四子卡数值与 stats 响应一致；覆盖率综合百分比=(std_have+module_have)/(std_expected+module_expected) 取整
  - 陈旧卡点击开合内嵌清单，清单行为空数据显示「未知」
  - 双榜 tab 可切换；注入榜数据全零（total_30d=0）时空态文案出现且不报错
  - isPending/isError/无文档三态占位同版位不白屏；面板加载失败不影响页面主列表
  - page.tsx 挂载位置在 PageHeader 之下（jsdom 冒烟断言 panel testid 存在）
verify:
  - cd frontend && pnpm exec vitest run src/components/__tests__/scan-docs-stats-panel.test.tsx "src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx"
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec eslint "src/components/scan-docs-stats-panel.tsx" "src/components/__tests__/scan-docs-stats-panel.test.tsx" "src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx"
constraints:
  - 视觉/结构照抄 ops-dashboard.tsx 形态（brand 语义阶、中文文案、data-testid 命名风格）
  - 不引入新依赖；相对时间/日期本地化在前端算
  - 不改页面既有树/搜索/卡片视图/后台同步逻辑
  - data-testid：ops-panel 根 + metric-coverage/metric-stale/metric-density/metric-freshness + injection-board/recent-board + 双榜 tab 按钮
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
