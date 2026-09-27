---
author: qinyi
created_at: 2026-09-25 00:47:10
change: 2026-09-25-observation-events-v3-r16sf
plan_level: full
execution_mode: main
---

# 实现计划（Plan）— observation events v3

## Wave 1（并行，无依赖）
- task-01
- task-02
- task-05

## Wave 2（依赖 Wave 1）
- task-03

## Wave 3（依赖 Wave 2）
- task-04

## Wave 4（依赖 Wave 3）
- task-06

## Wave 5（依赖 Wave 4）
- task-07

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 存储层 detail 列 Text 化（ORM + Alembic 迁移） | W1 | P0 | — | FR-04, D-005@v1 | model.py 列改 Text + NEW 迁移（down 仅开发库）；迁移 upgrade 冒烟验收 |
| task-02 | 开关基础设施（feature_flag fail-closed + settings 管理端点 + 端点测试） | W1 | P0 | — | FR-06, D-008@v1 | NEW feature_flag.py 读 PlatformSetting；settings router GET/PUT（审计+管理员）；NEW settings/tests 包 |
| task-03 | 写入端点 v3 语义（schema 批上限 + service 截断/剪枝双态 + router 关态 422 + 写侧双态测试） | W2 | P0 | task-01, task-02 | FR-01, FR-02, FR-03, D-003@v1, D-006@v1 | schema events 静态上限 500（pydantic v2 `max_length`）；service `v3` 参数（detail 65536/剪枝 (created_at,id)）；NEW test_change_events_v3.py 写侧用例 |
| task-04 | 读取端点 v3 语义（limit 双态缺省 + since=created_at + 最近 2000 反转 + 响应字段 + 读侧双态测试） | W3 | P0 | task-03 | FR-04, D-002@v1, D-004@v1 | limit Query 缺省 None（关500/开2000）；since→created_at（id 决胜）；truncated/receivedAt/v3 响应 + exclude_none；读侧用例追加 test_change_events_v3.py |
| task-05 | 前端告警条（决策记忆纯函数 + ObservationAlertBar 组件 + 双测试） | W1 | P0 | — | FR-05, D-007@v1 | NEW lib/observation-alert-decisions.ts（sessionStorage 按告警 id）+ NEW 组件 + 两份 NEW 测试；severity∈{warning,error} |
| task-06 | 前端卡片两段拉取 + truncated 提示 + gen:types 重生成 | W4 | P0 | task-04, task-05 | FR-05, FR-06 | changes.ts limit 放宽；卡片探测升级 2000 + truncated 尾行 + 开态挂告警条；扩展既有 change-events-card.test.tsx（含关态断言，不弱化既有断言）；api-types.ts + openapi.json 同批提交 |
| task-07 | 文档同步（platform_sync 模块文档 + frontend_components 文档/changelog） | W5 | P1 | task-06 | FR-06 | 三份文档按最终实现同步（端点双态语义/开关/告警条） |

## 关键路径
task-01 → task-03 → task-04 → task-06 → task-07（后端语义链驱动，决定最短交付周期）

## 全局硬约束（从 design.md 逐字抄录，绑定所有 task）
- 开关读取 fail-closed：KV 无键/JSON 解析失败/值非 `{"enabled": true}` 均按 false；每请求读一次，不引入缓存
- 未配置开关时既有行为不变：关态响应 JSON 与 v2 逐字节一致（`response_model_exclude_none` 保证 `truncated/v3/receivedAt` 不出现）；既有 `test_change_events.py` 零改动全绿
- detail 64KB 口径三层逐字对齐：**64KB = 65536 个字符**（`detail[:65536]`），执行层=service 落库前截断；关态维持 2000
- 批量上限：schema 静态上限 500（pydantic v2 列表约束为 `max_length`）；关态 router 手动校验 `len(events)>200 → 422`（状态码与拒绝语义不变，body 结构差异已登记 R-03）
- 剪枝序：开态 `(created_at, id)` / 关态 `(ts, created_at, id)`，与本批插入同事务；并发少量超删容忍（R-02 已登记）
- since 语义：开态 `created_at > since`（排序补 id 决胜：无 since `created_at DESC, id DESC` 取数后服务端反转正序；有 since `created_at ASC, id ASC`）；关态 `ts > since`、排序 `ts ASC, id ASC`
- 回退=开关置关，零迁移零数据损失；迁移 down 仅限无 v3 数据的开发库（R-06）
- 禁止：新表/新端点组/常驻剪枝任务；前端增量游标；基于 provisional 事件的任何流程判定（红线）；错误文案一律中文
- 鉴权与 workspace 派生零变更：写仅 shpsync_（无凭据 401/其他轨 403），body 不收 workspace 字段
- 前端类型必须 gen:types 生成禁止手写（api-types.ts + backend/openapi.json 同批提交）

## 全局验收标准
1. 后端相关测试全绿：platform_sync 全模块测试（含既有 test_change_events.py 零改动）+ settings 新增测试；`ruff check` / `ruff format --check` / `mypy app` 过
2. 前端相关测试全绿：决策记忆/告警条/卡片测试；tsc 过；gen:types 重生成无 drift（gen:types:check 口径）
3. brownfield 兼容：未配置开关时既有行为不变（关态双锁：后端响应矩阵 + 前端渲染断言）
4. 集成冒烟（开态）：POST 500 条 → GET 缺省 2000 条 + truncated → 前端 30s 轮询渲染告警条且一次决策生效
5. 全量测试留给 CI（CLAUDE.md 规则 0：只跑相关测试）

## 覆盖矩阵（如存在 decisions.md）
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-03, task-04 | 原地演进无双表双端点（文件清单核对） |
| D-002@v1 | task-04 | since=created_at 读侧测试（乱序晚到不丢） |
| D-003@v1 | task-03 | 接收序剪枝测试 + R-02 登记 |
| D-004@v1 | task-04 | 缺省 2000 + truncated 测试 |
| D-005@v1 | task-01, task-03, task-04 | Text 迁移 + 65536 截断测试 |
| D-006@v1 | task-03 | 批 500/关态 422/去重复合键测试 |
| D-007@v1 | task-05, task-06 | 告警一次决策 + 30s 全量重拉测试 |
| D-008@v1 | task-02, task-07 | fail-closed 读取 + 管理端点 + 回退零迁移 |
| D-009@v1 | task-03, task-04 | 单路径双语义参数分支（无策略类无异步任务） |
| FR-01 | task-03 | 写侧批量矩阵 |
| FR-02 | task-03 | 幂等去重回归 |
| FR-03 | task-03 | 剪枝双态矩阵 |
| FR-04 | task-04 | 读侧矩阵 + 三层逐字对齐 |
| FR-05 | task-05, task-06 | 前端行为矩阵 |
| FR-06 | task-02, task-06, task-07 | 开关/回退/文档 |
