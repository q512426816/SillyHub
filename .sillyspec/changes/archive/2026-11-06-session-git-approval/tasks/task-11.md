---
id: task-11
title: 'GitApprovalCard 组件（commit 态目录树勾选/msg 编辑/push 态按条明细可展开/拒绝态）'
title_zh: 'GitApprovalCard 组件（commit 态目录树勾选/msg 编辑/push 态按条明细可展开/拒绝态）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-11-07 00:39:35
priority: P0
depends_on: [task-01, task-09]
blocks: [task-12, task-13, task-14]
requirement_ids: [FR-02, FR-03, FR-05]
decision_ids: [D-006, D-009, D-012, D-014, D-015]
allowed_paths:
  - frontend/src/components/daemon/git-approval-card.tsx
target_files:
  - NEW:frontend/src/components/daemon/git-approval-card.tsx
goal: >
  新建 GitApprovalCard git 确认对话卡组件（commit 态目录树勾选+msg 编辑 / push 态按条明细可展开+保护分支警示 / 拒绝态快捷原因），props-only 消费 W1 冻结的 GitApprovalPayload、经现有 respondSessionPermission 回传 GitApprovalResult，为 task-12 的 dock 分流挂载与 task-13 的组件测试提供组件契约；UI 形态以已批准原型 git-approval-view.tsx 为基准。
implementation:
  - 新建 frontend/src/components/daemon/git-approval-card.tsx 导出 GitApprovalCard；props 对齐 AskUserDialogCard 先例（frontend/src/components/ask-user-dialog-card.tsx:183-207）——request（SessionPermissionRequest）/ minimized / onMinimize / onResolved，dock 分流挂载时与 AskUser 卡同 props 面接线（D-009）
  - 组件内局部 interface GitApprovalPayload / GitApprovalResult，逐字段照 design.md 接口定义节（operation/command/worktree/branch/message/remoteTarget/runner/protectedBranch/aheadCommits/files/defaultSelected 与 action/message/selectedFiles/reason），不强类型化 openapi；dialog_payload 防御性解析，缺字段/格式不符走兜底提示分支不崩（对齐 ask-user-dialog-card.tsx:384 先例）
  - commit 主态：原始命令等宽行（payload.command）+ msg textarea 预填 payload.message 可编辑 + 文件列表顶层三分组（已暂存=files[].staged 为 true；未暂存改动=非 staged 且 status 不为 untracked；未跟踪=status 为 untracked）+ 组内目录树（复用 frontend/src/components/git-log/file-tree.tsx:82 buildFileTree 形态做字段适配映射，文件行只显 basename、路径逐级折叠）+ 四色状态徽标 + 增删行数 +N -M（numstat 双口径由 payload 给定）+ 行级 checkbox + 目录级勾选（勾目录=勾子树全部、目录行显示已选/总数与子树增删聚合）+ FileText 单文件 diff 入口；结构照原型 frontend/src/components/prototype/git-approval-view.tsx 的 CommitCard/GroupHeader/TreeDirRow/FileRow 同方言（D-012）
  - 勾选态 useState 初始化自 payload.defaultSelected（预填=agent 意图范围）；提交按钮文案「提交 N 个文件」，勾选为空时禁用提交
  - push 主态：remoteTarget/分支展示 + protectedBranch 为 true 时红色保护分支警示徽标（警示不硬拦，D-006）+ aheadCommits 按条明细（short sha 徽标+subject+author/date+汇总增删，D-014）单条可点开展开该提交 files 明细（目录树+四色徽标+增删统计，与提交确认卡同款展示、纯浏览无勾选交互，D-015）+ runner 为 sillyspec 时显示「确认后将按变更段压扁后推送」语义提示；aheadCommits 超 20 条渲染统计行兜底
  - 拒绝子态（卡内切换非独立 kind）：快捷原因 chips（照原型文案）+ 自由填写 textarea + 「返回确认卡」；确认拒绝调 respondSessionPermission(sessionId, requestId, "deny", undefined, dialog_result) 其中 dialog_result 为 {action:"reject", reason}（D-007 语义）
  - 提交路径：approve 调 frontend/src/lib/daemon/sessions.ts:98 的 respondSessionPermission(sessionId, requestId, "allow", undefined, dialog_result)，dialog_result 为 {action:"approve", message:用户改后的 msg, selectedFiles:最终勾选}；成功后置 submitting 禁用态并回调 onResolved，等 permission_resolved SSE 由父级移卡（对齐 ask-user-dialog-card.tsx:342 提交先例）；失败显示错误可重试
  - 单文件 diff 弹窗：antd v6 Modal（色经 ConfigProvider token）+ 复用 frontend/src/components/git-log/file-tree.tsx:193 DiffBody 渲染 unified diff；取数走 W3 会话级端点 GET /api/daemon/sessions/{sessionId}/git-diff?path=（apiFetch + 局部最小响应类型，或引用 task-10 生成的 api-types 导出）；loading/error/truncated/binary 三态对齐 frontend/src/components/git-log/worktree-diff-modal.tsx 形态——其取数 hook 绑 workspace 端点不能直接复用，只复用形态与 DiffBody；关闭态零请求
  - minimized 为 true 渲染 null 但保持挂载（全部 hooks 在该 return 之前，对齐 ask-user-dialog-card.tsx:381 先例，最小化期间勾选/msg 编辑态随挂载保留）
