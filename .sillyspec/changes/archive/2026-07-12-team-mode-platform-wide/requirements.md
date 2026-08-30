---
author: qinyi
created_at: 2026-07-12 02:55:00
---

# 需求规格（Requirements）

## 角色
| 角色 | 说明 | 权限 |
|---|---|---|
| workspace owner | 工作区所有者，唯一能发起 team 的角色 | WORKSPACE_WRITE |

> team 模式 opt-in，只有 owner 能勾选触发。其他成员（developer/viewer）只读看 mission 结果。

## 场景（Scenario）

### SC-1 mission 入口发起 team（Phase 1）
1. owner 进 mission 页，填目标
2. 选 mode = team（默认 single）
3. 选 team 时看到角色预览（arch/code_style/...）+ 预算提示
4. 点「启动团队」→ 建 mission → Coordinator 拆 worker → 并行 → Finalizer 合并
5. mission 详情页看 worker 进度 + 最终合并结果

### SC-2 execute stage team（Phase 2）
1. owner 进变更详情页，execute 阶段
2. 勾「用团队执行」toggle
3. 点「启动 execute」→ `_dispatch_execute_team` 触发，多 impl worker 并行写
4. Finalizer 合并 patch → 人审 apply-back
5. 变更详情页看 worker 进度 + 累计成本

### SC-3 verify stage team（Phase 3）
1. owner 进 verify 阶段
2. 勾「用团队核验」toggle
3. 多 verify worker 从不同角度（正确性/边界/性能/安全）并行核验
4. 各 worker gate_result → Finalizer 按策略 A 合并成 stage 单一 gate
5. gate 全过才推进 archive；任一失败打回 execute

### SC-4 会话发起 team（Phase 4）
1. owner 在会话面板输入分析需求
2. 点「💡 用团队分析」→ 建 mission 绑当前 session_id
3. 会话内嵌紫色 mission 进度卡（worker 行 + cost bar）
4. mission 完成后对话流插「团队分析完成」消息（摘要 + 跳转链接）

### SC-5 默认 single 零回归（守护）
- 所有入口不勾 team → 行为与现状完全一致（单测 + e2e 验证零差异）

## 功能需求

| ID | 需求 | Phase |
|---|---|---|
| FR-1 | MissionCreateRequest 加 mode 字段（single/team，默认 single） | P1 |
| FR-2 | create_mission 透传 mode 给 route()（constraints['mode']） | P1 |
| FR-3 | mission-console 创建表单加 mode 双卡片选择 + 角色预览 + 预算提示 | P1 |
| FR-4 | 变更 stage dispatch 加 team_mode 参数 | P2/P3 |
| FR-5 | execute team_mode=True 触发 _dispatch_execute_team（已存在） | P2 |
| FR-6 | 新增 _dispatch_verify_team（仿 execute，verify worker 并行核验） | P3 |
| FR-7 | verify gate 合并策略 A（merge_gate_results helper，全过才过） | P3 |
| FR-8 | 变更详情页 execute/verify 加 team toggle（紫色开关） | P2/P3 |
| FR-9 | 会话发起 mission：create_mission 支持 session_id 绑定 | P4 |
| FR-10 | 新组件 session-mission-progress（会话内嵌 mission 进度） | P4 |
| FR-11 | mission 完成回传对话（frontend 插完成消息 + 摘要） | P4 |
| FR-12 | 每 Phase 单测覆盖（route/team_mode 触发/gate 合并/session 绑定） | P1-P4 |
| FR-13 | 四入口真 daemon e2e（AC-6 运行时） | P5 |
| FR-14 | 模块文档同步（backend.md/frontend.md） | P5 |

## 非功能需求
- **零回归**：默认 single，所有现有单 agent 行为不变（AC-5 单测守护）
- **成本可控**：team 多 worker 烧 token，选 team 时提示预算（R-04，软门沿用）
- **渐进**：5 Phase 独立交付，每 Phase 可单独验证上生产
