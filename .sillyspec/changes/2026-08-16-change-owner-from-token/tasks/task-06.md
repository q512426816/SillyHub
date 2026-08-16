---
id: task-06
title: 全量回归——backend pytest 全量 + frontend vitest 全量 + tsc + 双用户上行冒烟（覆盖 FR-01~FR-05 集成验证, D-001@v1）
title_zh: 全量回归与双 token 上行冒烟收口
author: qinyi
created_at: 2026-08-16 11:40:00
priority: P0
depends_on: [task-04, task-05]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05]
decision_ids: [D-001@v1]
# 回归类任务：本 task 零新代码零新文件，此处仅登记被验证的写入/读侧入口；
# 若冒烟/回归暴露缺陷需修复，改动必须落回前序 task-01..05 的 allowed_paths（design §6 清单），本列表不扩张修改面。
allowed_paths:
  - backend/app/modules/platform_sync/service.py
  - backend/app/modules/change/service.py
expects_from:
  task-04: 读侧投影已交付——enrich 两函数批量 IN 查 users 填 owner_name + change_events 时间线合成（kind=event 条目/统一重编 ordering）+ 明细全量透传/摘要仍截断两层分离（service.py 与 schema.py 落地）
  task-05: 前端已交付——列表 owner 列 owner_name 优先 + ChangeStepTimeline kind=event 渲染 + line-clamp-2 移除自然换行 + 组件测试全绿
goal: >
  Wave 4 回归收口——task-01~05 全部落地后跑三套全量（backend pytest -n auto / frontend vitest / tsc），
  再以真实鉴权链做双用户上行冒烟：两用户各签一枚 shpsync_ token 先后上行同一变更，
  断言 owner 对齐最新 token 用户、owner_change 事件行存在、同用户重复上行零新事件，
  并核对 brownfield 旧契约（X-SillySpec-User/last_pusher 行为、kind 默认 step）零变化。
  发现回归只修不添功能，修复全部落回前序 task 的 allowed_paths。
implementation:
  - backend 全量回归——cd backend && uv run pytest -n auto -q（并行全量）；以当日执行计数为基线判定全绿，与最近一次 main 全量结果（约 3960+ 量级，4 个已知预存债失败除外）对比，出现新增失败即回归，定位到本变更触及模块优先排查
  - frontend 全量回归——cd frontend && pnpm exec vitest run（全量，非单文件）；对照 task-05 交付后的当日基线计数，新增用例（事件渲染/混合排序/纯 steps 回归/长文本不 clamp）全绿且存量用例零新增失败
  - tsc 类型检查——cd frontend && pnpm exec tsc --noEmit，0 error（gen:types 产物 api-types.ts 与前端消费一致，owner_name/kind/event_type 新字段类型闭合）
  - 双 token 冒烟（断言一+二）——经 POST /api/workspaces/{workspace_id}/platform-sync-tokens（backend/app/modules/platform_sync/workspace_router.py:86-114，main.py:702 挂 prefix="/api"——注意 plan.md 中 "/api/v1/" 为笔误，实测无 v1，以 openapi.json 为准）为两个各持 WORKSPACE_WRITE 的用户各签一枚 shpsync_ token（明文仅 201 一次返回）；token A 以 Bearer 上行同一变更进度（POST /api/changes/{name}/progress，六表 progress body + X-SillySpec-Base-Ts/Pushed-At header），随后 token B 再上行同一变更——断言 ux_changes.owner_id 为 B（GET 变更列表/详情 owner_name=B）且 change_events 存在 event_type='owner_change' 行（detail 含 from_user_id=A、to_user_id=B，created_by=B；DB 直查或详情时间线出现 kind=event 条目"A → B"二选一取证）
  - 同用户幂等冒烟（断言三）——token B 不换、原样重复上行同一变更（progress 内容可同可异）——断言 change_events 零新增行、owner_id 仍为 B（现值判据幂等，FR-01 第三分支集成级验证）
  - brownfield 契约核对（断言四）——冒烟请求带 X-SillySpec-User header，核对 last_pusher 落库值仍取 header 字符串（与 owner 更新互不干扰，design §5 Phase 1.3 兼容语义）；GET 详情 steps 条目无事件变更时 kind 缺省 "step"、旧字段（name/output/status/completed_at/stage/ordering）渲染零变化，旧契约回归
acceptance:
  - backend 全量 pytest 全绿 + frontend vitest 全绿 + tsc 0 error（均以当日执行计数为基线判定，无新增失败；预存债失败须与 main 基线逐项对得上方可放过）
  - 冒烟四断言全部通过——①owner 对齐后上行 token 用户 B；②owner_change 事件行存在且 detail 含 from/to；③同用户重复上行零新事件；④X-SillySpec-User/last_pusher 行为零变化 + kind 默认 step 旧契约不受影响
  - 发现回归只修不添功能——修复改动全部落在前序 task-01..05 的 allowed_paths 内（design §6 文件清单），本 task 不引入新功能文件/新端点/新字段
verify:
  - cd backend && uv run pytest -n auto -q（全量，记录通过/失败计数与失败清单）
  - cd frontend && pnpm exec vitest run && pnpm exec tsc --noEmit（全量，记录用例计数）
  - 冒烟步骤记录——两枚 token 签发的请求/响应摘要（勿留存明文 token，只留 key_prefix）+ A→B→B 三次上行的断言证据（owner_name 响应摘录 + change_events 行/时间线条目摘录），归入 verify 证据
constraints:
  - 冒烟执行形态二选一并留证据——部署环境真请求序列（curl/httpie 走真实鉴权链，附请求与响应摘录）或测试内集成用例（pytest httpx AsyncClient 走真实 token 签发+上行链路，用例落在前序 task 的测试文件 allowed_paths 内），不允许只读代码静态推演充当冒烟
  - 修复文件必须在前序 task-01..05 的 allowed_paths 内（design §6 文件清单）；task-06 本体零新代码，allowed_paths 仅登记被验证入口不作为扩张修改面依据
  - 非测试逻辑本身有误时禁止改测试来"通过"——修逻辑不修测试（CLAUDE.md 核心规则 11）
  - daemon/CLI 零改动（design §3 非目标）；冒烟不触碰 X-SillySpec-User header 既有语义
  - 全量测试若撞多 agent 并发引发的瞬态红（端口/文件锁/他 change 裹挟），先重跑一次复核再定性，勿把瞬态当回归修
---
