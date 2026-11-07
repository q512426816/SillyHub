---
id: task-05
title: 'git-executor 代执行引擎（精确暂存区重整 commit / runner 分流 push，D-018）'
title_zh: 'git-executor 代执行引擎（精确暂存区重整 commit / runner 分流 push，D-018）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-11-07 00:39:35
priority: P0
depends_on: [task-01, task-02]
blocks: [task-06, task-08]
requirement_ids: [FR-04]
decision_ids: [D-002, D-013, D-018]
allowed_paths:
  - sillyhub-daemon/src/interactive/git-executor.ts
target_files:
  - NEW:sillyhub-daemon/src/interactive/git-executor.ts
goal: >
  新建 daemon 本机代执行引擎 git-executor.ts：用户批准 commit 后先精确重整暂存区再提交（D-018），
  push 按 runner 分流代执行（git push / sillyspec push 原样代执行，D-013），产出回喂 agent 的
  结果文本——「不交回 agent 重跑」的代执行语义（D-002）在本 task 落地执行面，供 task-06 分发调用。
implementation:
  - 新建 sillyhub-daemon/src/interactive/git-executor.ts：导出 GitExecResult（ok/text/sha?）与
    executeGitApproval(intent, result, ctx)——签名逐字对齐 design.md 接口定义节；intent 消费
    task-01 的 GitCommandIntent（sillyhub-daemon/src/interactive/git-command-guard.ts），result
    为前端回传 GitApprovalResult 的 daemon 侧局部 interface（W1 契约冻结结构，不引新依赖）
  - commit 流精确暂存区重整（D-018）：先跑 git status --porcelain=v2 取当前暂存集 →
    对「已暂存但未勾选」执行 git reset -- <paths>、对「勾选但未暂存」执行 git add -- <paths>、
    「已暂存且勾选」不动——禁止裸 reset（共享工作区其他会话的 staged 文件不被代清，仓纪
    「不替别人清理」）→ git commit -m <用户改写 msg>（msg 单 argv 传递）
  - push 流 runner 分流：runner=git 代执行 git push <remote> <branch>（intent.pushTarget
    缺省补 origin+当前分支）；runner=sillyspec 原样代执行 intent.command 命中段命令——零附加
    参数（原命令带 --json 回 json 输出、否则回人类可读输出，压扁+推送语义保留）；遇
    sillyspec-push.lock 被占则等待释放、超时按失败回喂（R-10）
  - 子进程全部 execFile 数组形参不经 shell（对齐 sillyhub-daemon/src/host-fs-handler.ts:598
    runCmd 先例——windowsHide + maxBuffer + timeout）；git 调用统一带 -c core.quotepath=false
    （对齐 host-fs-handler.ts:750 GIT_QUOTEPATH_OFF_ARGS 中文路径先例）；commit 透传
    per-invocation identity 注入（复用 host-fs-handler.ts:1254 D-008 机制——-c user.name/
    user.email 透传，headless daemon 进程无全局 git config 也能提交，取值与现有注入一致，
    不新造第二种 identity 来源）
  - runner=sillyspec 的命令解析：intent.command 文本经保守 tokenizer 拆 argv（空格/引号拆分，
    禁 shell eval，保住不经 shell 铁律）；Windows 下 sillyspec 是 npm .cmd shim（execFile 直跑
    .cmd 必 EINVAL/ENOENT）——解析 shim 指向的 js 入口经 process.execPath 执行，三平台实测
  - 结果文本格式化：成功含 short sha（提交后 git rev-parse --short HEAD 采集）与实际提交文件集
    清单（R-04——回喂明确列出实际提交文件集，agent 据此校准暂存区假设）；失败 ok=false 且
    text 含 stderr 原样（R-05 credential helper 差异可感知）；action=reject 直接组
    「用户拒绝了本次提交：<原因>」文本返回、零 git 命令执行（不动暂存区）
acceptance:
  - 批准 commit 路径仅对「已暂存未勾选」reset、「勾选未暂存」add，无裸 reset 全清调用（D-018）
  - runner=sillyspec 代执行 argv 与 agent 原命令逐段等价、零附加参数（D-013）；runner=git 按
    解析出的 remote/ref（缺省 origin+当前分支）执行
  - 全部 spawn 为 execFile 数组形参（无 shell 字符串拼接）；commit 带 identity 注入
  - 成功路径 GitExecResult.ok 为 true 且 text 含 sha+提交文件集；失败路径 ok 为 false 且
    text 含 stderr；reject 路径零 git 副作用
verify:
  - pnpm -C sillyhub-daemon typecheck
  - pnpm -C sillyhub-daemon test -- tests/interactive/git-executor.test.ts（task-08 用例未落地
    时 --passWithNoTests 兜底；语义级验证以 task-08 为准）
constraints:
  - 禁止裸 reset（不带 pathspec 的暂存区全清）——共享工作区他人 staged 文件不得被动（D-018）
  - sillyspec push 原样代执行：不附加 --json 或任何参数、不改写命令文本（D-013）
  - 拒绝路径零 git 副作用——暂存区原样保留（D-007 拒绝语义的执行面）
  - spawn 一律数组形参不经 shell（Windows .cmd shim 经 process.execPath 绕行）；兼容
    Windows/Linux/macOS（路径分隔、中文文件名、行尾）
  - daemon ESM：相对 import 一律带 .js 后缀
  - 本 task 不改 permission.ts（分发接线归 task-06）、不写测试文件（executor 语义验证归 task-08）
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
