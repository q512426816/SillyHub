---
id: task-09
title: '/m/ 变更中心搜索行两行化 + PlatformSyncSection mobile 透传（FR-06）'
title_zh: '/m/ 变更中心搜索行两行化 + PlatformSyncSection mobile 透传（FR-06）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-26 23:19:47
priority: P0
depends_on: [task-08]
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/app/m/workspaces/[id]/changes/page.tsx
  - frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx
target_files:
  - frontend/src/app/m/workspaces/[id]/changes/page.tsx
goal: >
  治手机端变更中心搜索行溢出（截图④搜索框 placeholder 被裁）：搜索框独占一行、
  搜索/筛选/重新扫描按钮第二行；同时 PlatformSyncSection 调用点透传 mobile
  （页面自身改动，PC 变更中心不涉）。
implementation:
  - 搜索工具栏（placeholder「搜索 Key / 标题 / 描述 / 组件…」所在行，符号定位）改 flex-col 两行：Input 独占整行，三按钮第二行 flex 行排
  - PlatformSyncSection 调用点（`<PlatformSyncSection workspaceId={workspaceId} compact />`）加 mobile 实参
  - 既有页面测试更新：搜索行结构断言 + PlatformSyncSection mobile 透传断言
acceptance:
  - 搜索框占满容器宽（flex-1/整行断言），placeholder 完整可见
  - 页面测试套件全绿（既有用例按新结构更新）
verify:
  - cd frontend && pnpm vitest run "src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx"
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不动搜索/筛选/重扫的业务逻辑与 state（纯布局）
  - 桌面变更中心页（dashboard 路由）不涉本卡
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
