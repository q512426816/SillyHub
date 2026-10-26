# task-05 执行侧对账（design 成功标准逐条）

> 正式核验由 verify 阶段 verify-result.md 承载；本文件是 task-05 执行侧逐条对账留痕。
> 对账基准：design.md「设计目标」6 条（2026-10-26 异常可见增补后）+ FR-01~FR-07。

| # | 成功标准 | 结论 | 证据（commit / 测试） |
|---|---|---|---|
| 1 | 状态条显示当前具体阶段（9 值词表）替代笼统「思考中/执行中」 | ✅ | PHASE_LABEL 九值导出且测试逐字锚定（bc0371b3 turn-status-bar-phase.test「九个词表值文案」）；全链路接线 db2a5909（信封→白名单→applyTurnPhase→双面板→timeline 透传） |
| 2 | 覆盖三类盲区：转发段（backend 自产）/启动准备段（daemon 上报）/首响间隙 | ✅ | 转发段：4366823c dispatched（enqueue_and_push 下发点）+ delivered（ack 回执点 D-011）；启动准备段：a73ee713 五冷启动边界；首响间隙：inject_received + first_event |
| 3 | 单阶段停留 ≥30s 切警示并显示已等待秒数 | ✅ | PHASE_TIMEOUT_MS=30_000（D-007）；测试 fake timers 推进 31s 断言警示样式+「已等待 31 秒」（bc0371b3）；30s 内不警示负向断言 |
| 4 | AI 干活期间统一文案体系（不新增事件） | ✅ | deriveTurnActivity 派生链零改动（D-008，task-04 未触碰）；first_event 后标签退位、右侧活动摘要接管（测试断言） |
| 5 | 纯增强零回归：无信号轮与现状完全一致 | ✅ | currentPhase 缺省分支=现状路径（测试「无 currentPhase 渲染与现状一致」锚定）；回归面全绿：backend 64/64（test_session_plan_bash_events+control_commands+dispatch+permission_owner_notify）、daemon 74/74（agent-event-report+inject-drop+interactive-bridge+turn-phase）、frontend 31/31（turn-time-display+status-bar+stream） |
| 6 | （FR-07/D-014 增补）等待交互轮不被判死机制误杀 | ✅ | 7ef1acb1 复扫链 askwait 豁免（同函数同 24h 上限纯复用）；三态测试：生产形态复刻不判死 / 24h 超龄回落判死 / 已回答后静默判死照旧；19/19 绿 |

## FR 级对账

| FR | 覆盖 | 证据 |
|---|---|---|
| FR-01 转发段发布 | ✅ | test_turn_phase_events.py 状态机翻转点正负向（delivered 仅 ack 点，mark_delivered 不发）；D-009 吞噬三态 |
| FR-02 启动准备段上报 | ✅ | turn-phase-report.test.ts hub-client URL/body/失败透传；daemon 五点边界（spec/mcp 跳过分支不发） |
| FR-03 轮内段上报 | ✅ | inject push 后 inject_received / onMessage first_event；防重键同 run 一次+新 run 重置（测试） |
| FR-04 状态条文案 | ✅ | 词表逐字+未知值原始字符串兜底+realRunId 路由+跨 run 不污染（测试） |
| FR-05 超时警示 | ✅ | 30s 阈值+warning token 零硬编码（类名断言） |
| FR-06 协议与类型同步 | ✅ | openapi.json 重导出+双端 api-types 同提交（4366823c，闸门⑨通过）；gen:types 幂等复跑零 diff |
| FR-07 判死豁免（增补） | ✅ | 见上表 #6 |

## 原型同源核对

`pnpm prototype:build` 重编译后 `git diff frontend/prototype-dist/` 内容为空（仅 CRLF→LF 行尾归一，checkout 恢复）——三处产物（变更目录 HTML / prototype 源视图 / prototype-dist 编译产物）同源 ✅。

## 缺陷②登记承接（design「异常可见」节）

「判停后 daemon 侧 agent 僵尸等待」登记为后续独立变更（反向 interrupt 指令，超 D-004 边界）。承接落点已落地：backend.md / sillyhub-daemon.md 各补「已知限制」条目（生产实证背景 + 修复方向 + 与缺陷①修复面 D-014 的关系——本变更只消除其触发面之一，残余触发面 daemon 真死/24h 超龄判死仍会走到该路径）。（execute 验收审查 gap 修复：初版仅登记缺陷①修复面，本节初稿声明过度，已如实更正。）