acceptance:
  - commit 态渲染三分组目录树与四色徽标增删统计，勾选预填等于 defaultSelected，msg 编辑框预填 payload.message 且可修改
  - 目录级勾选联动子树全选/全不选，目录行显示已选/总数与子树增删聚合；提交按钮文案随勾选数更新，空勾选禁用
  - push 态渲染目标 remote/分支；protectedBranch 显示警示徽标且不阻断确认按钮；aheadCommits 逐条渲染且单条可展开 files 明细（展开态无任何勾选交互）；runner=sillyspec 显示压扁语义提示
  - 拒绝子态快捷原因+自由填写可用，确认拒绝以 decision=deny + dialog_result 含 action=reject 与 reason 回传；approve 以 decision=allow + dialog_result 含 action=approve/message/selectedFiles 回传（字段名照 GitApprovalResult 定义）
  - 单文件 diff 弹窗调会话级 git-diff 端点并以 DiffBody 红绿渲染，关闭态不发起请求
  - dialog_payload 缺字段/格式不符时渲染兜底提示不崩溃；minimized 渲染 null 保持挂载
  - 颜色全语义 token 零硬编码 hex；pnpm -C frontend exec tsc --noEmit 通过
verify:
  - pnpm -C frontend exec tsc --noEmit
  - 组件交互与清卡测试面归 task-13（本卡不写测试，仅类型检查验收）
constraints:
  - 颜色零硬编码 hex，全走 frontend/src/styles/themes.ts 语义 token（brand-*/border/bg-card/text-success 等）；阴影走 shadow-* token
  - antd v6 组件（Modal 等）色经 ConfigProvider token 配置，不手写组件色
  - 卡是 props-only 数据映射在卡内——payload 解析/勾选态/提交组装全部组件内局部，不引全局 store、不改 lib 层（respondSessionPermission 现有 API 零改动）
  - 现有 dialog_kind（ask_user/plan_approval）组件与渲染零改动；UI 结构以已批准原型 frontend/src/components/prototype/git-approval-view.tsx 为基准但不 import 原型文件（原型仅形态基准，逻辑独立实现）
  - 文案与注释中文；不跑全量测试（规则 0，本卡无测试面）
provides:
  - contract: GitApprovalCard 组件导出
    fields: [request, minimized, onMinimize, onResolved]
  - contract: GitApprovalCard 组件（含 payload 兜底分支）
    fields: [commit/push/拒绝三态渲染, approve/reject 回传]
expects_from:
  task-02:
    - contract: GitApprovalPayload
      needs: [operation, message, files, defaultSelected, aheadCommits]
  task-09:
    - contract: GET /api/daemon/sessions/{id}/git-diff 端点
      needs: [单文件 unified diff 文本]
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
