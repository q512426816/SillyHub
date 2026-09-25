---
author: qinyi
created_at: 2026-09-25 07:05:00
generated_by: sillyspec-brainstorm-step8
---
# 任务清单（Tasks）

- [x] task-01: 阶段模型——backend/app/modules/change/model.py StageEnum 加 THIN="thin" + spec_auxiliary_stages() 返回 [QUICK, THIN] + backend/app/modules/change/dispatch.py STAGE_AGENT_CONFIG 同批加 thin 条目（键集精确相等测试要求枚举与配置同波落，防跨任务红窗） + backend/app/modules/change/service.py _stage_group_order 排序位 + backend/tests/modules/change/test_dispatch_stage_config.py 断言 6→7 + backend/app/modules/change/tests/test_dispatch.py 期望集与 thin 断言 (depends_on: )
- [x] task-02: 派发 prompt 与白名单——NEW:backend/app/modules/change/prompts/thin.md（2 调用协议：过门格式多行 --input/填槽/flow done 断点续 fail-closed，platform_args 沿用） + backend/app/modules/change/dispatch.py 派发入口 change_key 白名单（thin 变更专用，拒 `..`/`default`/`quick-<hex8>`/路径分隔） + NEW:backend/app/modules/change/tests/test_thin_stage.py 配置与白名单用例 (depends_on: task-01)
- [x] task-03: 写入分流——backend/app/modules/change_writer/service.py:132 与 proxy.py:349 initial_stage quick→"thin"（change_type 标签保留） + stages JSON 初值 thin 组 + change_writer 回归测试 (depends_on: task-01)
- [x] task-04: 会话绑定——backend/app/modules/change/binding.py extract_spec_bindings 识别 sillyspec flow start|done|amend-draft --change <名>（run quick 跳过规则保留） + test_spec_binding.py 三命令绑定用例 (depends_on: )
- [x] task-05: 阶段回洗双守卫——backend/app/modules/change/dispatch.py sync_stage_status 守卫 A（thin 且 DB 非 archived：跳过 current_stage 回写与 stages['scan'] JSON 块；archived 放行翻转） + backend/app/modules/platform_sync/service.py _sync_change_stage_status 守卫 B（同谓词；hunk 隔离提交，不夹带 observation-events-v3 在途 hunks） + NEW:backend/app/modules/platform_sync/tests/test_thin_stage_guard.py（守卫 B 三态 + archived 翻转三源并集 + watcher 事件归属两前提对账） + test_thin_stage.py 追加守卫 A 用例 (depends_on: task-02)
- [x] task-06: reparse 推断——backend/app/modules/change/parser.py _infer_current_stage 增 flow-state.yaml 在场→"thin"（优先于 brainstorm 推断） + backend/app/modules/change/tests/test_parser.py 补 flow-state 推断用例（落点明确为既有 test_parser.py，不与 task-02 的 test_thin_stage.py 共享文件） (depends_on: task-01)
- [x] task-07: 前端 thin 视觉——frontend/src/components/changes/change-step-badge.tsx STAGE_KIND/STAGE_LABELS（thin=轻量变更 品牌紫阶；quick 加存量后缀） + changes/[cid]/page.tsx STATUS_BADGE.thin + 桌面/移动两份 STAGE_OPTIONS 加「轻量变更」 + change-stage-header.tsx WORKFLOW_STAGE_LABELS 加 thin + changes-overview-card.tsx BYPASS_BADGES.thin 与两处旁路判断（:229/:268） (depends_on: task-01)
- [x] task-08: 前端说明卡——frontend/src/components/changes/detail/change-stage-actions.tsx thin 两段式说明卡分支 + quick 卡文案改「已退役·存量收尾」（:139） + frontend/src/components/mobile/mobile-change-detail.tsx 补 thin 说明卡分支（形态对照 prototype-change-center-thin-flow.html B 面） (depends_on: task-07)
- [x] task-09: quick 存量标注——frontend/src/components/changes/quicklog-table.tsx 空态退役文案（:346） + 移动端 m/changes/page.tsx 空态文案（:873）与 tab 徽标「存量 · N」（:114） + 桌面 tab 徽标（:66）与副标题（:595-599） + stats-row.tsx 存量口径（:96-101）（形态对照原型 C 面） (depends_on: )
- [x] task-10: 配置文档同步——.claude/CLAUDE.md 规则 4 改指轻量变更/规则 19 标存量 + .zcode/skills/sillyspec-quick/SKILL.md 退役横幅与用法段 + NEW:docs/sillyspec/finished/thin-flow-quick-retirement.md 工具坑留档 + 模块文档/changelog 四件（backend.md/backend.changelog.md/frontend.md/frontend.changelog.md） (depends_on: task-05, task-07, task-08, task-09)
