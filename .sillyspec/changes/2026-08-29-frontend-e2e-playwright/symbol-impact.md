# 符号影响面报告

> tasks.md 内容指纹（生成时）: 68a6d359eb6e36dd——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 无签名级变更。纯新增 frontend/playwright.config.ts；package.json 仅加 scripts 条目（不触依赖版本，puppeteer 移除归 task-07）；tsconfig.json/vitest.config.ts/.gitignore 为配置级修改（include/exclude/gitignore 规则），不改任何 class/接口/DTO/方法签名。
- task-02: 无签名级变更。全新增 frontend/e2e/{env,fixtures,helpers}.ts 三个文件，TestApiClient 等符号为本变更新建，无既有调用点（消费方为后续 task-03/04 的 spec，均在计划范围内）。
- task-03: 无签名级变更。全新增 frontend/e2e/auth.spec.ts，只 import @playwright/test 与 task-02 的 helpers（范围内），不改任何既有代码。
- task-04: 无签名级变更。全新增 frontend/e2e/navigation.spec.ts，同上只消费范围内新符号。
- task-05: 无签名级变更。全新增 frontend/e2e/README.md 与 .env.e2e.example（文档/模板，无代码符号）。
- task-06: 无签名级变更。全新增 .github/workflows/e2e-ci.yml（CI 配置，无代码符号）。
- task-07: 无签名级变更。package.json 仅删除 devDependencies.puppeteer 条目 + pnpm-lock.yaml 同步；puppeteer 在 frontend/src 零引用（design 已 grep 核实 + task 约束要求执行时复核），删除无调用点影响。
- task-08: 无签名级变更。验证型任务，allowed_paths 仅 frontend/e2e/README.md（笔误修正级），不改任何代码符号。
