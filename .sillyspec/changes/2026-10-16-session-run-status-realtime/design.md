---
author: flow-machine-draft
created_at: 2026-10-16T01:42:05.704Z
---
# 设计记录（Design Record）— 2026-10-16-session-run-status-realtime

## 做法概述

会话列表行首状态原本只靠 daemon 10s 日志活性推导链（用户指出：这是基线不是能力），用户触发会话后转圈/完成提示最长延迟 40s，且该链断（阿里云实测）则列表全空白。而后端 AgentRun 状态本是权威实时信号——发消息瞬间 run=running、等审批=pending_approval、跑完即无活跃 run——且 SSE sessions-changed 管道前端已订阅，run 终态即时触发列表刷新。本变更把 run 状态接到列表：schema 加 current_run_status（非 ORM，router 注入），列表端点照 owner_name/terminating_at 先例 IN 批查注入（窗口函数取每会话 created_at 最新活跃 run）；前端 sessionStatusIndicator 升级为 run 信号第一优先（pending_approval→琥珀、pending/running→转圈，压过活性 working），完成通知新增 run 完成触发源（活跃→null 且非终态且不在该会话上，与终态/活性转移来源共键）。日志活性链原样保留为本地 CLI 会话兜底基线。

### 文件变更清单（本变更交付对账面）

| 文件 | 变化 |
| --- | --- |
| backend/app/modules/daemon/schema.py | AgentSessionRead 加 current_run_status: str \| None（非 ORM 注入字段） |
| backend/app/modules/daemon/router/session_crud.py | 列表端点 IN 批查注入活跃 run 状态（窗口函数取最新） |
| backend/app/modules/daemon/tests/test_sessions_list_run_status.py | 新增（注入 6 用例 + OpenAPI 字段断言） |
| backend/openapi.json + frontend/src/lib/api-types.ts + sillyhub-daemon/src/api-types.ts | gen:types 再生（规则 21 双侧义务） |
| frontend/src/components/sessions/session-list-panel.tsx | 判定 run 优先 + run 完成检测 effect |
| frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | 矩阵增 run 用例 + run 完成触发源用例 |

## 接口契约

- `AgentSessionRead`（backend schema + 两处生成版 api-types）：新增可选 `current_run_status?: string | null`；值域 AgentRun.status 子集（pending/running/pending_approval），无活跃 run 为 null。向后兼容纯增量。
- `GET /api/daemon/sessions` 列表项行为：多注入一个字段（一条 IN 批查 SQL，零 N+1）；其余过滤/分页不变。
- 前端 `sessionStatusIndicator(status, livenessState, completedUnread, currentRunStatus)` 增第四参；SessionRow 经 session.current_run_status 直读（生成版字段，无需 props 改动）。
- 命令/文件格式：无。daemon 侧仅类型再生（无运行时消费变更）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：run 状态来自后端 DB 单源（列表快照），无乱序问题；run 完成检测基于连续两轮列表快照的 prevRunStatusRef 对比，SSE 触发的 refetch 与 10s 轮询可能交错——react-query 同 key 查询去重，快照仍单调推进；中间轮丢（活跃→活跃→null）不丢转移（null 那轮才触发）。
2. 并发写：只读注入，无写面；完成标记 localStorage 与既有两来源共键（幂等 setItem），无新增并发面。
3. 切换/生命周期：prevRunStatusRef 内存基线，挂载首快照为基线——历史空闲会话不误报；页面关闭期间 run 完成不补报（挂载期检测，与终态来源口径一致）；killed/failed 也走「活跃→null」触发完成通知——与活性转移来源口径一致（有动静回来看看，不区分成败）。
4. 作用域：run 按 agent_session_id 关联，owner-scoped 列表内注入，无跨工作区串面；注入 SQL IN 本页会话 id 子集，分页边界外会话不参与。

## 风险与死路

最大风险：run 状态回写时机依赖 daemon 回传（run 终态经 daemon RPC/清扫收敛落库）——daemon 半死时 run 可能滞留 running（转圈不停）。缓解：既有 lease 超时/清扫机制兜底收敛；且终态权威（ended/failed）与活性兜底信号不受影响。放弃的方案：a) 按用户最初设想做「交互触发按需查询 daemon 推导」——需要新 RPC + daemon 在线，平台派发会话本就有后端权威 run 状态，绕远路；保留为本地会话未来的可选增强。b) 前端单独拉每会话 run 列表端点——N+1 请求放大，列表批量注入一条 SQL 更优。c) run 状态直接写进 AgentSession.status 列——混淆会话生命周期与轮次执行两层语义（一轮跑完会话仍 active），动 ORM 需迁移。
