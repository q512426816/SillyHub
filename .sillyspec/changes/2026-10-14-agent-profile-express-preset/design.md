---
author: flow-machine-draft
created_at: 2026-10-14T02:38:51.950Z
---
# 设计记录（Design Record）— 2026-10-14-agent-profile-express-preset

## 做法概述

复用 `2026-08-02-agent-profile-layer` task-11 的启动幂等补种范式：在 `backend/app/modules/agent/profile/seed.py` 新增平台预置档案常量（确定性 uuid5 id + 极速通道 system_prompt 文案）与 `ensure_sillyspec_express_profile`（按确定性 id 查缺补种，仅补缺失、不覆盖、内部 commit），在 `main.py` lifespan 既有 seed try 块挂载调用。身份键选确定性 uuid5 + `is_system_default=False` 而非第三条系统默认档案：`is_system_default=True` 的行会被 dispatch 兜底链第三档（`AgentProfileService.resolve_profile` 按 provider 选 is_system_default）命中，导致未显式选档案的会话/任务被静默注入极速提示词——违背「主动选择」诉求；平台可见（platform）+ 非 system_default 只进档案选择列表、不进兜底链，行为面精确。已下线的角色模板机制（`_ROLE_TEMPLATE_PROVIDERS`）是 供应商×角色 二维矩阵且语义为「角色人格」，与单条通用执行纪律档案不匹配，不复用。

## 接口契约

- 新增 `seed.ensure_sillyspec_express_profile(session: AsyncSession) -> int`：返回本次补种条数（0/1），内部 commit，幂等可重入。
- 新增 seed 模块常量：`EXPRESS_PRESET_PROFILE_ID`（确定性 uuid5）、`_EXPRESS_PRESET_SYSTEM_PROMPT`（协议文案）。
- `main.py` lifespan：seed try 块内新增一处调用 + `agent.profile.express_preset_reseeded` warning 日志。
- 无既有函数签名、REST 端点、DB schema 变化（复用 `agent_profiles` 表，零迁移、零前端改动——档案选择列表天然枚举 platform 可见档案）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：ensure 只在 lifespan 启动序列运行；与迁移 task-01 的默认档案 seed 无耦合（不同 id、不同去重键），谁先谁后结果一致。
2. 并发写：单实例每启动仅调用一次；极端多实例同时首启重复插入同 id 行会因主键冲突失败——与既有两 ensure 同等风险面（无分布式锁），下次启动幂等自愈。
3. 切换/生命周期：档案被管理员误删后下次重启自动补回（与系统默认档案同语义）；运行中会话/任务持有 `agent_profile_snapshot` 快照，不受补种影响。
4. 作用域：platform 可见档案全平台共享一行、无 workspace 归属，不存在跨工作区串台；system_prompt 含「非 SillySpec 仓库豁免」条款，防止在未启用 SillySpec 的目标仓库误套流程。

## 风险与死路

最大风险：协议文案把「新功能/大改动」也错误降级进极速通道——文案显式写入规模定级与拒绝降级条款（新功能提示改走完整 brainstorm 流程）。放弃方案 A（加为第三条 `is_system_default=True` 默认档案）：会进 `resolve_profile` 兜底链改变所有未选档案会话的默认人格（破坏零回归），且 seed 去重按 provider 与既有 claude 默认档冲突；放弃方案 B（仅用管理 API 在当前库建一条数据）：DB 重置即丢（规则 11 允许重置）、不可复现，不符合「平台预置」语义。
