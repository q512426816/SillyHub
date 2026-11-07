---
id: task-06
title: '响应分发与结果回喂（批准→执行文本；拒绝→原因，D-007）'
title_zh: '响应分发与结果回喂（批准→执行文本；拒绝→原因，D-007）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-11-07 00:39:35
priority: P0
depends_on: [task-05]
blocks: []
requirement_ids: [FR-04, FR-05]
decision_ids: [D-002, D-007]
allowed_paths:
  - sillyhub-daemon/src/interactive/session-manager/permission.ts
  - sillyhub-daemon/tests/interactive/session-manager-permission.test.ts
target_files:
  - sillyhub-daemon/src/interactive/session-manager/permission.ts
  - sillyhub-daemon/tests/interactive/session-manager-permission.test.ts
goal: >
  在 permission.ts 的 git 拦截分支决策侧接通代执行与拒绝回喂：批准（allow + dialog_result
  action=approve）调 executeGitApproval 并把执行文本（成功含 sha/失败含 stderr）作为 Bash
  工具结果回喂 agent；拒绝（action=reject 或 deny）把用户原因回喂（D-007）且不触发任何
  git 命令、暂存区原样保留。
implementation:
  - 定位 task-03 落地的 git 拦截分支（sillyhub-daemon/src/interactive/session-manager/
    permission.ts，置于 AskUserQuestion 分支（:393 起）与 askUserOnly 自动放行（:457 起）
    之间，D-017）；本 task 只改其 await promise 之后的决策分发段，register/采集/挂起逻辑不动
  - decision 为 allow 且 dialog_result.action=approve → 调 task-05 的 executeGitApproval
    (intent, result, cwd 取 intent.workDir 兜底会话 cwd)，按 AskUserQuestion 先例
    （permission.ts:386-389 注释——deny.message 是 canUseTool 唯一回传自定义内容给 Claude
    的通道，Claude 把 deny.message 当 tool_result 消费）以 behavior=deny、message=执行文本
    回喂；原 Bash 命令不经 agent 重跑（D-002 代执行语义）
  - dialog_result.action=reject 或 decision 为 deny → behavior=deny、message 为
    「用户拒绝了本次提交（推送）：<reason 或默认文案>」——零 git 调用，暂存区原样（D-007）；
    畸形/缺 action 字段的 dialog_result 一律按拒绝处理（fail-safe 不抛）
  - dialog_result 读取走 dialogResultOf(decision) 收敛入口（permission.ts:426/:527 先例）；
    wrapper 异常（executor 抛/register 抛）catch 后 deny 带原因（对齐 permission.ts:596-604
    边界 12 先例，不向上抛让 SDK 当 query 失败）
  - 在 sillyhub-daemon/tests/interactive/session-manager-permission.test.ts 追加分发用例：
    批准→message 含执行文本且 executor 恰被调一次；拒绝→message 含原因且 executor 零调用；
    畸形 dialog_result→拒绝兜底——executor 以注入 fake 替换断言，不起真 git 子进程
acceptance:
  - 批准 commit 后 agent 收到的 Bash 工具结果为执行文本（含 sha 或失败 stderr），原命令未由
    agent 重复执行（D-002/FR-04）
  - 拒绝时回喂含用户原因、暂存区与拒绝前一致（D-007/FR-05）；畸形 dialog_result fail-safe
    走拒绝路径不抛异常
  - 新增分发用例绿；session-manager-permission.test.ts 存量用例零回归
verify:
  - pnpm -C sillyhub-daemon typecheck
  - pnpm -C sillyhub-daemon test -- tests/interactive/session-manager-permission.test.ts
    tests/interactive/session-manager-askuser-dialog.test.ts
constraints:
  - 只改 git 分支决策分发段——task-03 的 register/挂起/askUserOnly 先序（D-017）与既有
    AskUserQuestion（:393）/ExitPlanMode（:471）分支逻辑零改动
  - 回喂通道沿用 deny.message 形态（AskUserQuestion 先例），不引入新的 SDK 回传机制
  - 拒绝路径禁止在 permission 层发起任何 git 命令（拒绝零副作用靠 executor 早退语义兜住，
    分发层只组文本）
  - executor 依赖经模块导入或参数注入解耦，单测以 fake 替换不起真子进程
  - 禁止跑全量测试（规则 0）；daemon ESM import 带 .js 后缀
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
