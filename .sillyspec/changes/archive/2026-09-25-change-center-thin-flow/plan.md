---
plan_level: full
execution_mode: main
---

# 实现计划（Plan）

## Spike 前置验证
无 Spike：技术方案确定性高——三个硬缺口与七触点均有子代理实证行号，上游 CLI 3.30.0 契约（--spec-root 消费/空目录放行/名称白名单/归档终值）已实测留痕（本会话核对 + sillyspec 仓狗粮）。Grill 三条 requiredEvidence 列入 verify 期核验，不构成 plan 期不确定性。

## Wave 1（并行，无依赖）
- task-01
- task-04
- task-09

## Wave 2（依赖 Wave 1）
- task-02
- task-03
- task-06
- task-07

> batch: task-03+task-06

## Wave 3（依赖 Wave 2）
- task-05
- task-08

## Wave 4（依赖 Wave 3）
- task-10

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 阶段模型：StageEnum THIN + 辅助清单 + 派发配置条目 + 排序位 + 计数测试 | W1 | P0 | — | FR-01 | model.py/dispatch.py（配置条目与枚举同批防红窗）/service.py/两个配置测试 |
| task-04 | binding 识别 flow 命令族 + 绑定测试 | W1 | P0 | — | FR-04 | binding.py/test_spec_binding.py；与 W1 其余任务文件不相交 |
| task-09 | quick 存量标注（前端五处） | W1 | P1 | — | FR-07 | quicklog-table/移动端页面/桌面页面/stats-row；纯文案面 |
| task-02 | 派发 prompt 模板（thin.md）+ change_key 白名单 + 测试 | W2 | P0 | task-01 | FR-02, FR-08 | dispatch.py 白名单段/NEW thin.md/NEW test_thin_stage.py |
| task-03 | 写入分流 quick→thin（writer 双入口） | W2 | P0 | task-01 | FR-03 | change_writer service/proxy + test_classifier 断言 |
| task-06 | parser 认 flow-state.yaml→thin | W2 | P1 | task-01 | FR-08 | parser.py + test_parser.py（既有文件补用例，与 task-02 无共享文件） |
| task-07 | 前端 thin 视觉（徽章/筛选/标签/概览卡） | W2 | P1 | task-01 | FR-06 | 五文件；与 task-02/03/06 文件不相交 |
| task-05 | 阶段回洗双守卫（A dispatch + B platform_sync）+ 守卫测试与事件对账 | W3 | P0 | task-02 | FR-05, FR-08 | dispatch.py 守卫段（task-02 后无共享冲突）/platform_sync service.py（hunk 隔离）/NEW test_thin_stage_guard.py |
| task-08 | 前端 thin 说明卡（桌面+移动）+ quick 卡退役文案 | W3 | P1 | task-07 | FR-06, FR-07 | change-stage-actions/mobile-change-detail |
| task-10 | 配置文档同步（CLAUDE.md/skills/工具坑留档/模块文档四件） | W4 | P2 | task-05, task-07, task-08, task-09 | FR-07 | 收口卡，吸收 module-map/changelog 登记 |

## 关键路径
task-01 → task-02 → task-05 → task-10（最长路径：阶段模型→派发配置→双守卫→文档收口）

## 全局硬约束（从 design.md 逐字抄录，绑定所有 task）
- 中文显示名一律「轻量变更」，技术值一律 `thin`（D-002@v1）；不与退役中的「快速任务/快速修复」混用
- 存量 quick 全链（QUICK 派发/quicklog 读写/bind_quick_id/蒸馏源/daemon guard.json）一行不动；主线五阶段与 quick 的 sync 行为逐字不变
- current_stage/change_type 全链自由字符串：禁加 Literal/枚举校验，禁跑 pnpm gen:types
- 双守卫谓词两路径同一规则：平台 current_stage=='thin' 且 DB 行非 archived → 跳过 current_stage 回写与 stages JSON 写入（时间戳类照常）；DB archived → 放行既有归档翻转链；非 thin 变更零作用
- thin.md 的 --input 过门格式：多行文本，独立节头行「成功标准：」+ 每行一条 `- <标准>`；禁止单行内联（会被清晰度门 exit 2 拒）
- platform_args 沿用现有形态（--spec-root/--runtime-root/--workspace-id）不改（3.30.0 flow 已消费 --spec-root）
- backend/app/modules/platform_sync/service.py 的提交按 hunk 隔离（git apply --cached），不夹带 observation-events-v3 在途 hunks
- 测试纪律：仅跑本变更相关聚焦测试，全量留 CI（CLAUDE.md 规则 0）
- 实现兼容 Windows/Linux/macOS（CLAUDE.md 规则 13）

## 全局验收标准
1. 聚焦测试全绿：test_thin_stage.py / test_thin_stage_guard.py / test_spec_binding.py / test_dispatch.py / test_dispatch_stage_config.py / change_writer 回归 / parser 测试
2. 存量回归不红：quick 派发与收尾链路既有测试（test_dispatch quick 断言/test_gate_transitions/test_step_progress）零改动通过
3. brownfield 零行为变化：守卫对非 thin 变更零作用（双守卫测试的「主线阶段不受影响」用例）
4. Grill requiredEvidence 三项 verify 期留痕：①flow done 归档终值断言含「无 stages['scan'] 幽灵块」②flow start 对非空预建目录接受性实测 ③daemon 机 sillyspec --version ≥3.30.0
5. 验收结论由 verify 阶段写入 verify-result.md，plan 不做执行态记录

## 覆盖矩阵（decisions.md）
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-02, task-03, task-04, task-05, task-07 | FR-01~FR-05 聚焦测试 + 守卫三态用例 |
| D-002@v1 | task-02, task-07, task-08, task-09, task-10 | 前端文案位全量「轻量变更」+ 文档同步 |
