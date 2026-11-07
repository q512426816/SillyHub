---
author: qinyi
created_at: 2026-11-06 22:25:04
generated_by: sillyspec-fourpiece-init
---
# 提案书（Proposal）

## 动机
平台上不挂工作区创建的闲聊会话，在结束/超时回收后点「重新开启」必报 `HTTP_409_DAEMON_SESSION_NO_CWD`（该会话无关联工作目录，无法恢复对话记录），历史可看但会话永久不可续。2026-11-06 用户报障，要求根治并兼容存量已 409 会话。

## 关键问题
1. 根因是 2026-08-21 设计决策 DS-7 把「无 cwd 会话」全判定为 scan/bootstrap 一次性会话提前 409——但闲聊会话实际由 daemon 以 `config.workspace_dir` 兜底运行，transcript 真实存在且归档目录确定，只是 backend 未记录（`session.cwd` 恒空）。
2. backend 侧无任何可靠数据源可回溯非工作区会话的真实目录（日志表不收此类会话，`agent_sessions.cwd` 为空）——cwd 真相只存在于 daemon 本地（sessions.json 快照 / workspace_dir 兜底规则）。
3. 存量已 409 会话若只修「新建会话记录目录」则永远救不回——必须有重开时的解析救回路径。

## 变更范围
- backend：reopen 前置校验删除「空 cwd 提前 409」（agent_session_id 自愈链保持）；SESSION_RESUME payload 的 cwd 改条件键（两处构造点）；notify 端点（session ready / confirm reconnected）解析可选 `cwd` 键落库；`DaemonSessionNoCwd` 错误类退役；请求 schema 加可选字段并双端 gen:types。
- daemon：`_routeSessionResume` 恢复记录 cwd 改三级同源链（payload → 本地快照 → workspace_dir）；三处发送点（create ready / recover ready / confirm）携带实际生效 cwd。
- 发版顺序：先 daemon 后 backend（灰度期双向安全，详见 design 兼容策略）。

## 不在范围内（显式清单）
- 不做 backend 侧 cwd 推导/分配（D-003/D-005）
- 不做 transcript 线性扫描预验证（D-002@v2）
- 不按会话来源（origin）分流放行（D-006）
- 不改会话空闲回收/挂起/巡检生命周期时序
- 不做前端界面改动（409 场景整体消失，工作目录徽标为数据驱动被动展示）
- 不新建独立回报端点（D-008）

## 成功标准（可验证）
- 存量已 409 的非工作区会话（含用户报障实例 e3599588）重新开启成功并续聊：reopen 请求不再返回 HTTP_409_DAEMON_SESSION_NO_CWD，daemon 完成三级链解析后 SDK resume 成功、会话回到 active。
- 新建非工作区会话首轮成功后，`agent_sessions.cwd` 落有 daemon 实际运行目录（快照或 workspace_dir），会话面板工作目录徽标可见。
- SESSION_RESUME payload 对空 cwd 会话不再携带 cwd 键；工作区会话 payload 与现状逐字节一致（cwd 键照发）。
- ready/confirm 端点对缺省/空串 cwd 键 no-op，对非空值落库；老 daemon（不发键）与老 backend（忽略键）双向零破坏。
- `DaemonSessionNoCwd` 错误码从代码与 OpenAPI 面退役；聚焦测试全绿（backend test_session_reopen 相关 + daemon resume 路由相关），不跑全量。
