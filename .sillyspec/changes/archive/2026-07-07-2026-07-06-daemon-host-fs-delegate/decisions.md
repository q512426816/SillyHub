---
author: qinyi
created_at: 2026-07-06 19:09:09
---
# Decisions

## D-001@V1 完全委托范围
8 处容器越界点全改 daemon RPC（用户选"完全委托"，非最小/局部）。覆盖 dispatch 5 处（已修重构）+ complete_lease 3 处（新写）。

## D-002@V1 apply_patch 委托 daemon git apply
complete_lease 收 daemon 上报 patch 后，发 RPC 给 daemon 在宿主 git apply，backend 入库 patch+结果（用户定）。替代容器内 git apply（FileNotFoundError）。

## D-003@V1 post_scan_validation 委托 daemon 保留校验
不跳过。daemon 侧做 git rev-parse / pollution archive / package.json，保留校验功能（修当前"污染检测静默失效"）。

## D-004@V1 server-local 模式行为不变
path_source 分流。server-local 本地容器直接做，不走 RPC。零回归。

## D-005@V1 RPC 机制 = per-daemon WS
复用 daemon-entity-binding DaemonWsHub，不新增 HTTP server / 不走 lease 内嵌（用户选 A）。

## D-006@V1 异步 RPC 容错
超时 30s + WS 重连幂等 + RPC 失败不阻塞 complete_lease（warn + ql-009 failure log 兜底）。apply_patch 幂等。

## D-007@V1 WS RPC 双向能力（spike 验证）
daemon-entity-binding per-daemon WS 当前是否支持请求/响应匹配（双向 RPC）？spike-01 验证。不足则 W1 task-02 含 WS RPC 框架搭建（核心风险，决定 W1 工作量）。

## D-008@V1 apply_patch 幂等策略（plan 设计）
git apply 同 patch 多次（complete_lease 重试）幂等。plan 阶段设计：patch_id 去重 / `git apply --check` 预检 / 已 applied 跳过。

## D-009@V1 post_scan 委托方式（plan 决策）
daemon 实现等价 post_scan_validator（完整逻辑搬 daemon） vs RPC 暴露 git/shutil 原语 backend 保留逻辑。plan 阶段决策（trade-off：daemon 逻辑重复 vs RPC 粒度）。
