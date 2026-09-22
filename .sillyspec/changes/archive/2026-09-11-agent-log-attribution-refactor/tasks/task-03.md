---
id: task-03
title: 'backend ctx-owner two-level find attribution + quick-first grouping'
title_zh: 'backend ctx-owner 两级 find 归属解析 + quick 优先分组'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-12 05:15:18
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-03]
decision_ids: ['D-002@v1', 'D-003@v1']
allowed_paths:
  - backend/app/modules/platform_sync/service.py
target_files:
  - backend/app/modules/platform_sync/service.py
goal: >
  重写 platform_sync agent-logs 无 hub 分支归属段为 ctx-owner 两级 find 解析并把
  分组键改为 quick 优先：同 ctx 的平台会话（含跨 harness）优先挂接本地日志，
  无主时按新聚合键 "{ctx}" find-or-create（FR-03 / D-002@v1、D-003@v1）。
implementation:
  - 'service.py 无 hub 分支（:1387-1452）分组键改 quick 优先：ctx = entry.quick_id or entry.change_key or ""（现状 :1393 change 优先）；分组键 (harness, ctx) 结构保留；空 ctx 组维持现状 f"{harness}|" 单桶 + f"{harness} · 本地活动" 标题（原 find-or-create 语义不变）'
  - '非空 ctx 组 find 第一级（links）：ctx 为 quick_id → quicklog_session_links WHERE workspace_id AND ql_id（ql_id 自然键无 FK，binding.py:188-230 同口径）；ctx 为 change_key → changes WHERE workspace_id AND change_key JOIN change_session_links（links 存 change_id FK 非文本键，model.py:255-296）；两路均 JOIN agent_sessions（deleted_at IS NULL）取 last_active_at 最新者为 owner 候选'
  - 'find 第二级（聚合键兜底，bind 失败场景）：第一级未命中时按 origin=tool_report AND workspace_id AND aggregation_key="{ctx}" AND deleted_at IS NULL 取 last_active_at 最新（沿用现 :1399-1411 查询形状，仅键值从 "{harness}|{ctx}" 换 "{ctx}"）'
  - '命中（任一级）：组内 entries agent_session_id=owner.id 并刷 owner.last_active_at=now，不改 status/turn_count（生命周期契约）；两级均未中：find-or-create origin=tool_report（aggregation_key="{ctx}"、title=f"本地 · {quick 短码或变更名}"、provider 走 _tool_report_provider(harness) 映射不变、config_snapshot={"harness": harness}、status=pending，进 created_group_sessions 广播清单）'
  - '组级 _bind_entry_ctx 调用与实现（:127-148）不动（quick 优先已正确）；hub 分支（:1352-1386）与 _entry_last_seen_gte 时间重叠过滤、R7 IntegrityError 重试（:1245-1263）全部保留'
  - 'service.py 补 import：app.modules.change.model 的 Change/ChangeSessionLink/QuicklogSessionLink（现仅 import binding 两函数 :42），支撑第一级 links 查询'
acceptance:
  - '无 hub 推送 entry 带 quick_id 或 change_key：存在该 ctx links 绑定会话（含平台派发会话，跨 harness）时条目挂该会话且刷 last_active_at，status 不变'
  - 'links 未命中但存在 aggregation_key="{ctx}" 的 tool_report 会话 → 第二级兜底命中；两级均未中 → 新建 tool_report 会话（aggregation_key="{ctx}"、title=本地 · ctx 名）'
  - '同 entry 双键（change_key+quick_id 并存）按 quick_id 归组（D-006@v2 平台侧 quick 优先）'
  - '空 ctx 条目回归不变：{harness}| 单桶 + harness 标题'
verify:
  - 'cd backend && uv run ruff check app/modules/platform_sync/service.py && uv run mypy app/modules/platform_sync/service.py'
  - 'cd backend && uv run pytest app/modules/platform_sync/tests/test_agent_log_push.py -q --no-cov（归属断言更新归 task-04；本卡完成后既有断言允许临时红）'
constraints:
  - '只改 backend/app/modules/platform_sync/service.py；既有测试因分组优先级/聚合键/标题格式变化失效的更新全部归 task-04'
  - '不动表结构（D-005@v1）、不加 harness↔provider 一致性拦截（D-009@v1 否决）、hub 分支与 _bind_entry_ctx/R7 重试语义不变'
  - '非空 ctx 组组键仍含 harness（建会话 provider/标题用），owner 解析按 ctx 收敛——同 ctx 双 harness 两组允许解析到同一 owner'
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
