---
author: flow-machine-draft
created_at: 2026-10-04T14:02:30.626Z
---
# 设计记录（Design Record）— 2026-10-04-takeover-tier3-agent-cwd-fallback

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-04-takeover-tier3-agent-cwd-fallback 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
改 `backend/app/modules/daemon/session/service/takeover.py` 的 `resolve_takeover_machine`：tier3 匹配 cwd 从「只读会话行 `source.cwd`」改为「会话行优先、空则回退最新 `platform_agent_logs` 条目的 `agent_cwd`（主日志优先，排除 subagent 前缀路径，R-04 惯例）」。新增私有 helper `_latest_agent_cwd`。选接手侧回退而非建桶时回写会话行 cwd：协议 `docs/platform-agent-log-protocol.md` §4 明确 tier3 口径就是 entry 级 `agent_cwd`，且回退对存量会话（不会再上报）立即生效、零数据迁移；建桶回写只救未来上报。409 第三态文案同步用有效 cwd 展示，不再恒显「未知」。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-04-takeover-tier3-agent-cwd-fallback 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
内部函数 `resolve_takeover_machine` 行为变化（无 HTTP 签名变化）：tier3 的 cwd 来源加 entry 级 `agent_cwd` 回退；`_fail` 第三态文案中的目录展示从 `source.cwd` 改为有效 cwd。端点 `POST /api/daemon/sessions/{id}/takeover` 对外契约不变——原先 409「未携带机器身份…」的场景中，凡 entry 带 `agent_cwd` 且被唯一在线机器白名单覆盖的，现在改为 201 接手成功（这正是协议 §4 的既定语义）。

文件变更清单（自声明）：

- `backend/app/modules/daemon/session/service/takeover.py`（实现）
- `backend/app/modules/daemon/tests/test_takeover.py`（测试）
- `.sillyspec/docs/backend/modules/daemon.md`（模块文档人工备注追加本变更条目）

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-04-takeover-tier3-agent-cwd-fallback 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：回退源按 `last_seen_at` 倒序取最新且主日志优先——CLI 全量重推是整行覆盖语义，乱序迟到推最终收敛到最新值；tier3 只在「会话行 cwd 为空」时启用，会话行有值时行为与旧版逐字节一致。
2. 并发写：helper 只读（SELECT limit 50），不写任何行；与 ingest 的整行覆盖无竞态（最坏读到上一次上报的 agent_cwd，匹配结论仍指向同一台机器——allowed_roots 变更频率极低）。
3. 切换/生命周期：takeover 本身不写源会话行（D-006 红线不变）；请求中断只是不建接手会话，无中间态。
4. 作用域：查询按 `agent_session_id == source.id` 过滤，会话行本身已按 user_id + 未软删校验，不跨工作区串台；subagent 行可能在同会话名下，主日志优先 + 排除 subagent 前缀已隔离其 worktree 副本 cwd。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-04-takeover-tier3-agent-cwd-fallback 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：回退扩大 tier3 命中面后，若两台在线机器白名单都覆盖该 agent_cwd，会从「409 无匹配」变成「409 歧义（列候选机器名）」——不静默换机的红线不变，只是拒因更准；真歧义时用户按文案清理白名单即可。试过放弃的方案：建桶/刷新时把 agent_cwd 回写会话行 cwd——只对未来上报生效，存量会话（如线上 7ea5177a，已不会再被旧 CLI 重推）救不了，且给 ingest 增加一条写路径；协议 §4 的口径本就是 entry 级匹配，故弃。
