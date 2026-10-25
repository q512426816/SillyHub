---
author: flow-machine-draft
created_at: 2026-10-25T11:24:16.067Z
updated_by: admin2-pre-draft-persist
---
# 任务注册表（Tasks）— 2026-10-23-pre-session-draft-persist

- [x] task-01: page 预会话回读（FR-01 场景 1）：`session-panel-page.tsx` 预会话分支改 `setInput(readSessionDraft(null, preDraftScope))`；反转既有用例「同一入口重进：输入框恒空白」为「恢复未发送草稿」。落点测试：`session-panel-draft-scope.test.tsx`。
- [x] task-02: dialog idle 回读（FR-01 场景 2，刷新同路径——草稿已落盘，重挂载读回）：`session-panel-dialog.tsx` idle 分支改 `setInput(readSessionDraft(null, workspaceId ?? '-'))`；反转既有用例「同 workspaceId 重开 dialog：恒空白」为「恢复未发送草稿」。落点测试：`session-panel-draft-scope.test.tsx`。
- [x] task-03: 清空语义（FR-02）：新增 page「清空后重进保持为空（不回显旧稿）」与 dialog「清空后重开保持为空」两用例（写 effect 随清空落 `""`，回读得空）。
- [x] task-04: 既有语义零回归（FR-03）：「预会话发送受理即清后再次新建为空」重挂载断言入既有 FR-03 用例；真会话草稿/入口隔离既有用例全绿（含 sessions-portal nonce 用例反转为保留口径、dialog FR-04 describe 反转）。
- [x] task-05: 验证面：`session-panel-draft-scope` + `session-panel-dialog` + `sessions-portal` 三套件全绿（主树 169 例）；另跑 `session-panel` + `session-panel-pre-session` 64 例回归全绿；`npx tsc --noEmit` 本变更文件零错（全仓余 2 错均系并行会话已提交 `a9f5fae15` 所在文件 `session-panel-variant.test.tsx:238` / `page-helpers.tsx:435`，非本变更面不碰）；改动 4 文件 eslint 警告数与 HEAD 完全同量（零新增）。验证期间主树一度被并行会话在途语法错误阻塞，基线与红绿判定在临时 worktree（基线提交 `7355638b7`）完成，主树可编译后全量复跑通过。
