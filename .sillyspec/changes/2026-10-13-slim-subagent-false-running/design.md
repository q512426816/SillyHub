# 设计记录（Design Record）— 2026-10-13-slim-subagent-false-running

## 做法概述

根因（会话 f231ca18 实证）：2026-09-27-session-fast-replay 的 slim 截断把超 2000 字符的 tool_call JSON 截残，前端 `parseToolUseRaw`/`statusFromToolUseRaw` 解析失败拿不到 `tool_use_id` → 子代理日志路由不进派发 tool 段、跌落为 `subagent_stub`，而 stub 状态在渲染层写死 running（turn-segment-views.tsx subagentStatus）→ 已结束会话永久「运行中」；同因连锁：regroupSubagentLogsByParent 登记失败（跨 run 终态行不重挂）、[TASK_*] 元数据路由失败（findToolById 不中）。

方案 A（主修，传输层回传配对键）：后端 slim 截断分支在截断**前**对完整原文做一次 `json.loads`，解析出的 `tool_use_id` 写入 `AgentRunLogEntry` 新可选字段 `tool_use_id`（仅在「该行被截断」时设置，其余路径恒 null）。前端三处消费：① `AssemblerLogInput` 增可选 `toolUseId`，装配器 tool_use 分支在行内解析失败时回退采用（段 id / extractStubById 合并键 / ids 登记同源）；② `toAssemblerInput` 透传；③ `regroupSubagentLogsByParent` 登记回退。选此方案因为：改动集中（后端 1 处截断点 + 前端 3 处回退点）、一次性修好所有存量历史会话、不动 slim 传输优化的性能收益。

方案 C（兜底，数据病理中性化）：`logsToSegments` 批量装配收尾时给仍残留的 `subagent_stub` 标记 `orphaned: true`（历史批量结束时 stub 必然意味着派发行缺失/不可解析）；渲染层 `subagentStatus` 对孤儿 stub 返回 "stopped"（灰点、无脉冲、无「运行中」文案，不渲染状态徽标药丸）。实时路径（applyLogToSegments 逐条）不标记，暂态 stub 行为零变化。

## 接口契约

- 后端 DTO：`AgentRunLogEntry`（app/modules/agent/schema.py）新增可选字段 `tool_use_id: str | None = None`（model_validate 透传不受影响；DB 无此列，仅 slim 截断分支内存赋值）；`GET /api/daemon/sessions/{session_id}/logs`（session_insights.py get_session_logs）slim 截断行为不变，仅新增回传字段；`backend/openapi.json` 再生 + `pnpm gen:types` 同步 `frontend/src/lib/api-types.ts`；前端手写镜像 `lib/agent.ts` AgentRunLogEntry 补同名字段（会话日志链路实际消费类型）。
- 前端：`AssemblerLogInput` 增可选 `toolUseId?: string | null`；`applyLogToSegments` tool_use 分支解析失败回退（优先级行内 JSON > 回传字段 > logId 兜底，与现状一致）；`subagent_stub` 段类型增可选 `orphaned?: boolean`；`subagentStatus`/`subagentHeaderOf` 消费孤儿标记。
- 其余端点/函数签名零变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：子代理日志先于派发行到达（stub 先建）时，派发行携回传 toolUseId 到达 → extractStubById 以恢复键正常合并迁入（既有路径，键源换成回退值）；终态行晚于派发行同 run 直达路由、跨 run 经 regroup 重挂后路由，均复用既有顺序无关语义。实时流不传 slim、无回退字段、行内 JSON 恒完整 → 零变化。
2. 并发写：后端 slim 赋值发生在 `model_validate` 产出的独立 DTO 实例上（既有 content_truncated 同款先例），不触 ORM/库数据，无并发面；前端装配器纯函数 path-copy，无共享可变状态新增。
3. 切换/生命周期：会话切换/翻页窗口边界——子日志与其派发行分属两页时，孤儿 stub 显示灰态（诚实降级，不假运行）；加载更多不跨页回填合并（与现状 stub 语义一致）。slim 赋值逐行独立，请求中断无半状态。
4. 作用域：字段按会话归属闸门既有链路返回（get_agent_session 404 口径不变），无跨会话/跨工作区新暴露；tool_use_id 本就存在于该会话日志正文内，非新增敏感面。

## 风险与死路

最大风险：回退键与行内解析键不一致造成错误合并——已用优先级消解（行内解析值恒优先；回退值仅当行内解析失败，此时行内无任何键可用，不存在二义）。次风险：孤儿 stub 误标把实时暂态 stub 变灰——标记只存在于 logsToSegments（历史批量）收尾，实时增量路径不经过该函数，结构性隔离。

放弃方案：① 前端对截断行按需拉全文再装配（getAgentSessionLogFull）——装配在 attach 同步路径上，逐条串行拉取拖慢秒开，且窗口翻页放大请求数；② 后端截断时保留 JSON 头部完整包络（截 args 保尾部）——需重排 daemon 落库格式，波及存量数据与 daemon 版本兼容，收益不成比例；③ 只做方案 C 不做 A——治标，配对仍断，子代理块状态/时长/任务徽标依旧缺失。
