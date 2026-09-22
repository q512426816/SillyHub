---
author: qinyi
created_at: 2026-09-11 16:38:00
---

# 决策记录（Decisions）

## D-001@v1: 非 claude 引擎完整开放会话级供应商切换（含「不指定（本机默认）」）
- type: boundary
- priority: P1
- status: accepted
- source: user
- question: codex/pi 会话要不要放开「不指定（本机默认）」（切回本机凭证）？
- answer: 用户裁决：肯定要开放——本变更的目的就是与 claude 完全对齐。技术落地（保住不丢历史）：codex 切回本机默认**不丢 CODEX_HOME**（thread 历史存在 `$CODEX_HOME/sessions` 下，丢目录即断 resume），改为把宿主 `~/.codex` 的 auth.json / config.toml **镜像拷贝**进 per-session 目录（宿主无文件则清空 = 如实反映宿主未登录）；pi 切回本机默认 = 丢弃 `PI_CODING_AGENT_DIR` env 回宿主 `~/.pi`（pi 会话历史在 daemon 自管 `--session-dir`，pi-rpc-driver.ts:719，不受影响）。
- normalized_requirement: codex/pi 会话的供应商下拉包含「不指定（本机默认）」项；codex null 切换后同会话 resume 不丢（CODEX_HOME 保持 per-session 目录 + 宿主凭证镜像）；pi null 切换后 pi 读宿主 `~/.pi` 凭证。
- impacts: [FR-02, Wave 1, Wave 2]
- evidence: 用户 AskUserQuestion 回答轮次 1；codex-settings.ts:2（per-session CODEX_HOME 两文件）；pi-rpc-driver.ts:686/719（sessionDir 独立于 PI_CODING_AGENT_DIR）
- 锚点: sillyhub-daemon/src/codex-settings.ts, sillyhub-daemon/src/provider-file-settings.ts（新增）
- 模块域: sillyhub-daemon

## D-002@v1: 供应商下拉按会话引擎过滤 agent_kind
- type: definition
- priority: P1
- status: accepted
- source: user
- question: 会话配置条供应商下拉要不要按引擎过滤？
- answer: 用户裁决：按引擎过滤。codex 会话只列 codex kind 供应商，pi 只列 pi kind，claude 只列 claude kind。顺手修掉现状「全量展示 + 选错 kind 撞 backend 422（inject_gates.py:556 agent_kind 不匹配）」的坑。
- normalized_requirement: SessionConfigBar 供应商下拉的候选项 `provider.agent_kind === session.provider` 过滤（engine 为 null 的 provisional 形态维持全量）；「不指定（本机默认）」项所有引擎保留。
- impacts: [FR-03, Wave 3]
- evidence: 用户 AskUserQuestion 回答轮次 1；session-config-bar.tsx:491（现状 `providers.map` 全量渲染无过滤）
- 锚点: frontend/src/components/sessions/session-config-bar.tsx
- 模块域: frontend

## D-003@v1: daemon 侧接入点 = reload 内核统一接入（方案 A）
- type: architecture
- priority: P1
- status: accepted
- source: user
- question: codex/pi 配置写盘 + env 合并在 daemon 哪一层接入？
- answer: 用户裁决方案 A：把 applyProviderFileSettings（+ codex null 切换宿主凭证镜像扩展）从 task-runner.ts 抽到独立共享模块（provider-file-settings.ts），session-manager `_reloadSessionNow` 构造 newEnv 时对 codex/pi kind 调用并把 CODEX_HOME / PI_CODING_AGENT_DIR 并入新 env（文件层 env 最后合并盖过下层，与 daemon.ts:8285 spawn 路径同模式）；顺带删 reloadWithProvider 的 claude-only 守卫（session-manager.ts:1502）使 PROVIDER_CONFIG_CHANGED 默认供应商热切换对 codex/pi 也走确定性 reload。否决 B（payload 携带实现细节字段污染消息契约 + 热切换路径享受不到）、C（破坏 driver provider-neutral 契约）。
- normalized_requirement: 会话级切换（SESSION_SWITCH_CONFIG）与默认供应商热切换（PROVIDER_CONFIG_CHANGED）两条路径对 codex/pi 都经 _reloadSessionNow 统一写盘+合并 env；daemon.ts:7713 既有热切换尽力重写保留（幂等无害）。
- impacts: [FR-01, FR-04, Wave 2]
- evidence: 用户 AskUserQuestion 回答轮次 2；session-manager.ts 现不 import task-runner（层次隔离依据）
- 否决理由: B=消息契约污染且热切换路径享受不到；C=破坏 driver provider-neutral 契约
- 复潮条件: 无（方案 A 已定稿；若未来 reload 内核重构再评估接入点）
- 锚点: sillyhub-daemon/src/interactive/session-manager.ts:_reloadSessionNow
- 模块域: sillyhub-daemon
