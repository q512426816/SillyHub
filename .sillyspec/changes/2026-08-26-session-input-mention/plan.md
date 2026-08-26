---
author: qinyi
created_at: 2026-08-26 23:45:10
plan_level: full
---

# 实现计划（Plan）：会话输入框智能联想（/ 技能指令 + @ 关联变更/快速修复）

## Wave 1（并行，无依赖）
- task-01
- task-04
- task-06
- task-07

## Wave 2（依赖 Wave 1）
- task-02
- task-08

## Wave 3（依赖 Wave 2）
- task-03

## Wave 4（依赖 Wave 3）
- task-05

## Wave 5（依赖 Wave 4）
- task-09

## Wave 6（依赖 Wave 5）
- task-10

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | `lib/session-mention.ts` 触发检测/回填纯函数 + 单测 | W1 | P0 | — | FR-01/FR-04, D-002 | 词首检测/空白中断/`/team ` 回填兼容整条拦截 |
| task-04 | 联想数据 hooks（技能 manifest / changes / quicklogs，prefetch+staleTime，空 workspace 禁用 @） | W1 | P1 | — | FR-01/FR-04, NFR-01 | 复用 usePlatformSkillsManifest/listChanges/listQuicklogEntries；仅用现有字段（invoke_name 类型在 task-08 加入，此处不消费） |
| task-06 | 后端 manifest `invoke_name` 聚合透传 + test_skills_bundle 用例 | W1 | P0 | — | FR-07, D-002 | `_summarize_skills` 三处改动；无响应模型可改 |
| task-07 | 后端 `SessionInjectRequest` bind 字段 + 三层透传 + binder 插入 + pytest | W1 | P0 | — | FR-06, D-003/D-004/D-005 | 插入点=行锁后/tool_report 早退前（覆盖忙轮排队）；bind_quick_id=128 对齐 create |
| task-02 | `session-mention-popover.tsx` 浮层组件 + 单测（分组/过滤/键盘/无障碍/空态/叠层互斥） | W2 | P0 | task-01, task-04 | FR-01/FR-02/FR-04, NFR-02 | 自定义浮层对齐 team-trigger-popover 惯例（非 antd）；onSelect 抛原始实体对象，浮层内不读 invoke_name（回填名 `invoke_name ?? name` 由 task-03 接入层计算，消除与 task-08 同 Wave 的类型时序风险） |
| task-08 | 前端类型与组装：daemon.ts injectSession + custom-skills.ts invoke_name + `pnpm gen:types` 产物提交 | W2 | P0 | task-06, task-07 | FR-06/FR-07, R-9 | api-types.ts + openapi.json 同 change 提交（规则 21） |
| task-03 | `session-input-bar.tsx` 接入（检测驱动/IME/光标回填/onMentionsChange）+ 单测 | W3 | P0 | task-02 | FR-01/FR-02/FR-03/FR-08, NFR-02 | pendingCaretRef+useEffect 延迟 setSelectionRange；Enter 拦截边界；placeholder prop 不动（文案更新在 task-05 父级）；回归 turn-timeline-session-input-bar（placeholder 精确断言 6 处）与 session-input-bar-height |
| task-05 | `session-panel.tsx` 接线：3 渲染点（含 placeholder 文案更新 3 传参处）+ **7 发送组装点位** + 预会话 create 绑定 + 回归 | W4 | P0 | task-03, task-08 | FR-05/FR-06/FR-08, R-7/R-10 | 含 dialog sendToServerQueue :3496（dialog 忙轮）；page 重发不带 mentions（R-7 取舍）；回归 session-panel-* placeholder 相关用例 |
| task-09 | 全量回归：backend pytest + frontend vitest/tsc/lint | W5 | P0 | task-01~08 | NFR-04 | 含 `/team`、附件、草稿既有用例零回归 |
| task-10 | 冒烟硬验收：真实会话冒号名/用户技能调起 + @ 双路径（page+dialog）忙轮绑定 + /team 不回归 | W6 | P0 | task-05, task-07, task-09 | FR-03/FR-06, R-1/R-10 收口 | R-1 唯一遗留实质不确定点的实测闭环 |

## 关键路径
task-01 → task-02 → task-03 → task-05 → task-09 → task-10（前端主线，决定最短交付周期）

## 全局验收标准
1. backend pytest 全绿（覆盖率 ≥60% 门槛）+ frontend vitest / tsc / lint 全绿
2. 集成冒烟（task-10）：平台冒号名技能与用户技能经 `/` 联想选中后真实调起；`@变更`/`@快速修复` 在空闲与 running 忙轮（page 与 dialog 双路径）发送后，变更/quicklog 会话卡出现该会话；`/team` 拦截/剥离/回填行为不变
3. 不使用联想时行为完全不变：默认不弹层；请求体不带 bind 字段时后端零行为差异（集成敏感 task-05/07 加冒烟验收，组件单测全绿 ≠ 集成正确）
4. 生成物同步：api-types.ts 与 openapi.json 为本 change 内重生成版本（规则 21）

## 覆盖矩阵（决策记录在 design §2.1，无独立 decisions.md）
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001（方案 B 选定） | 全部 | 四件套 + Stage Review pass |
| D-002（/ 技能原样透传 + invoke_name） | task-01, task-06, task-10 | AC-2 冒号名调起实测 |
| D-003（inject 仿 page_context 可选字段 + 插入点） | task-07, task-10 | test_session_queue 用例 + AC-2 忙轮绑定 |
| D-004（跨 workspace placeholder 语义维持） | task-07 | test_session_service 跨 workspace 用例 |
| D-005（bind_quick_id=128 对齐 create） | task-07 | test_session_router 字段校验 |
| D-006（非目标边界） | — | tasks 无越界任务（Design Grill 已核） |
