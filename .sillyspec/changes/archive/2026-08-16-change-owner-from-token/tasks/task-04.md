---
id: task-04
title: read-side projection — owner_name batch enrich + timeline event synthesis + two-layer truncation split + tests
title_zh: 读侧投影——enrich 批量 owner_name + 时间线合成事件条目 + 截断两层分离 + 测试
author: qinyi
created_at: 2026-08-16 11:40:00
priority: P0
depends_on: [task-03]
blocks: [task-06]
requirement_ids: [FR-03, FR-04, FR-05]
decision_ids: [D-003@v1, D-004@v1]
allowed_paths:
  - backend/app/modules/change/service.py
  - backend/app/modules/change/tests/test_step_progress.py
  - backend/app/modules/change/schema.py  # 仅注释行修正（:55 output「截断 200 字」旧表述）；若最终不动注释则从本列表删去
expects_from:
  task-03:
    - contract: StepTimelineEntry
      needs: [kind, event_type]  # kind str 默认 "step"（"step"|"event"）；event_type str | None
    - contract: ChangeSummary/ChangeRead
      needs: [owner_name]  # owner_name str | None = None（计算投影，enrich 可赋值）
  task-01:
    - contract: ChangeEventORM
      needs: [change_id, event_type, detail, created_at]  # detail JSONB；owner_change={from_user_id,to_user_id}；created_at tz-aware datetime
goal: >
  读侧投影三件事（design §5 Phase 2.1-2.2 + Phase 2.4）——①enrich_summaries / enrich_with_workspace_ids
  批量一次 IN 查 users 填 owner_name（display_name 优先 username fallback，R-03 禁 N+1）；
  ②详情路径时间线合成事件条目——change_events 一次 IN 查、owner_change 转条目（name=责任人变更、
  output="A → B"）、stage 用 stages.started_at 归一化近似、混合序列统一重编 ordering 保 key 唯一（Grill P1-1）；
  ③Phase 2.4 截断两层分离——明细 output 全量透传（:1687-1688 截断移除），列表摘要 current_step_desc
  赋值处（:1716）仍截 200（~200B/行列表性能契约不动）。
