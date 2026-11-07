---
id: task-13
title: '卡片组件测试（三分流渲染/勾选交互/提交拒绝流/超时 deny 清卡路径 R-11）'
title_zh: '卡片组件测试（三分流渲染/勾选交互/提交拒绝流/超时 deny 清卡路径 R-11）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-11-07 00:39:35
priority: P1
depends_on: [task-11, task-12]
blocks: [task-14]
requirement_ids: [FR-06]
decision_ids: [D-019]
allowed_paths:
  - frontend/src/components/daemon/__tests__/git-approval-card.test.tsx
target_files:
  - NEW:frontend/src/components/daemon/__tests__/git-approval-card.test.tsx
goal: >
  新建 git-approval-card 组件测试文件，覆盖 GitApprovalCard 三分流渲染（commit/push/拒绝子态）、勾选与目录级勾选交互、提交与拒绝回传流、以及 R-11 超时 deny 后的清卡路径（resolved 过滤清卡、ended/failed 门控兜底、unknown_request 静默降级），为 FR-06 边界行为与卡片交互提供回归底座。
implementation:
  - 新建 frontend/src/components/daemon/__tests__/git-approval-card.test.tsx，测试基建照 frontend/src/components/daemon/__tests__/pending-dialog-dock.test.tsx 先例——vi.mock("@/lib/daemon") mock respondSessionPermission 防真实请求；makeGitApprovalRequest fixture 工厂（SessionPermissionRequest + dialog_kind=git_approval + dialog_payload 按 design GitApprovalPayload 结构），文件与 aheadCommits fixture 场景照原型 frontend/src/components/prototype/git-approval-view.tsx 的 FIXTURE_FILES/AHEAD_COMMITS（staged 两文件预填勾选+未暂存+未跟踪典型态）
  - 三分流渲染用例——commit 态断言三分组（已暂存/未暂存改动/未跟踪）目录树、四色状态徽标、+N -M 统计、msg 编辑框预填 payload.message、原始命令行与分支徽标；push 态断言目标 remote/分支、protectedBranch 警示徽标存在且确认按钮仍可点（不硬拦）、aheadCommits 逐条渲染（sha/subject/author）与单条展开后文件明细可见且无勾选交互、runner=sillyspec 压扁提示；拒绝子态断言快捷原因 chips 与自由填写输入框
  - 勾选交互用例——默认勾选等于 defaultSelected；行级 checkbox 增/减选并反映到提交按钮计数文案；目录级勾选勾目录=子树全选、再点取消全选、目录行已选/总数计数正确
  - 提交/拒绝流用例——改 msg+减选文件后点提交，断言 respondSessionPermission 以 (sessionId, requestId, "allow", undefined, {action:"approve", message:改后 msg, selectedFiles:最终勾选}) 被调且 onResolved 回调触发、提交后按钮进禁用态；拒绝子态点快捷原因+补文本确认，断言以 "deny" + {action:"reject", reason} 回传
  - payload 边界用例——dialog_payload 缺 files/缺 message/格式不符渲染兜底提示不崩；aheadCommits 超 20 条渲染统计行
  - R-11 超时 deny 清卡路径用例（D-019）——经 PendingDialogDock 挂载 git_approval 请求模拟三分支——①父级过滤 pendingRequests（resolved SSE 语义）后卡与胶囊计数同步清除；②sessionStatus 置 ended/failed 时 dock 整体不渲染（pending-dialog-dock.tsx:95-98 门控兜底清卡）；③mock respondSessionPermission reject unknown_request（HTTP_404 ApiError）→ 卡片静默降级不崩、无未捕获 rejection
  - 文件头注释写明覆盖矩阵（三分流/勾选/提交拒绝/R-11 四组）与 mock 口径（照 pending-dialog-dock.test.tsx:19-21 方言）
acceptance:
  - 三分流渲染/勾选与目录级勾选交互/提交拒绝流/R-11 清卡四组用例全部通过
  - respondSessionPermission mock 断言 dialog_result 字段结构与 design GitApprovalResult 一致（action/message/selectedFiles/reason）
  - 测试在不修改生产代码的前提下通过——mock 或 fixture 缺字段按惯例补齐，不为通过测试改生产代码
  - pnpm -C frontend test -- src/components/daemon/__tests__/git-approval-card.test.tsx 全绿且 pnpm -C frontend exec tsc --noEmit 通过
verify:
  - pnpm -C frontend test -- src/components/daemon/__tests__/git-approval-card.test.tsx
  - pnpm -C frontend exec tsc --noEmit
constraints:
  - 禁止跑全量测试（仅跑本单文件，规则 0）
  - 非测试逻辑本身有误时禁止改测试迁就——组件缺陷回流 task-11/12 修生产代码后重跑
  - mock 缺字段按惯例补齐 fixture（对齐 pending-dialog-dock.test.tsx 先例与规则 21 末条惯例），不为此改生产代码
  - 断言锚定 role/文本/data-testid 等行为面，不断言实现细节类名；用例名与注释中文
expects_from:
  task-11:
    - contract: GitApprovalCard 组件（含 payload 兜底分支）
      needs: [commit/push/拒绝三态渲染, approve/reject 回传]
  task-12:
    - contract: PendingDialogDock kind 分流挂载
      needs: [git_approval 卡挂载, ended/failed 门控, resolved 过滤清卡]
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
