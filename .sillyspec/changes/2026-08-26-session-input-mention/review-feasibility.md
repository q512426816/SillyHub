---
author: qinyi
created_at: 2026-08-26 21:52:30
change: 2026-08-26-session-input-mention
reviewer: independent-subagent (Design Grill, explore read-only)
verdict: 需修订后可行
---

# 可行性复核报告（独立子代理，2026-08-26）

> 复核对象：本目录 design.md v1（方案 B）。完整原文见子代理输出，此处归档
> 结论与证据要点；修订已回写 design.md（§3.3/§4.1/§4.2/§6/§7/§8）与 tasks.md。

## 命题级结论

| # | 命题 | 结论 | 关键证据 |
|---|---|---|---|
| 1 | invoke_name 透传 | 可行（1 处表述偏差） | frontmatter name 已在 `_parse_skill_frontmatter`（skills_bundle_service.py:205）解析、聚合 :230 仅取 description；digest（:149-167）只含文件内容不含聚合 → 加键不影响 version；daemon 只看 version/files。偏差：端点返回 dict[str, Any]（daemon/router.py:3985），**无 Pydantic 响应模型**，「schema 加字段」是无的放矢 |
| 2 | binder 归属与越权 | 可行（2 条修正） | binder 按 (workspace_id, change_key) 查（binding.py:131-138），placeholder workspace 来自入参（:140-152），不校验 session↔workspace 隶属 → 调用方必须传 session.workspace_id；None 守卫照抄 create 先例（session/service.py:1220-1232）；跨 workspace change_key 只在会话自有工作区建 placeholder，暴露面与 run_sync 通道一致，可接受 |
| 3 | inject 落点 | 可行（1 个未覆盖坑） | 链：router inject_session（daemon/router.py:2305-2336）→ Facade DaemonService.inject_session（service.py:692-719，:669 注释「漏透传 500」教训，三层同步）→ SessionService.inject_session（session/service.py:2171，归属+锁 :2242）。**插入点必须 :2242 后、:2258 tool_report 前**：`_inject_into_session` 的忙轮排队早退（:2390-2457，queue_when_busy 时 AgentSessionQueuedMessage 后 return）会跳过 binder，而前端 running 时走 sendToServerQueue（session-panel.tsx:1830-1832）→ 绑定静默丢失。`_require_prompt_or_switch`（schema.py:242-251）不得纳入 bind 字段空 prompt 豁免 |
| 4 | 前端受控架构 | 有风险（可控） | onChange 签名不带光标，mention 回填须组件内部做（有 textareaRef）；仓库 setSelectionRange 零先例；受控 value 程序化更新后同步 setSelectionRange 会被 React DOM 更新覆盖 → 必须 useEffect + pendingCaretRef 延迟执行；jsdom 支持，可测 |
| 5 | 三渲染点接线 | 基本成立 | 3 渲染点 props 近同（:2202/:2571/:4169），可选 prop 零破坏；发送组装实际 **6 个点位**（createSession：page :1719 / dialog :3636；injectSession：page sendFromQueue :1546 / sendToServerQueue :1612 / page resend :1952 / dialog submitFollowup :3428）；resend 不带 mentions 列已知取舍 |
| 6 | /team 一致性 | 可行 | 选中回填 `/team `（带尾空格）→ 查询串含空白 → 浮层自动关闭；整条正则对 `/team xxx` 仍命中，拦截/剥离链路（ql-20260826-013）原样生效 |
| 7 | 测试影响面 | 可行（落点更正） | 前端新增可选 props + 浮层默认关闭 → 既有用例零破坏；test_session_runs_endpoint.py 无 inject 覆盖（grep 零命中），正确落点 test_session_service.py / test_session_router.py / test_session_queue.py（队列路径是命题 3 验收载体）/ test_skills_bundle.py |
| 8 | api-types 重生成 | 可行（2 处更正） | 路径是 frontend/src/lib/api-types.ts；lib/daemon.ts:903-906 以 Omit<SessionInjectRequest> 消费 → 重生成后自动获得新字段，不违规则 21（change 内提交两份产物）；manifest 前端类型手写（custom-skills.ts:53-82，端点无类型化 schema）→ invoke_name 须手写同步并注释来源，属既有手写惯例非违规 |
| 9 | slash 透传证据 | 可行（1 项推断需冒烟） | 交互会话 spawn 无条件落盘技能（daemon.ts:3747，无引擎分支绕过；codex 落盘惰性无害）；ql-013（QUICKLOG-qinyi-2026-08-26.md:480-492）证未知名报错；**冒号名已知名可调用是对称推断，execute 期实测冒烟必须保留为硬验收** |
| 10 | 数据源可用性 | 可行 | manifest 端点 get_current_principal 双路径鉴权，普通登录用户可调（auth_deps.py:167-202）；无技能时 404 需空态处理；workspaceId 可空链（真会话 :2378-2379 兜底 preContext）与「空时禁用 @」自洽，同构先例 X-009 |

## 必须修订项（已回写 design/tasks）

1. inject binder 插入点 = SessionService.inject_session :2242 后、:2258 前（覆盖忙轮排队早退）；验收用例落 test_session_queue.py。
2. binder 显式传 session.workspace_id + None 守卫；跨 workspace 语义写死为「仅在会话自有工作区建 placeholder（与 run_sync 通道暴露面一致，接受）」。
3. 删「manifest 响应模型加字段」步骤；invoke_name 手写同步 custom-skills.ts；api-types 路径更正。
4. 测试落点更正（见命题 7）。
5. 光标回填实现模式：useEffect + pendingCaretRef 延迟 setSelectionRange + 光标断言用例。
6. 冒号名可调用性 = execute 期硬性冒烟验收项。

建议（非必须）：tasks 按 6 个发送组装点位列清单防漏改；resend/草稿恢复不带 mentions 并入 R-7 取舍。
