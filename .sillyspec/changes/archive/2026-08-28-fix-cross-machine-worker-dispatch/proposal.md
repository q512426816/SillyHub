---
author: WhaleFall
created_at: 2026-08-28 15:32:40
---

# 提案书（Proposal）

## 动机

分身子会话派发存在跨机器错派缺陷：选机逻辑（mcp_tools.py:1108 `_get_online_runtime(owner_id)`）纯按用户级查 `daemon_runtimes`，owner 名下有任意在线机器即抢占钉定，完全无视目标工作区在 `workspace_member_runtimes` 的绑定机器（生产实证：QM小程序→crrcdt-hubin 绑定存在但从未被读取）。而 worktree 副本创建却按工作区绑定路由到绑定机器——会话与工作副本分裂两机；随后 owner 机器 daemon 因无差别 `mkdir(cwd, recursive)`（daemon.ts:3862）在错误机器上静默建空目录，分身在空目录"成功"执行，形成灾难性静默失败。

## 关键问题

1. **选机语义错**：owner 自有机器优先启发式与"工作副本物理所在机器"解耦——DB 绑定表就是为表达"源码在哪台机器"而存在，选机却不消费它。
2. **白名单校验缺口**：allowed_roots 只在 daemon 端 host_fs RPC 通道校验；backend 派发链零校验，daemon 交互会话 cwd（认领→spawn）也无校验；host_fs 的 forbidden 还会被降级通道掩盖成笼统的 "rpc unavailable"。
3. **静默掩盖**：gap-8 修复（daemon-client 兜底目录不存在）被实现为对所有 cwd 无差别 mkdir，把错机派发本应 fail-loud 的场景变成错机上建空目录继续跑。

## 变更范围

- backend：`_dispatch_worker_core` 删 own_rt 优先分支、恒钉定目标工作区代表绑定机器（预检两段式 provider 解析）；新增派发前 allowed_roots 可判定越界预检（400 fail-loud）；双源同序全序（钉定解析与 host_fs 路由收敛同机）。
- daemon（sillyhub-daemon）：交互会话认领段新增 cwd 守卫（白名单终检 + 存在性检查，失败 notifyRunResult error 拒启动）；仅无 rootPath 兜底路径保留 gap-8 mkdir。
- 测试：backend 选机/预检/双源同序用例 + daemon 守卫纯函数单测。

## 不在范围内（显式清单）

- 不改 batch 派发路径（`_resolve_dispatch_runtime` 已按工作区绑定路由）。
- 不改普通交互会话（create_session / prepare_interactive_dispatch 非钉定分支）选机语义。
- 不新增 host_fs mkdir/ensure RPC，不改 host_fs 既有十五方法。
- 不改表结构、不新增对外 API 字段/DTO。
- 不做 worktree 过期租约 GC、路径指纹校验（知识库已知独立问题/明示非目标）。

## 成功标准（可验证）

- QM小程序类跨机场景（owner 在线机器 ≠ 工作区绑定机器）：分身 lease 钉定 crrcdt-hubin 绑定机器，绝不落 owner 机器。
- 工作区无在线绑定机器 → 422（既有）；绑定机器路径可判定越界 allowed_roots → 400 新增，均不建 run。
- daemon 收到 workspace 绑定会话且 cwd 不存在 → 不 mkdir，run 收到 error_during_execution + 中文原因。
- 常态（owner 机器即绑定机器）派发结果与旧行为一致（存量测试回归）。
- 多成员多机绑定时钉定解析与 worktree 路由收敛同机（全序）。
