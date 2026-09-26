---
author: flow-machine-draft
created_at: 2026-09-26T14:45:56.804Z
---
# 提案书（Proposal）— 2026-09-26-probe-concurrent-rpc

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:fb86b113e018e78d54e99f89f6c4dd65a2819e8b07d33dedaa5f760f24b3d833:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-probe-concurrent-rpc 留痕重锚 -->
任务原话转写：probe 批量接口实测 2-12 秒：collect_many_workspace_statuses 对多工作区的 git_probe（跨公网 daemon RPC）在 for 循环串行 await，且 probe_workspace_git_mode/git_remote_url 用默认 30s 传输预算，N 个工作区耗时=N×单次 RPC 累加，用户网络差时单次即秒级；probe 端点 repo_url 识别循环同样串行。

成功标准：
- 批量探测多工作区时 git_probe 并发执行（gather），总耗时逼近最慢一个而非逐个累加
- probe_workspace_git_mode 与 git_remote_url 的 RPC 预算收紧为 3 秒，超时仍归 unknown/None（三态语义与 fail-safe 不变）
- probe 端点 git_remote_url 的逐工作区读取不再串行追加耗时（未识别的并发预取）
- 既有 test_probe_endpoint 全量用例回归全绿，新增并发行为用例（barrier 法证明并发）与超时预算透传用例
- 不改任何响应字段口径与既有日志事件语义
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:e76313e843abf96e79eb834cf319cc5e52568bddf82f545dc2313c9a3266b20b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-probe-concurrent-rpc 留痕重锚 -->
按成功标准机械推导，共 6 条验收面：
1. 批量探测多工作区时 git_probe 并发执行（gather），总耗时逼近最慢一个而非逐个累加
2. probe_workspace_git_mode 与 git_remote_url 的 RPC 预算收紧为 3 秒，超时仍归 unknown
3. None（三态语义与 fail-safe 不变）
4. probe 端点 git_remote_url 的逐工作区读取不再串行追加耗时（未识别的并发预取）
5. 既有 test_probe_endpoint 全量用例回归全绿，新增并发行为用例（barrier 法证明并发）与超时预算透传用例
6. 不改任何响应字段口径与既有日志事件语义
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:40472e644863777df2674ec23d6111dd7f01533736e3ef4cd82d6f13d5bfee53:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-probe-concurrent-rpc 留痕重锚 -->
1. 批量探测多工作区时 git_probe 并发执行（gather），总耗时逼近最慢一个而非逐个累加
2. probe_workspace_git_mode 与 git_remote_url 的 RPC 预算收紧为 3 秒，超时仍归 unknown
3. None（三态语义与 fail-safe 不变）
4. probe 端点 git_remote_url 的逐工作区读取不再串行追加耗时（未识别的并发预取）
5. 既有 test_probe_endpoint 全量用例回归全绿，新增并发行为用例（barrier 法证明并发）与超时预算透传用例
6. 不改任何响应字段口径与既有日志事件语义
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
