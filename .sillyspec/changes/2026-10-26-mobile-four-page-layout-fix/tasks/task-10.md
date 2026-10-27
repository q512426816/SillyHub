---
id: task-10
title: '/m/workspaces 密度收紧（FR-08）'
title_zh: '/m/workspaces 密度收紧（FR-08）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-26 23:19:47
priority: P0
depends_on: [task-02]
blocks: []
requirement_ids: [FR-08]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/app/m/workspaces/page.tsx
  - frontend/src/app/m/workspaces/__tests__/page.m-workspaces.test.tsx
target_files:
  - frontend/src/app/m/workspaces/page.tsx
goal: >
  工作区选择页密度彻底收紧（截图①单屏 1~2 卡）：创建按钮/搜索框/筛选器高度收敛、
  筛选器压一行、卡片内距与字号降档、负责人与路径合并单行（truncate）——单屏可见
  卡片 1~2 → 3~4 个。引用 task-02 的 m-app 密度基座。
implementation:
  - 顶部「创建工作区」按钮高度按 m-app 基座收紧（py 降档）
  - 筛选区三控件（类型/状态/人员）压成一行（横向排布或紧凑 Select）
  - 工作区卡片：padding 降档、名称与徽章行紧凑、slug 路径 + 负责人合并单行 truncate（盲区⑤）
  - 页面测试更新：结构断言按新布局调整
acceptance:
  - 430×932 视口下滚动前可见 ≥3 张工作区卡片（布局类断言 + 真机复验）
  - 超长路径/负责人不换行撑高（truncate 类断言）
  - 页面测试套件全绿
verify:
  - cd frontend && pnpm vitest run src/app/m/workspaces/__tests__/page.m-workspaces.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不动筛选/创建的业务逻辑与 state（纯布局密度）
  - 卡片点击进入工作区的交互与路由不变
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
