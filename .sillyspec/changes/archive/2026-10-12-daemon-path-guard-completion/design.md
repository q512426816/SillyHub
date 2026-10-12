---
author: flow-machine-draft
created_at: 2026-10-12T00:42:29.656Z
---
# 设计记录（Design Record）— 2026-10-12-daemon-path-guard-completion

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

daemon 的宿主路径入口防线此前不一致：get_spec_bundle（DA-2 审计先例）与 host_fs 全系方法都有 `assertWithinAllowedRoots` 白名单守卫，但 linked_repos_sync/linked_repos_snapshot 两 RPC（写/读宿主路径）只有 af5daeca2 的「非空+绝对形态」校验——失陷 backend 可下发宿主任意绝对路径让 daemon 在其下落 .sillyspec/projects 结构。spec-sync 侧 pullSpecBundle（repo-native 会 mkdir rootPath/.sillyspec 并建 junction）与 handleInitLease（sillyspec init --dir 三写 + writeLocalYaml）对相对形态 rootPath 零防御——join 按 daemon 进程 cwd 解析写进错误位置。修法：①两 linked_repos handler 在形态校验后、spawn/fs 前加 `assertWithinAllowedRoots(root_path, this._effectiveAllowedRoots())`（越界 RpcError forbidden，与 get_spec_bundle 同款同强度，含 realpath 穿透判定）；②pullSpecBundle/handleInitLease 入口加 isAbsoluteLikePath 形态门（非绝对 throw，先于任何 fs 操作）。守卫原语全部复用，不新写路径比较。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `linked_repos_sync`/`linked_repos_snapshot` RPC：新增越界 forbidden 错误形态（此前越界路径会照常执行——属缺陷行为，无消费方依赖）；合法路径（backend 从登记的关联仓归属校验后下发，本就在 allowed_roots 内）行为零变化。
- `pullSpecBundle`/`handleInitLease`：新增相对形态抛错（backend resolve_root_path_for_daemon 产出恒为宿主绝对路径，相对即契约违约）；绝对路径行为零变化。函数签名零变化。
- 无 schema/端点变化，`pnpm gen:types` 不需跑。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   守卫是 handler/函数入口的同步前置断言，先于一切 await/spawn，无乱序窗口；allowed_roots 取 `_effectiveAllowedRoots()` 每次现取（runtime policy 推送后即生效），与 host_fs 系同口径。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   守卫本身只读（roots 集合构建 + realpath 判定）；并发 RPC 各自独立过门，无共享可变状态；allowed_roots 运行时更新（policy push）与在途 RPC 之间以调用时点快照为准，最坏一次旧白名单放行，与 host_fs 系既有语义一致。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   不适用：守卫为无状态纯判定；拒绝路径零副作用（零 spawn/零 mkdir），无半态残留。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   root_path 按 config+policy 白名单判定，与工作区无关的机器级边界；linked_repos payload 的 workspace_id 仅透传业务函数，守卫不涉跨仓数据流；rel_path 的 ../ 兄弟仓约定仍由 linked-repos-sync.ts 内既有相对形态规则管（本变更不触碰）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 最大风险：存量部署 allowed_roots 未包含工作区根 → linked_repos 同步被 forbidden 拒止——loadConfig 默认 allowed_roots=[homedir()]，宿主项目根通常在家目录之下；且 get_spec_bundle 对同一类值已用同款守卫跑了数月，真实环境已隐式要求「workspace root 在 allowed_roots 内」，不引入新的部署约束。
- 放弃方案 A：把 allowed_roots 校验下沉进 linked-repos-sync.ts 纯函数——纯函数无法访问 daemon 实例的 _effectiveAllowedRoots（需注入 roots 参数，改签名波及既有 25 用例）；入口（daemon.ts handler）是 allowed_roots 的天然作用域，与 get_spec_bundle 同层。
- 放弃方案 B：spec-sync 相对形态改为 warn+按 cwd 解析继续——静默写错误位置正是要堵的缺陷，warn 不可接受；fail-loud 让 backend 侧 502/失败结果可见，登记数据质量问题立即暴露。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 改 | sillyhub-daemon/src/daemon.ts | linked_repos 两 handler 加 assertWithinAllowedRoots 守卫 |
| 改 | sillyhub-daemon/src/spec-sync.ts | pullSpecBundle/handleInitLease 入口加 isAbsoluteLikePath 形态门 + import |
| 增 | sillyhub-daemon/tests/daemon-linked-repos-guard.test.ts | 处理器层 allowed_roots 守卫 4 用例（mock 业务函数隔离 spawn） |
| 改 | sillyhub-daemon/tests/spec-sync.test.ts | pullSpecBundle 相对拒止/绝对放行 2 用例 |
| 改 | sillyhub-daemon/tests/test_init_lease.test.ts | handleInitLease 相对拒止 1 用例 |
