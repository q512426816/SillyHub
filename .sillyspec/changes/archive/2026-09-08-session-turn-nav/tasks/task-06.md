---
id: task-06
title: 'mobile Drawer 入口+集成测试补齐——⋯菜单项+antd Drawer 行式列表、跳转/抑制/菜单集成用例、相关子集测试+tsc'
title_zh: 'mobile Drawer 入口+集成测试补齐——⋯菜单项+antd Drawer 行式列表、跳转/抑制/菜单集成用例、相关子集测试+tsc'
author: 'WhaleFall'
created_at: 2026-09-08 13:44:09
priority: P0
depends_on: ['task-05']
blocks: []
requirement_ids: [FR-04, FR-06]
decision_ids: [D-001@v1, D-007@v1]
allowed_paths:
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - src/app/(dashboard)/sessions/__tests__/page.test.tsx
target_files:
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
expects_from:
  - task-05 的 desktop 挂载完成（TickRail 已在面板渲染，Drawer 复用同组件与回调）
related_tests:
  - 'src/app/(dashboard)/sessions/__tests__/page.test.tsx'
goal: >
  mobile 会话面板补「轮次导航」入口——⋯ 菜单项 + antd Drawer 行式列表（点击即跳、跳后自动关），并补齐跳转/抑制/菜单集成测试用例，跑相关子集测试与 tsc 收口（AC-06/AC-08）。
implementation:
  - header ⋯ 菜单（现行 2634-2700）新增「轮次导航」项；点击打开 antd Drawer（placement=left，宽 min(78vw,300px)，带遮罩）。
  - Drawer getContainer 指面板根（panelRef 局部挂载，不占全屏，R-05）；内容为 TickRail 行式列表形态——触屏无 hover，带摘要行式列表，entries=catalogEntries、onJump=handleJumpToTurn（与桌面同一组件与回调）。
  - onJump 跳转完成后自动关 Drawer（本卡只做开合状态；跳转/循环加载/suppress 行为由 task-04 链路承担）。
  - 集成测试补齐（src/app/(dashboard)/sessions/__tests__/page.test.tsx）：⋯ 菜单项存在与 Drawer 开合、跳转已加载直跳定位、未加载循环加载 + 期间 suppress 触顶不自动加载。
  - 跑相关子集测试（sessions page + session-panel-variant）与 tsc 收口。
acceptance:
  - mobile ⋯ 菜单出现「轮次导航」项；点开左滑 Drawer（宽 min(78vw,300px)、带遮罩）。
  - Drawer 内行式列表覆盖全部轮次（未加载为空心/元数据行）；点击条目触发 handleJumpToTurn 定位并自动关闭 Drawer（AC-06）。
  - 集成用例通过：跳转已加载直跳定位、未加载循环加载且期间触顶不自动加载（AC-04 集成路径）。
  - 既有 mobile 收纳/布局断言不回归；相关子集测试全绿，tsc --noEmit 0 错误（AC-08）。
verify:
  - 'cd frontend && pnpm vitest run "src/app/(dashboard)/sessions/__tests__/page.test.tsx"'
  - cd frontend && pnpm vitest run src/components/daemon/__tests__/session-panel-variant.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - Drawer getContainer 指面板根（局部挂载），不得全屏覆盖、不与悬浮窗高度冲突（R-05）。
  - onJump 后必须自动关 Drawer。
  - dialog 宿主不挂载导航入口（挂载点仅 page 模式渲染分支内，FR-06）。
  - 不动桌面常驻轨布局与 task-05 已挂载结构；mobile ⋯ 菜单既有收纳结构沿用，不改既有断言语义。
  - 零后端改动（D-004）：不碰后端、不改 api-types。
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
