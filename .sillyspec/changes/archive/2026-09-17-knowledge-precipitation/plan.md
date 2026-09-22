---
plan_level: full
author: qinyi
created_at: 2026-09-17 10:35:00
---

# 实现计划（Plan）— 2026-09-17-knowledge-precipitation

## Wave 1（并行，无依赖）
- task-01
- task-02

## Wave 2（依赖 Wave 1）
- task-03
- task-04

## Wave 3（依赖 Wave 2）
- task-05
- task-07

## Wave 4（依赖 Wave 3）
- task-06

## Wave 5（依赖 Wave 4；task-08 与 task-06 共改 page.tsx/knowledge.ts/knowledge-page.test.tsx，故串行分 Wave）
- task-08

## Wave 6（依赖 Wave 5）
- task-09

## Wave 7（依赖 Wave 6）
- task-10

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | backend 读侧 zone 化（parser 递归 + schema/service 透传 + openapi/api-types 再生成） | W1 | P0 | — | FR-06, D-004@v1 | path 保留前缀、filename 扩展子目录段、get 按 filename 精确匹配 |
| task-02 | KNOWLEDGE_WRITE 权限枚举 + 角色-权限播种 migration | W1 | P0 | — | FR-02, D-005@v1 | auth/permissions.py 先例；存量角色按 key SELECT 授予（R-06） |
| task-03 | 前端知识库页 zone 分组树 + 待审核徽标 + 既有 knowledge-page.test.tsx 适配 | W2 | P0 | task-01 | FR-06 | 消费再生成 api-types；zone mock/树断言同步更新 |
| task-04 | backend 写侧 writer + 写端点（propose/update/merge/reject/preview，两段式 + dupRe 幂等守卫 + 409 契约 + 字面量路由先注册） | W2 | P0 | task-01, task-02 | FR-02, FR-04, FR-05, FR-07, D-005@v1, D-007@v1 | writer.py 内部走 apply_ops；merge 目标白名单三类；落地后重跑 gen:types |
| task-05 | 前端沉淀弹层（手工录入 tab）+ entry-editor 编辑态 + 权限驱动写按钮 + lib/knowledge.ts 写侧封装 | W3 | P0 | task-03, task-04 | FR-02, FR-07 | NEW:precipitate-dialog / entry-editor |
| task-06 | 前端 merge-dialog 合并预览/确认 + 拒绝流 | W4 | P0 | task-05 | FR-05 | 预览渲染后端 dry-run 输出 |
| task-07 | backend distill 派发服务 + 端点（metadata_/AgentRunWorkspace/源校验/prompt 模板/任务列表） | W3 | P0 | task-02, task-04 | FR-01, FR-03, D-002@v1 | router.py 与 task-04 串行故同置 W3 之后（W3 内与 task-05 无共享文件）；daemon 离线立即 failed(no_online_daemon)；落地后重跑 gen:types |
| task-08 | 前端从记录提炼 tab + distill-task-bar 轮询 | W5 | P0 | task-05, task-07 | FR-01, FR-03 | 修改 task-05 所建 precipitate-dialog 增 tab；与 task-06 共文件故串行 |
| task-09 | 端到端集成验证（真实 workspace：录入→合并→CLI validate/search；派发→产出→待审核；权限门控负例） | W6 | P0 | task-06, task-08 | 全 FR | deployment-critical 集成证据采集（verify --done 门） |
| task-10 | 模块文档增量（knowledge/spec_workspace）+ 相邻面回归 + 原型对照复核 | W7 | P1 | task-09 | 全 D | 文档与实现一致性收口 |

## 关键路径
task-01 → task-04 → task-07 → task-08 → task-09 → task-10（与 task-01 → task-04 → task-05 → task-08 → … 同长；router.py 串行约束使 task-04 为写侧汇聚点）

## 全局验收标准
1. 相关单测全绿：backend knowledge/auth 新增用例 + 既有 knowledge 面零回归（uv run pytest backend/app/modules/knowledge -q）；frontend 知识库页相关组件测试 + pnpm exec tsc --noEmit 零错误
2. 集成冒烟（task-09）：真实 workspace 上 手工录入→待审核可见→合并→known-issues.md 新增 `##` 小节 + INDEX.md 新路由行 → `sillyspec knowledge validate` 通过 + CLI `knowledge search` 命中新条目；派发蒸馏→AgentRun 创建→（daemon 在线时）候选回流；未授权用户页面无写入口
3. brownfield：未授予 KNOWLEDGE_WRITE 用户行为与现状一致；GET /knowledge 响应只增字段（zone）不改不删
4. 两段式合并幂等：段 1 已生效后重试不重复追加小节（dupRe 守卫单测）
5. `pnpm gen:types` 产物（api-types.ts + backend/openapi.json）随变更提交，无手写类型

## 覆盖矩阵（如存在 decisions.md）
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-05, task-07, task-08 | AC-2（三来源入口可用，复盘无入口） |
| D-002@v1 | task-07, task-08 | AC-2（派发 AgentRun 链路） |
| D-003@v1 | task-04, task-09 | AC-2/AC-4（无新表、文件即真相、CLI 同源可搜） |
| D-004@v1 | task-01, task-03 | AC-3（zone 递归展示、响应只增字段） |
| D-005@v1 | task-02, task-04 | AC-4（平台直写走 apply_ops，409 冲突契约） |
| D-006@v1 | task-05 | AC-3（decisions 无编辑入口；手册/generated 可编辑） |
| D-007@v1 | task-04, task-06 | AC-4（两段式 + 白名单三类 + keywords 人工 + path 前缀保留） |