implementation:
  - owner_name 批量填充——新增私有辅助 _resolve_user_names(ids)（一次 select(User.id, User.display_name, User.username).where(User.id.in_(ids))，User 自 app.modules.auth.model import 入 service.py 顶部既有 import 块）返回 {user_id → display_name or username or None} 映射；enrich_summaries(:1465) 与 enrich_with_workspace_ids(:1436) 两路径均从 changes 收集 owner_id 去重调用并填 owner_name（owner_id None/查不到 → None，前端降级现状）
  - 时间线合成入口——合成逻辑放 enrich_with_workspace_ids（async 有 session；_extract_step_progress 保持纯函数静态不进事件合成）：stage_info 命中（:1457-1462）且 steps 提取非 None 才继续，一次 select(ChangeEventORM).where(change_id.in_([change.id])).order_by(created_at, id) 批量查事件（ChangeEventORM import 入 change.model import 块）；events 查询只挂详情路径——enrich_summaries 零 events 查询（列表零成本，测试锚定）；steps 为 None 时事件无处挂载不合成（时间线整体保持 None，D-003 降级语义）；事件查询异常 best-effort 不阻断 steps 返回
  - 事件转条目——owner_change 事件转 StepTimelineEntry：kind="event"、event_type="owner_change"、name="责任人变更"、output="A → B"（A/B=from/to 用户名）、status 固定 "completed"、completed_at=event.created_at.isoformat()（tz-aware UTC）、wait_reason=None；detail 防御 isinstance 判型（from_user_id/to_user_id 缺失或非 UUID → 跳过该事件不抛，R-01 范式）
  - 用户名一次查询合并（R-06）——事件 A/B 名字与 owner_name 共用同一次 users IN：先查 events 再并 id 集（owner_id ∪ 各事件 from/to）一次 _resolve_user_names 出全部名字；查不到的用户（已删/脏引用）→ UUID 前 8 位占位（对齐前端现状降级），不抛
  - stage 近似归属——用 latest_progress 顶层数组 stages[] 的 started_at（CLI 六表上行实证含此字段，progress.js:453）经 _normalize_completed_at 归一化（同 CLI 本地时区格式）后与事件时刻比较：归属「最近一个 started_at ≤ 事件时刻」的 stage；无可解析 started_at / 事件早于全部 → 用投影 current_stage（stage_info[0]）；防御判型不抛（R-02 近似可接受）
  - 混合重编——事件按近似 stage 归组后在组内按时间序插入：插在组内最后一条「可解析 completed_at ≤ 事件时刻」的 step 紧后（步骤 completed_at 不可解析/None 视为最晚——进行中/待办天然晚于历史事件），组内全无 ≤ 者 → 插组首；同刻多事件按 created_at 再按 id 稳定序；随后对最终混合序列统一重编 ordering=0..n-1（全局顺序号）——前端既有稳定排序键 (stage_group 序, ordering, completed_at) 复现后端序（组全局递增 numbering 保组内序）且 `${stage}-${ordering}` key 唯一（Grill P1-1）；可拆小辅助 _merge_event_entries 便于单测
  - 截断两层分离（Phase 2.4 / D-004@v1）——_extract_step_progress 明细截断移除：:1672 truncate 局部变量与 :1687-1688 的 output[:truncate] 删除（str 全量透传，非 str → None）；截断挪到摘要赋值处 :1716 current_step_desc（current.output[:_OUTPUT_TRUNCATE_LEN]，None 保持 None）；_OUTPUT_TRUNCATE_LEN=200 常量保留、注释改「列表摘要专用」；同步修 schema.py:55 output 注释（「截断 200 字」→ 全量透传 D-004@v1，截断仅列表摘要 current_step_desc）；前端 timeline 组件注释与 line-clamp 归 task-05 本卡不动
  - 测试（test_step_progress.py 追加 + 既有用例随行为改写，文件头 docstring 第 9 行「output 截断 200 字」同步改两层分离表述）——①owner_name 两路径填充（display_name 优先/仅 username fallback/owner_id None → None，User fixture 须带 password_hash NOT NULL）；②事件条目字段逐项断言（kind/event_type/name/output="A → B"/status/completed_at）+ detail 非法跳过；③混合排序：事件插组内正确位 + 重编 ordering 0..n-1 + `${stage}-${ordering}` key 集合无重复；④stage 近似两分支（started_at 命中最近已开始 / 无法判定 fallback current_stage）；⑤长文本用例（Grill note②）：500 字 output 明细全量 + 摘要 current_step_desc 截 200——test_extract_output_truncated_to_200_chars 改写为两层分离断言（D-004 有意行为变更，非修测试凑绿）；⑥查询次数锚定：monkeypatch session.execute 计数——N change 列表 enrich_summaries users 恒 1 次 + events 0 次；详情 enrich_with_workspace_ids（含事件）users 1 次 + events 1 次（R-03/R-06）；change_events 表经 task-01 模型注册由根 conftest change model import 自建，无需动 conftest
acceptance:
  - owner_name 两路径（列表/详情）填充正确——display_name 优先 username fallback；owner_id None/用户缺失 → None
  - 事件条目字段与排序——kind/event_type/name/output/status/completed_at 逐项正确；混合序列重编 ordering 0..n-1，`${stage}-${ordering}` key 唯一
  - 截断两层分离有测试——明细 output 全量透传（500 字长文本用例）、摘要 current_step_desc 仍截 200
  - 查询次数锚定——users IN 恒 1 次（两路径）；events IN 仅详情 1 次、列表 0 次（N+1 防回归）
  - 既有 change 模块测试全绿（仅 output 截断相关用例按 D-004 语义改写，其余零修改）
verify:
  - cd backend && ./.venv/Scripts/python.exe -m pytest app/modules/change/tests/test_step_progress.py app/modules/change/tests -q --no-cov
  - cd backend && ./.venv/Scripts/python.exe -m mypy app/modules/change/service.py
constraints: >
  两次批量 IN 禁 N+1（users 一次含 owner+事件 A/B 合并 R-06；events 一次仅详情路径，列表零成本）；
  事件条目 kind 填 "event"、status 固定 "completed"、event_type 填 "owner_change"（后续事件类型只加映射不改模型，
  D-002 扩展点）；明细只删截断不加新加工；schema.py 仅动注释行；不动表结构/migration（属 task-01）与 CLI 契约；
  行号引用以当前 HEAD 为准，多 agent 并行漂移时按符号名重定位；防御判型不抛，时间对齐近似乱序可接受（R-02）。
---
