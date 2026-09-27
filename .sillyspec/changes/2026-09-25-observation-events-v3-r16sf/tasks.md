---
author: qinyi
created_at: 2026-09-25 00:44:30
generated_by: sillyspec-brainstorm-step8
---
# 任务清单（Tasks）

- [ ] task-01: 存储层 detail 列 Text 化——model.py 列改 Text + NEW 迁移（down 仅开发库）(depends_on: )
- [ ] task-02: 开关基础设施——NEW feature_flag.py（fail-closed 读取 PlatformSetting）+ settings GET/PUT 管理端点（审计+管理员）+ NEW settings/tests 包与端点测试 (depends_on: )
- [ ] task-03: 写入端点 v3 语义——schema events 静态上限 500（pydantic v2 max_length）+ service v3 参数（detail 65536 截断/剪枝 (created_at,id)）+ router 关态批>200 手动 422 + NEW test_change_events_v3.py 写侧双态用例 (depends_on: task-01, task-02)
- [ ] task-04: 读取端点 v3 语义——limit Query 缺省 None（关500/开2000）+ since→created_at（id 决胜）+ 无 since 取最近 2000 反转正序 + truncated/receivedAt/v3 响应字段（exclude_none）+ 读侧双态用例追加 test_change_events_v3.py (depends_on: task-03)
- [ ] task-05: 前端告警条——NEW lib/observation-alert-decisions.ts 决策记忆纯函数（sessionStorage 按告警 id，容错降级）+ NEW ObservationAlertBar 组件（severity∈{warning,error}，新告警自动展开一次）+ NEW 纯函数测试与组件测试 (depends_on: )
- [ ] task-06: 前端卡片两段拉取——changes.ts limit 放宽 + ChangeEventsCard 探测升级 limit=2000 + truncated 尾行提示 + 开态挂载告警条 + 扩展既有 change-events-card.test.tsx（关态断言不弱化既有断言）+ gen:types 重生成 api-types.ts 与 backend/openapi.json 同批提交 (depends_on: task-04, task-05)
- [ ] task-07: 文档同步——platform_sync.md 端点双态语义/开关/feature_flag + frontend_components.md 告警条与两段拉取 + frontend_components.changelog.md 条目 (depends_on: task-06)
