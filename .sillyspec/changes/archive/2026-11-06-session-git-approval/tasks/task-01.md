---
id: task-01
title: 'git-command-guard pure detection function (segment split / parse / prefill rules / sillyspec push forms)'
title_zh: 'git-command-guard 命令识别纯函数（拆段/解析/预填规则/sillyspec push 形态）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-11-07 00:39:35
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-003, D-005, D-012, D-013]
provides:
  - contract: GitCommandIntent
    fields: [operation, runner, command, message, messageFile, pathspec, allTracked, pushTarget, workDir]
  - contract: detectGitWriteIntent
    fields: [command]
  - contract: resolveDefaultSelection
    fields: [intent, status]
expects_from: []
allowed_paths:
  - sillyhub-daemon/src/interactive/git-command-guard.ts
target_files:
  - NEW:sillyhub-daemon/src/interactive/git-command-guard.ts
goal: >
  新建 sillyhub-daemon/src/interactive/git-command-guard.ts 纯函数识别模块：把 agent Bash 命令按 && / || / ; / | 拆段逐段匹配，识别 git commit / git push / sillyspec push（推送形态），产出含 runner 字段的 GitCommandIntent，并实现 D-012 预填勾选规则 resolveDefaultSelection——为 task-03/04 两个挂载点提供识别内核；未命中返回 null 走原路径零影响（FR-01，R-01/R-09 防绕过与漏拦的根）。
implementation:
  - 按 design.md「接口定义」节实现 GitCommandIntent 接口（operation/runner/command/message/pathspec/allTracked/pushTarget/workDir）与 detectGitWriteIntent(command) 纯函数（依据 .sillyspec/changes/2026-11-06-session-git-approval/design.md 接口定义节）
  - 拆段识别：按 && / || / ; / | 把复合命令拆成子命令段逐段匹配（R-01 知识库实证「git add ... && git commit」前缀绕过坑），段内识别 git commit / git push 与 git -C <path> 前缀形态（workDir 记入 intent）
  - commit 解析：-m 单段与多段拼接（空格连接）；-F <file> 以扩展字段 messageFile 携带文件路径（guard 保持纯函数不读盘，文件内容由挂载层 task-03 采集阶段读取后填 payload.message）；位置参数 pathspec 与 -a 标志
  - push 解析：remote/ref 位置参数（缺省 null，语义为默认 origin+当前分支）；sillyspec push 识别（R-09/D-013）——默认形态与 --mode one / --remote <r> / --branch <b> 等拦（runner='sillyspec'，command 为命中段原文供确认后原样代执行），--dry-run / --no-push / --undo 无推送副作用不拦（返回 null）
  - 预填规则：实现 resolveDefaultSelection(intent, status)（D-012 裁决序——命令带 pathspec 勾 pathspec；带 -a 勾全部 tracked 改动；都无勾当前暂存区；暂存区空勾全部改动），并在模块内定义其消费的最小 WorkspaceStatus 输入形态（files[] 含 path/status/staged）供 task-02 采集产出对齐
  - 不拦清单固定（D-003/D-013）：git add / status / log / diff 等非 commit/push 段、merge / rebase / reset / checkout -- 历史改写（v1 范围外）、非 git 命令与空串；任何解析异常返回 null 不抛错
acceptance:
  - detectGitWriteIntent 对裸 git commit -m x / git push / git -C <path> commit / sillyspec push / 复合命令段命中均返回 intent，operation/runner/command/workDir 字段正确
  - git add . && git commit -m x 命中 commit 段（前缀段不造成漏判，R-01）；git status 等读命令与 git add 返回 null
  - -m 多段拼接 message 正确；pathspec / -a / push remote-ref 位置参数解析正确（缺省为 null）
  - sillyspec push 默认与 --mode one / --remote origin 拦（runner='sillyspec'），--dry-run / --no-push / --undo 返回 null（D-013）
  - resolveDefaultSelection 四分支按 D-012 裁决序产出勾选集
  - cd sillyhub-daemon && pnpm exec tsc --noEmit 零错误（行为回归由 task-07 单测矩阵覆盖，本 task 不写测试文件）
verify:
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
constraints:
  - 纯函数无副作用：不 spawn 子进程、不读盘、不读环境变量、不抛错（识别不了返回 null 放行原路径）
  - daemon ESM import 一律带 .js 扩展名（知识库约定）
  - v1 防御边界以 D-003/D-013 不拦清单为准，base64 包裹等怪异绕过形态不做防御（design 非目标，已知限制）
  - GitCommandIntent 字段按 design 接口定义冻结（W2 executor / W4 卡片同构消费）；仅允许 -F 落地所需的 messageFile 扩展字段，其余不私改
  - 命令文本解析与平台无关（不假设路径分隔符/工作目录），兼容 Windows/Linux/macOS
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
