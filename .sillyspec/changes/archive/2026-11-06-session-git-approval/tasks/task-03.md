---
id: task-03
title: 'permission.ts git interception mount branch (before askUserOnly passthrough, D-017)'
title_zh: 'permission.ts git 拦截挂载分支（askUserOnly 先序，D-017）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-11-07 00:39:35
priority: P0
depends_on: [task-01, task-02]
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-004, D-008, D-017]
provides:
  - contract: git_approval_dialog_register
    fields: [dialogKind, dialogPayload, responseDispatch]
expects_from:
  - task-01 的 detectGitWriteIntent（识别）
  - task-02 的 collectGitApprovalPayload（payload 组装）
allowed_paths:
  - sillyhub-daemon/src/interactive/session-manager/permission.ts
  - sillyhub-daemon/tests/interactive/session-manager-permission.test.ts
target_files:
  - sillyhub-daemon/src/interactive/session-manager/permission.ts
  - sillyhub-daemon/tests/interactive/session-manager-permission.test.ts
goal: >
  在 buildCanUseToolCallback（sillyhub-daemon/src/interactive/session-manager/permission.ts:352）内新增 git 拦截分支：Bash 命令经 task-01 guard 命中 → task-02 采集器组 payload → resolver.register 发 dialog_kind='git_approval' 长驻挂起（无 5min 超时，D-004），复用现有 dialog 管线零协议改动（D-008）；分支位置硬约束在 askUserOnly 自动放行判断（permission.ts:457）之前（D-017）——门户「只问不审」会话的 git 写操作不漏拦（FR-01）。
implementation:
  - 读挂载点现状：permission.ts:393 AskUserQuestion 分支与 :471 ExitPlanMode 分支为并列先例、:457 askUserOnly 自动放行、:405/:575 register 先例；在 askUserOnly 判断之前插入 git 分支（与两先例并列，D-017 先序硬约束）
  - 分支逻辑：toolName 为 Bash 且 process.env.SILLYHUB_GIT_APPROVAL 不等于 'off'（逃生阀，仅 'off' 精确匹配关闭、其余含未设恒 on）→ 取 toolInput.command 字符串 → detectGitWriteIntent（task-01）→ null 落回原路径；命中 → collectGitApprovalPayload（task-02，工作区根取 intent.workDir ?? 会话工作区根——SessionState 现有字段，实现时核对 sillyhub-daemon/src/interactive/session-manager/types.ts）→ resolver.register 携带 dialogKind='git_approval' 与 dialogPayload（形态参照 permission.ts:405 AskUserQuestion 先例）与 backgroundTaskFlag 条件置位 → await promise 长驻挂起（dialogKind 存在即不 arm 5min 兜底——permission-resolver.ts:213 既有语义；后台锚点态例外走 5min deny fail-safe，FR-06/D-019）
  - 响应映射（W1 临时语义，W2 task-06 接管）：approve → allow 透传 updatedInput；reject → deny + 「用户拒绝了本次提交/推送：<原因>」回喂（D-007 语义先落）；异常/abort → deny 默认文案（先例 AskUserQuestion 分支 catch permission.ts:444）；allow 臂留独立小函数/注释锚点标记 task-06 替换为 executeGitApproval 代执行（D-002）
  - 采集降级：采集器失败/超时 → 以最小 payload（仅 operation/command/branch）继续弹卡，禁止因采集失败放行裸 git 命令（fail-closed）
  - 单测（扩展 tests/interactive/session-manager-permission.test.ts）：git commit 命中注册 dialog_kind='git_approval' 且 payload 结构正确；askUserOnly=true 会话 git 命令仍拦不走 :457 放行（D-017 分支位置单测）；SILLYHUB_GIT_APPROVAL=off 走原路径；未命中命令零影响；backgroundTask 锚点态注册带 background_task 标记；wrapper 异常 deny 不上抛
acceptance:
  - Bash git commit/push 在 askUserOnly=true 与 false 会话均触发 resolver.register（dialogKind='git_approval'、dialog_payload 为 task-02 结构）（FR-01/D-017）
  - 分支位置单测通过——askUserOnly 会话的 git 写命令不进入 permission.ts:457 allow-through（D-017 验收证据）
  - 未命中命令与 SILLYHUB_GIT_APPROVAL=off 时行为与现状一致（存量 session-manager-permission.test.ts / session-manager-askuser-dialog.test.ts 用例零回归）
  - 后台锚点态注册带 background_task（5min 兜底 deny 路径可达，FR-06/D-019）；wrapper 异常/abort → deny 带原因不上抛
  - AskUserQuestion（permission.ts:393）/ ExitPlanMode（:471）既有分支逻辑零改动（现有 dialog_kind 分流不受影响）
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/session-manager-permission.test.ts tests/interactive/session-manager-askuser-dialog.test.ts
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
constraints:
  - git 拦截分支必须先于 askUserOnly 自动放行判断（permission.ts:457）——D-017 硬约束
  - 现有 dialog_kind（AskUserQuestion/plan_approval）分支逻辑与 backend 审批链路零改动（dict 透传，D-008）；仅新增分支不改写既有路径
  - 不实现代执行（W2 task-05/06 范围）：allow 臂为临时透传 + task-06 接管锚点注释
  - daemon ESM import 带 .js；规则 0 禁全量测试，仅跑本文件相关测试
  - 逃生阀判定与 task-04 收敛为同一实现/同一默认语义（仅 'off' 关闭），禁止两处默认值漂移
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
