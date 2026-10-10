# 未分类知识

> 项目特定的架构经验、历史记录、尚未提炼成通用 pattern 的知识。
> 已分类的迁移到：`sillyspec-gotchas.md`（工具坑）/ `testing-gotchas.md`（测试坑）/ `patterns.md`（架构）/ `known-issues.md`（项目坑）/ `conventions.md`（约定）。
> 已修复项保留并标注状态，便于回溯。INDEX.md 不索引本文件——条目成熟后请迁出到分类文件并加 INDEX 索引。

（2026-09-28 清账：本文件原有 41 条（40 个 `##` 条目 + 1 条丢标题的 SSE 路由条目）已全部迁出到五个分类文件并在 INDEX.md 补索引，见变更 2026-09-28-knowledge-inbox-clear。当前收件箱为空，新踩坑从下方追加。）


## 跨仓 worktree task 用直接 git commit，wt-commit 只认主仓 worktree

`sillyspec wt-commit --change <变更名>` 固定在**主仓** worktree（`.sillyspec/.runtime/worktrees/<变更名>`）跑 `git add/commit`；跨仓 task（task 卡 `repo: sillyspec` 等）的 worktree 是 `<变更名>--<repo-key>` 后缀目录，在跨仓 worktree 内跑 wt-commit 会被 CLI 当成 sillyspec 仓自己的项目实例（找它自己的 .sillyspec）报「worktree 不存在」。正确做法：跨仓 worktree 内直接 `git -C <worktree> add + commit`（execute step 指引「跨仓 worktree task」段本就钉了此方式），apply 阶段 CLI 统一把跨仓 worktree 交付 patch 回对应主工作区。另注意 wt-commit 的 `-m` 缺失会报错（不是可选参数）。来源：task-05/task-02 提交实操（2026-10-09-tombstone-conflict-root-fix）。

## 【待确认】daemon 集成测试的 daemon.start() 被系统代理黑洞拖死（npm view 30s×2）

`daemon.start()` 链上 `runPreflight`（preflight.ts runSillySpecCheck）与 `_registerDaemon` 的 `probeLatest`（sillyspec-manager.ts，未注入 sillyspecManager 时）各起一次 `npm view sillyspec version --prefer-online` 子进程；npm 12 在 Windows **遵循系统代理**（WinINET ProxyServer，如 Clash 127.0.0.1:7897），代理对 npm 流量黑洞时每次外呼挂满 runCmd 的 30s 超时帽 → 每个 `daemon.start()` 用例白付 30-60s，满套件整文件超时（2026-10-10 实测 daemon-borrow-sandbox 全红、daemon-kind-dispatch 20 用例 60s 超时；主仓 HEAD 对照复现=环境归因非代码回归）。`npm_config_registry`/`npm_config_proxy` env 钉法无效（系统代理优先级更高）。**修法（2026-10-10-borrow-sandbox-workspace-context task-04 已示范）**：测试文件 `vi.mock('../src/preflight.js', ...)` no-op 掉 runPreflight（182s→1.3s）+ 构造器注入 no-op `sillyspecManager`（官方注入口，daemon.ts ctorOpts）；不断言 preflight 行为的用例组语义无损。候选推广：daemon-kind-dispatch.test.ts 等所有真起 daemon.start() 的测试文件同款 mock（待确认后可立独立小变更）。来源：task-04 排障（reg query ProxyEnable=1 ProxyServer=127.0.0.1:7897 + spawn 计时二分定位）。
