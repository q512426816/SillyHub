---
author: qinyi
created_at: 2026-07-12 02:55:00
---

# 提案书（Proposal）

## 动机
审计（`docs/agent-platform-deep-audit-2026-07-12.md` 第 3 节发现 3）证实：**只读 team mission 链路已端到端打通，但缺最后一公里——入口**。mission→dispatch_worker→finalizer 全链路就位，`route()` 三档 single/team/auto 已实现，`_bootstrap_team` 代码完整，但：
- spec-bootstrap 硬 single，team bootstrap 空转用不上
- mission-console 无 mode 选择，前端无法显式触发 team
- verify stage / 会话 无 team 入口

用户决策：把 team 模式从只读 bootstrap 扩展为**整个平台三个入口**（mission / 变更各阶段 / 会话）的可选执行方式，默认 single。

## 关键问题（现有方案为何不够）
1. **能力空转**：team 链路写好了但没入口触发，等于没有。用户只能用单 agent，多 agent 并行的价值（大任务拆分、多角度核验）取不到。
2. **入口分散无统一**：即使触发了（execute 已有 `_dispatch_execute_team`），三入口各自为政，没有统一的 mission 归一模型，维护散、重复逻辑。
3. **会话场景缺位**：用户最常用的对话场景无法用 team（只能单 agent 一问一答），大分析任务得跳出会话去 mission 页，体验断。

## 变更范围
方案 B（归一 mission）：三入口触发 team 都 = 建一个 AgentMission，复用现成 mission→worker→finalizer 链路。
- **Phase 1** mission 入口优化（前端 mode 选择 + 后端 mode 透传）
- **Phase 2** execute stage team 接通（复用 `_dispatch_execute_team` + 前端开关）
- **Phase 3** verify stage team 新增（仿 execute + gate 策略 A 收敛）
- **Phase 4** 会话发起 team（D-001 = 对话中建 mission，会话内嵌进度组件）
- **Phase 5** 端到端验证 + 文档同步

## 不在范围内（显式清单）
- 不做会话内多 agent 轮转（driver 层新机制，D-001 选发起 mission 替代）
- 不做 brainstorm/plan stage team（YAGNI，D-002）
- 不做 execute 写 team 的 per-worker worktree 隔离（D-006 延后）
- 不做 Coordinator/Finalizer 模型可配置（P2-3 独立任务）
- 不做预算硬门 kill（P2-1 独立任务，依赖 P0-1 已修）

## 成功标准（可验证）
- AC-1：mission-console 选 team → 创建 mission，Coordinator 拆 worker 并行，Finalizer 合并可见
- AC-2：变更 execute 勾「用团队执行」→ 多 impl worker 并行写，Finalizer 合并 patch
- AC-3：变更 verify 勾「用团队核验」→ 多 verify worker 并行，gate 按策略 A 合并
- AC-4：会话点「用团队分析」→ 建 mission 绑 session，内嵌进度可见，结果回传对话
- AC-5：不勾 team 的所有入口行为零回归（单测守护）
- AC-6（运行时）：四入口各真跑一次 team 成功（需真 daemon + GLM）
- AC-7：模块文档 backend.md/frontend.md 变更索引同步
