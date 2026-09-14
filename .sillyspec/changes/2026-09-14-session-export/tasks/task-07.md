---
id: task-07
title: 'frontend-export-entrypoint-tests'
title_zh: '前端测试——__tests__/session-list-panel.test.tsx 追加导出入口用例'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-14 14:06:52
priority: P0
depends_on: ['task-06']
blocks: []
requirement_ids: [FR-01, FR-06]
decision_ids: []
allowed_paths:
  - frontend/src/components/sessions/__tests__/session-list-panel.test.tsx
target_files:
  - frontend/src/components/sessions/__tests__/session-list-panel.test.tsx
goal: >
  在既有 session-list-panel.test.tsx 追加导出入口交互用例（FR-01/FR-06）：批量栏
  「导出选中」按钮渲染与两档菜单项触发回调、行级 hover 下载图标入口，锁住
  task-06 的 UI 契约防回归。
implementation:
  - 照「批量与单条删除」describe 块既有写法（setWorkspaces + mocks.listAgentSessions + renderPanel + openGroup + fireEvent/waitFor）追加导出 describe；onExportSessions 用 vi.fn().mockResolvedValue(undefined)（面板成功路径，不真发请求）
  - 用例 1（批量 chat 档）：组头「多选」→ 勾选 2 条 → 断言「导出选中（2）」按钮在 → 点开菜单 → 点「导出对话（Markdown）」断言 onExportSessions(["s-1","s-2"], "chat")
  - 用例 2（批量 full 档）：点「导出完整信息（JSON+附件）」断言 tier="full"（两档菜单都锁）
  - 用例 3（行级）：点 aria-label「导出 会话A」图标 → 菜单项 → onExportSessions(["s-1"], "chat")；不传 onExportSessions 时两入口不存在（可选模式零渲染）
  - antd Dropdown 弹层挂 body 门户：经 screen 全局查询菜单项（不加 testid）；mock 集已覆盖 useNotify（notifyMocks），如需断言 toast 直接挂 spy
acceptance:
  - 三类入口用例全绿：批量两档 + 行级单条，回调参数（ids 数组 + tier）精确断言
  - 既有用例零改动零回归（只追加不改既有断言）
verify:
  - cd frontend && pnpm test -- session-list-panel
  - cd frontend && pnpm typecheck
constraints:
  - 只追加用例不动既有断言；实现有误时不改测试凑绿（回改 task-06 实现）
  - 不触碰 session-list-panel.tsx / sessions-portal.tsx / lib 文件（纯测试卡）
  - 用例命名与注释风格随既有文件（中文 describe/it + 顶部依据注释）
expects_from:
  - task-06: onExportSessions prop 与「导出对话（Markdown）」「导出完整信息（JSON+附件）」菜单项交互
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
