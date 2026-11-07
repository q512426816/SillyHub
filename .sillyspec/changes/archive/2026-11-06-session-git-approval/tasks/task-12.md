---
id: task-12
title: 'PendingDialogDock 分流挂载（:137-152 map 扩展 kind 判别）+ 双模式接线（page/dialog）'
title_zh: 'PendingDialogDock 分流挂载（:137-152 map 扩展 kind 判别）+ 双模式接线（page/dialog）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-11-07 00:39:35
priority: P0
depends_on: [task-11]
blocks: [task-13, task-14]
requirement_ids: [FR-01]
decision_ids: [D-009]
allowed_paths:
  - frontend/src/components/daemon/pending-dialog-dock.tsx
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/session-panel/session-panel-dialog.tsx
target_files:
  - frontend/src/components/daemon/pending-dialog-dock.tsx
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/session-panel/session-panel-dialog.tsx
goal: >
  在 PendingDialogDock 请求 map（frontend/src/components/daemon/pending-dialog-dock.tsx:137-152，现一律渲染 AskUserDialogCard）扩展 dialog_kind=git_approval 判别分流渲染 task-11 的 GitApprovalCard，并核验 page/dialog 双模式挂载点对 git 审批卡零改接线生效（FR-01 前端面——git_approval 请求到达会话页即渲染确认卡）。
implementation:
  - frontend/src/components/daemon/pending-dialog-dock.tsx:137-152 请求 map 扩展 kind 判别——req.dialog_kind 为 git_approval 时渲染 GitApprovalCard（保持 ErrorBoundary 包裹，label 用 git-approval-card，fallback 文案「git 确认卡片渲染失败」），其余 kind 维持 AskUserDialogCard 渲染零改动；GitApprovalCard 接线同款 props（request / minimized=minimizedIds.has(request_id) / onMinimize=handleMinimize / onResolved=onResolved）
  - :95-98 ended/failed 门控（showDock）与最小化/胶囊机制对 git_approval 卡原样复用不动——git 确认卡同享最小化胶囊、还原保态、resolved 后 pendingRequests 过滤触发 prune effect 清胶囊计数；:165 isDialog 仅胶囊标注非分流点，不改
  - 胶囊标题现状核实——resolvePendingTitle（frontend/src/components/permissions/minimized-dialog-capsule.tsx:52-66）对无 questions 数组的 dialog_kind 走「智能体提问」通用兜底，git_approval 胶囊标题暂用该兜底（可接受，不改胶囊文件，超本卡 allowed_paths 范围）
  - 双模式接线核验——session-panel-page.tsx:2138-2139 onPermissionRequest 仅过滤无 dialog_kind 的请求（kind 无关放行）、:3381-3388 dialogs 恢复路径按 dialog_kind 存在合并、:6469-6477 与 session-panel-dialog.tsx:2407-2415 的 dock 互斥挂载（输入栏替换、ended/failed 不渲染）均为 kind 无关通道，预期两 panel 文件无需逻辑改动即对 git_approval 卡生效；仅当发现 kind 相关隐性过滤或类型收窄才做最小修正，并同步 :164-167 等注释提及 git_approval
  - 注释同步——dock 头部注释与两挂载点互斥渲染处注释补充 git_approval 分流说明（2026-11-06-session-git-approval 变更溯源）
acceptance:
  - 携带 dialog_kind=git_approval 的 pendingRequests 在 dock 内渲染 GitApprovalCard；ask_user 等既有 kind 仍渲染 AskUserDialogCard（零回归）
  - git_approval 卡可最小化为右下角胶囊、可还原且编辑态保留、resolved 后随 pendingRequests 过滤清卡清胶囊——与 AskUser 卡同机制
  - page 与 dialog 两挂载点行为一致（输入栏互斥替换、ended/failed 不渲染、刷新经 dialogs 恢复）
  - 现有 frontend/src/components/daemon/__tests__/pending-dialog-dock.test.tsx 全绿（ask_user 路径零回归）
  - pnpm -C frontend exec tsc --noEmit 通过
verify:
  - pnpm -C frontend test -- src/components/daemon/__tests__/pending-dialog-dock.test.tsx
  - pnpm -C frontend exec tsc --noEmit
  - git_approval 分流的渲染与清卡断言归 task-13 测试面（本卡仅验证既有 dock 测试零回归）
constraints:
  - 双模式挂载契约——page/dialog 两挂载点行为必须一致（互斥条件/会话状态门控同源单源 timelineSessionStatus/view.status，不得单侧特判）
  - 现有 dialog_kind（ask_user/plan_approval 等）分流/渲染/最小化/胶囊链路零改动（design 兼容策略硬约束）
  - 不改 ask-user-dialog-card.tsx / minimized-dialog-capsule.tsx / lib 层文件（超 allowed_paths 即超范围）；若 dock 既有测试断言因分流失效，测试修正归 task-15 存量测试面处理，本卡不直接改测试文件
  - 注释与文案中文；不跑全量测试（仅跑 dock 相关测试文件，规则 0）
provides:
  - contract: PendingDialogDock kind 分流挂载
    fields: [git_approval 卡挂载, ended/failed 门控, resolved 过滤清卡]
expects_from:
  task-11:
    - contract: GitApprovalCard 组件导出
      needs: [request, minimized, onMinimize, onResolved]
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
