---
id: task-08
title: 'executor 单测（精确重整语义/commit/push 成败/拒绝不动暂存区）'
title_zh: 'executor 单测（精确重整语义/commit/push 成败/拒绝不动暂存区）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-11-07 00:39:35
priority: P0
depends_on: [task-05]
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-002, D-018]
allowed_paths:
  - sillyhub-daemon/tests/interactive/git-executor.test.ts
  - sillyhub-daemon/src/interactive/git-executor.ts
target_files:
  - NEW:sillyhub-daemon/tests/interactive/git-executor.test.ts
goal: >
  为 git-executor 代执行引擎补单测，验证核心语义——精确暂存区重整（未勾选的已暂存不裸清，
  D-018）、commit/push 成败路径回喂文本、runner 分流（git / sillyspec 原样代执行）、拒绝路径
  零暂存变更。
implementation:
  - 新建 sillyhub-daemon/tests/interactive/git-executor.test.ts：双轨验证——重整/commit 语义用
    真实临时 git 仓 fixture（os tmpdir 建仓 + 配 identity + 造「已暂存且勾选/已暂存未勾选/
    勾选未暂存/全未涉及」四态文件，用后清理），push/sillyspec 的 argv 断言用注入 fake 捕获
    （不起真远端推送）；executor 的子进程执行面按 task-05 实现的注入缝对接
  - 精确重整用例（D-018）：四态 fixture 执行 approve → 断言 commit 文件集=勾选集；未勾选的
    已暂存文件被 reset 出暂存区但工作区改动保留；已暂存且勾选文件零重复操作；argv 序列中
    不存在不带 pathspec 的裸 reset 形态
  - commit 成败：成功断言 ok=true、sha 匹配 git rev-parse --short HEAD、text 含提交文件集；
    失败（空勾选集提交 / pre-commit hook 拒绝）断言 ok=false 且 text 含 stderr 原文
  - push runner 分流：runner=git 断言 argv 为 push+remote/ref 序列（pushTarget 显式与缺省
    补 origin+当前分支两态各一）；runner=sillyspec 断言代执行 argv 与原命令逐段等价、零附加
    参数（D-013），json 与人类可读两态输出均原样进 text
  - 拒绝用例（FR-05 执行面）：混合暂存态执行 reject → 断言零写类 git argv 调用 + 前后
    git status --porcelain 快照一致（拒绝不动暂存区）
  - 边界用例：中文路径与含空格路径文件各至少一例（R-07）；push 失败 stderr 透传（R-05）
acceptance:
  - pnpm -C sillyhub-daemon test -- tests/interactive/git-executor.test.ts 全绿
  - 重整用例显式覆盖「已暂存未勾选 reset / 勾选未暂存 add / 已暂存且勾选不动」三分支（D-018）
  - 拒绝用例证明暂存区零变更（porcelain 前后快照一致）；sillyspec 原样代执行零附加参数被
    argv 级断言锁定（D-013）
verify:
  - pnpm -C sillyhub-daemon test -- tests/interactive/git-executor.test.ts
  - pnpm -C sillyhub-daemon typecheck
constraints:
  - 禁止跑全量测试（规则 0）；fixture 兼容 Windows/Linux/macOS（临时目录、路径分隔、
    autocrlf 差异——断言 porcelain 输出与 argv 形态，不做字节级 diff 断言）
  - 发现实现缺陷修 sillyhub-daemon/src/interactive/git-executor.ts 的逻辑，禁止改断言迁就
    实现（项目规则 9）；impl 文件仅限缺陷修复级改动（新能力扩展归 task-05 范畴）
  - 真仓 fixture 不做网络操作（push 断言全走 fake argv 捕获，不推真远端）
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
