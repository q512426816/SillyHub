---
author: qinyi
created_at: 2026-08-27 06:35:20
---

# 冒烟验收结果（task-10 / W6）

> 环境：worktree 后端隔离实例（uvicorn :8100，commit b4895c8 基线 + 本变更后端
> 改动），连 dev 库（localhost:5432/platform）；SKILLS_BUNDLE_DIR 指向 daemon
> 本地技能缓存（20 个 sillyspec-* 技能）；假 daemon runtime（claude/online）过
> 在线校验——派发唤醒必然 504（无真 daemon 连 8100），不影响绑定链路验证
> （绑定在派发前落库）。冒烟数据已清理（会话/link/假 runtime 均删）。

## 结果总览

| # | 验收项 | 结果 | 证据 |
|---|---|---|---|
| 1 | FR-07 manifest invoke_name | ✅ PASS | GET /api/daemon/skills/latest/manifest：20/20 技能带 invoke_name，冒号名正确（sillyspec-archive→sillyspec:archive 等）；version 正常计算 |
| 2 | FR-05 create 通道双绑定 | ✅ PASS | POST /api/daemon/sessions 带 change_id+quicklog_id（workspace_id=b97f8231）：DB 落 change_session_links + quicklog_session_links 各 1 行；变更/快速修复会话卡端点（/api/workspaces/{wid}/changes/{cid}/sessions 与 /quicklog-entries/{ql}/sessions）均命中本会话 |
| 3 | FR-06 inject 通道绑定 | ✅ PASS | POST /sessions/{sid}/inject 带 bind_change_key+bind_quick_id（active 会话）：两条新 link 落库 + session_bind_applied 结构化日志（含 session.workspace_id）；**派发唤醒 504 后绑定仍持久**（binder 在派发前、best-effort 语义实证） |
| 4 | FR-06 幂等 | ✅ PASS | 同 key 重复 inject：session_bind_applied 日志重复出现但 link 行零新增（查库确认） |
| 5 | FR-06 字段校验 | ✅ PASS | 非法 ql 前缀 → 422；空 prompt + 仅 bind 字段 → 422（不纳入 _require_prompt_or_switch 豁免） |
| 6 | 既有语义零回归（failed 会话拒注） | ✅ PASS | failed 状态会话 inject → 409 SESSION_NOT_ACTIVE（既有守卫，先于绑定——语义正确：失败会话整体拒注） |
| 7 | 忙轮排队路径绑定 | ✅ PASS（pytest 载体） | test_session_queue.py::test_busy_queue_inject_still_binds（Wave 1 task-07 已绿）；live 冒烟因假 runtime 无法制造真实 running 忙轮，以 pytest 为准 |
| 8 | /team 行为零回归 | ✅ PASS（测试载体） | session-panel-team.test.tsx 等 599 用例全绿（W4/W5）；/team 拦截代码零改动（task-05 报告确认） |
| 9 | 前端 UI 交互（浮层/键盘/IME/光标/回填） | ✅ PASS（测试载体） | 交互原型 + 23+6+41+21+7 用例全绿；真实浏览器点验待合并后用户侧确认 |
| 10 | **R-1 冒号名真实调起（Claude Code slash command）** | ⏸ PENDING | 需真实 daemon + Claude Code 会话（本冒烟环境的假 runtime 无法拉起真 Claude）。**合并回 main 后由用户实测**：任意会话输入 / → 选 sillyspec-archive（冒号名）→ 发送，确认 Claude Code 执行该技能而非报 Unknown command |

## R-1 用户实测步骤（合并后）

1. apply 回 main 并重启本机 dev 后端（或部署）；
2. 打开会话页（挂 multi-agent-platform 工作区），输入 `/`，浮层应列出平台技能；
3. 选中任一冒号名平台技能（如 sillyspec-archive）发送，观察 Claude Code 是否
   正常执行技能（而非 `Unknown command: /sillyspec-archive`）；
4. 再验 `@`：输入 @ 选一个活跃变更发送（空闲态），打开该变更详情会话卡确认
   出现本会话；running 忙轮态重复一次（page 与 dialog 各一）。

## 结论

除 R-1（依赖真实 Claude Code 环境，已给出用户实测步骤）外，task-10 全部验收项
通过。后端绑定链路（create/inject/幂等/校验/失败不阻断）在真实 HTTP + 真实 PG
上逐项实证；前端交互与回归以 599 用例 + 交互原型覆盖。
