---
id: task-04
title: '前端数据层与页面——lib/deploy-records.ts + queryKeys + /deploy-records 左列表右详情页（MarkdownText 渲染）+ 页面测试'
title_zh: '前端数据层与页面——lib/deploy-records.ts + queryKeys + /deploy-records 左列表右详情页（MarkdownText 渲染）+ 页面测试'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-14 10:04:08
priority: P0
depends_on: ['task-03']
blocks: []
requirement_ids: [FR-03, FR-04, FR-05]
decision_ids: [D-002@v1, D-003@v1]
allowed_paths:
  - frontend/src/lib/deploy-records.ts
  - frontend/src/lib/query-keys.ts
  - NEW:frontend/src/app/(dashboard)/deploy-records/page.tsx
  - NEW:frontend/src/app/(dashboard)/deploy-records/__tests__/page.test.tsx
  - frontend/src/lib/deploy-records.test.ts
target_files:
  - NEW:frontend/src/lib/deploy-records.ts
  - NEW:frontend/src/app/(dashboard)/deploy-records/page.tsx
  - NEW:frontend/src/app/(dashboard)/deploy-records/__tests__/page.test.tsx
  - frontend/src/lib/query-keys.ts
goal: >
  前端发布记录页：/deploy-records 左记录列表（序号/状态徽标/时间/工作区/短SHA/提交数/摘要）
  + 右详情（元数据行 + md 正文渲染），数据层走 apiFetch + react-query 三件套惯例。
expects_from:
  - contract: api-types deploy-records
    needs: [DeployRecordSummary, DeployRecordDetail]
implementation:
  - frontend/src/lib/deploy-records.ts：listDeployRecords/getDeployRecord（apiFetch，record_id encodeURIComponent 整段编码）+ useQuery hooks；类型从 @/lib/api-types 导入
  - frontend/src/lib/query-keys.ts：deployRecords 工厂（all/detail(recordId)）
  - page.tsx：PageContainer(size=full)+PageHeader 骨架（FRONTEND_PAGE_STYLE.md §1）；左列 360px 记录卡片列表（Badge success/failed/invalid 三态，失败红、invalid 灰）、右列详情卡（元数据网格 + MarkdownText 渲染 content）；空态/加载态/错误态；选中态高亮；日期原样展示（后端透传字符串）
  - 样式遵守多主题铁律：brand-* 语义阶、shadow token、不写死 hex（FRONTEND_PAGE_STYLE.md §0.5）；对齐原型 .sillyspec/changes/2026-10-14-deploy-release-notes/prototype-deploy-records.html
  - 测试：page.test.tsx（渲染列表/选中切详情/空态/失败徽标）+ deploy-records.test.ts（fetch 函数 URL 与编码）
acceptance:
  - /deploy-records 页面可渲染 mock 列表与详情，md 正文经 MarkdownText 渲染
  - invalid 记录显示灰徽标不炸页面
  - pnpm lint + vitest 本页测试绿
verify:
  - cd frontend && pnpm test -- deploy-records
  - cd frontend && pnpm lint
constraints:
  - 控件用 antd、布局用 tailwind（FRONTEND_PAGE_STYLE.md §0）
  - 不加回滚/日志/健康检查（D-003@v1）
  - toLocaleString 如用到显式传 zh-CN（CONVENTIONS 8）
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
