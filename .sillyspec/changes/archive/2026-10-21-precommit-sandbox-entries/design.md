---
author: flow-machine-draft
created_at: 2026-10-21T01:23:19.299Z
---
# 设计记录（Design Record）— 2026-10-21-precommit-sandbox-entries

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：排查实锤（本变更前置探针，含 5bbb1a830 留痕互证）：agent 沙箱驱动把 python.exe 子树 IL 降为 Low（嵌套 token 同为 qinyi 但 Mandatory Label S-1-16-4096，无 CodexSandboxUsers 组、Administrators deny-only）；由 python 发起的 msys 进程打不开 Medium 标签的 `\BaseNamedObjects\msys-2.0S5-*` 对象目录（NtCreateDirectoryObject 0xC0000022），且 uv/pnpm 默认缓存写 profile AppData 被驱动白名单拦截；node 子树不受影响（node→bash 正常、sillyspec CLI 收口实测可跑）。据此官方 runner 在 agent 会话不可用的根因是 hook entry 的 `bash -c` 包装（python→msys 嵌套）而非 runner 本身。修法：backend/.pre-commit-config.yaml 三条 pre-commit 阶段 entry 去 `bash -c` 直连，uv 统一 `--cache-dir .tmp/uv-cache` 重定向（仓内 gitignored，Low 子树可写）；ruff 失败提示文案移入配置注释（ruff 自身报错已含文件与规则，指引不丢失）；pre-push 两条（ci-fast-gate/docs-gate）不动——推送发生在用户终端 Medium 树，今天即可用，agent 会话不推送。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：`backend/.pre-commit-config.yaml` 三条 entry 文本变化（bash 包装 → 直连命令），检查对象/fail-closed 语义/stage 归属零变化；`scripts/check-assertion-surfaces.py` 与其单测零改动。对外行为变化：无 API/命令面变化；hook 在用户终端 Medium 树与 agent 沙箱 Low 树均可出结果。`.tmp/uv-cache` 为新增运行时缓存目录（/.tmp/ 已 gitignore 覆盖，不入库）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

答：成立。entry 为单命令直连，无流水依赖；pre_commit 按配置序串行执行 hook，顺序语义与改前一致。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

答：两条 ruff entry 不会同时跑（同一 pre_commit 进程序列）；并行会话各 clone 各的 `.tmp/uv-cache`，uv 自身缓存有并发锁设计；`.tmp/` 目录级共享仓并发写入最坏互为垃圾（gitignored 运行时缓存，无正确性影响）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

答：安全。entry 均为一次性命令，缓存目录可随时删除重建；hook 模板（.git/hooks）不随本变更改动，回滚=还原 yaml 一处。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

答：不会。`--cache-dir .tmp/uv-cache` 相对 cwd=仓根解析，每仓一份互不串台；不写宿主/用户级任何共享状态。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：风险①：uv 在 Low 子树若需下载依赖（根 .venv 缺失时）可能被沙箱网络策略拦——当前根环境已就绪（ql-20260923-006 实证根/backend uv env 同源可用），`.tmp/uv-cache` 重定向后无 profile 写，残余风险记为已知限制；真遇到时用户终端跑一次 hook 预热缓存即可。风险②：pre-push 两条保留 bash 包装，agent 会话内若手动触发 pre-push 仍会崩——推送属用户终端动作（流程纪律），不为其扩大改动面。死路①：icacls 改 `~/.cache` ACL——嵌套 token 根本不在 CodexSandboxUsers 组、写入拒绝在驱动白名单层而非 DACL，改了无效（探针实证），弃。死路②：削弱沙箱容器（改内核对象目录 ACL/降标签）恢复 msys 嵌套——动容器安全边界换取工具便利，方向性错误，弃。死路③：PRE_COMMIT_HOME 写入用户级环境变量——Low 子树只能写仓内路径，单值无法同时满足多仓，弃（按会话 `export PRE_COMMIT_HOME=$PWD/.tmp/pre-commit-home` 使用，已验证）。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 改 | backend/.pre-commit-config.yaml | 三条 pre-commit entry 去 bash -c 直连 + uv --cache-dir 重定向；注释同步沙箱结论与使用指引；pre-push 两条不动 |
