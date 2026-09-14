---
id: task-06
title: 'frontend-export-entrypoints-and-portal-wiring'
title_zh: '前端入口——session-list-panel.tsx 批量栏「导出选中」Dropdown + 行 hover 下载图标 + exporting state；sessions-portal.tsx 接线'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-14 14:06:52
priority: P0
depends_on: ['task-05']
blocks: []
requirement_ids: [FR-01, FR-06]
decision_ids: []
allowed_paths:
  - frontend/src/components/sessions/session-list-panel.tsx
  - frontend/src/components/sessions/sessions-portal.tsx
target_files:
  - frontend/src/components/sessions/session-list-panel.tsx
  - frontend/src/components/sessions/sessions-portal.tsx
goal: >
  会话列表双导出入口（FR-01/FR-06）：session-list-panel.tsx 批量操作条加「导出选中（N）」
  antd Dropdown（两档菜单）+ 行 hover 操作列加 Download 图标同款 Dropdown，独立
  exporting state 防重入；sessions-portal.tsx 照 onDeleteSessions 模式接线
  onExportSessions → task-05 exportSessions()。
implementation:
  - props 增可选 onExportSessions（ids + tier，照 onArchiveSessions 可选模式；type import SessionExportTier 自 @/lib/daemon/session-export）；主组件 exporting useState（独立，不共享 deleting/archiving）+ handleExportSessions（防重入 try/finally；成功 notify.success「已开始下载…」/失败 notify.error，走既有 useNotify）
  - 批量操作条（batchActive 区 :2541-2575）追加 antd Dropdown 包 Button size="small"「导出选中（{checkedCount}）」，disabled/loading 同删除按钮口径；antd import（:102）追加 Dropdown——该组件树首例
  - 档位菜单单一源（两入口共享防文案漂移）：两项「导出对话（Markdown）」「导出完整信息（JSON+附件）」→ handleExportSessions(ids, tier)
  - 行 hover 操作列（:3133-3223 归档后删除前，对齐原型顺序）加 lucide Download 图标 + 同款 Dropdown，aria-label「导出 {title}」，h-5 w-5 同款 icon button（hover 走 brand 语义阶）；未传 prop 零渲染
  - 回调经组卡片（onBatchExport + exporting）与行（onExport）props 链路下传
  - sessions-portal.tsx :714-796 回调区：onExportSessions 动态 import @/lib/daemon/session-export → exportSessions(ids, tier)（失败 throw 由面板 catch 出 toast，不动选中态/invalidate）
acceptance:
  - 多选态批量栏渲染「导出选中（N）」，菜单两项文案与原型逐字一致，点击以选中 ids + 对应 tier 调 onExportSessions
  - 行 hover 出现下载图标入口，菜单以 [session.id] 单条数组触发回调；未传 onExportSessions 两入口零渲染
  - exporting 独立：导出中两入口 loading 防重入，不与删除/归档互锁；成功/失败经 useNotify 提示
verify:
  - cd frontend && pnpm typecheck
  - cd frontend && pnpm test -- session-list-panel（既有用例零回归；新增用例归 task-07）
constraints:
  - 不修改 lib/ppm/export.ts 与 lib/daemon/session-export.ts（只消费 task-05 导出签名）
  - antd Dropdown 为该组件树首例：色板经 ConfigProvider token 不手写；菜单项文案「导出对话（Markdown）」「导出完整信息（JSON+附件）」与原型一致
  - 多主题铁律：brand-* 语义阶（hover:bg-brand-100 hover:text-brand-700 同置顶/重命名款），不硬编码 hex
  - 多选仅组内语义照现状（batchGroupId 机制不动，导出遵守同一约束）；不改删除/归档既有行为
expects_from:
  - task-05: exportSessions(sessionIds, tier) 签名与 SessionExportTier 类型（@/lib/daemon/session-export）
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
