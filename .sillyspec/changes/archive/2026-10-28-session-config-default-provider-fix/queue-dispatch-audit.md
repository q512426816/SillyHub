# 排队派发链路核查——配置切换时序与用户期望对齐确认

change 2026-10-28-session-config-default-provider-fix / 成功标准第 5 条落档。

## 用户期望（本轮拍板）

「agent 接收到新消息时才触发供应商和模型等数据的切换」——即切换跟随消息派发生效，
不主动打断正在运行的轮次。

## 链路走读结论（代码锚点）

### 前端暂存（/sessions 会话页 page 模式）

- 2026-10-25-session-config-deferred-switch + 2026-10-26-config-staged-all-states：
  四控件（供应商/模型/档案/思考级别）**全状态点选 = 暂存**（`stagedConfig`，
  session-panel-page.tsx:1105），不立即请求后端、不产生空切换轮。
- 空闲直发：`buildStagedInjectOptions()` 并入 injectSession options
  （session-panel-page.tsx:3924 / 3969-3971）。
- 忙轮入队：同点位并入（:4081 / :4086）；backend 排队条目保存
  agent_profile_id / llm_provider_id / model（backend queue.py:323-327），
  轮末派发时逐字段透传回注入（queue.py:1011-1014）——暂存不丢。

### backend（inject 带切换维度 + 消息）

- `_inject_into_session` config_switch 分支：新 run 落新配置快照、会话三列刷新、
  SESSION_SWITCH_CONFIG 下发（payload 带 prompt + providerConfig）
  （backend inject.py:569-583 / 907-922）。
- 守卫：inject 的 model 非空必须同请求带 llm_provider_id（inject.py:140，422）；
  前端切模型时自动伴生供应商键（session-config-bar.tsx executeSwitch companion）。
- create 路径无此守卫——预会话「未选供应商 + 选模型」合法（后端默认供应商链以
  会话所选覆盖主模型派生，lease/context.py D-001 双键覆写）。

### daemon（切换生效时机 = 消息被接收时）

- SESSION_SWITCH_CONFIG → `markPendingConfigSwitch`（session-manager.ts:2341）：
  - **空闲**（status=active 且无 currentRunId）→ 立即 `reloadWithConfig`：关旧
    driver → 按 payload 重建 env（新供应商凭证/模型）→ `driver.start(resume)`
    重载完整对话历史 → **reload 完成后**才把 prompt 喂进 inputQueue 并置
    running（session-manager.ts:2456-2461）。**用户消息被 agent 消费前配置已切换。**
  - **生成中** → 写 `pendingConfigSwitch`，turn 收尾（onResult）消费 reload
    （events.ts:212-226）；onResult 同步先置 status=active / 清 currentRunId
    （events.ts:83-93）再 await 终态上报——backend 轮末队列派发的切换消息无论
    落在哪个窗口都收敛到「reload 后喂消息」，无丢失路径。
- reload 失败保留旧 driver 不破坏会话（R-01），配置切换可重试。

## 结论

- 切换时序语义 = 「agent 接收到新消息时才切换」——与用户期望一致，**本变更不改动
  该时序**。
- 用户此前感知的「要等下一轮」：忙轮场景下消息本身进服务端排队、等当前轮结束才
  派发（单会话单活跃轮不变式），派发那条消息即用新配置——属设计内排队语义，非
  缺陷；空闲场景链路自洽（先 reload 后喂消息）。
- 本变更只修显示层（默认供应商按引擎匹配展示 + 模型下拉回退渲染）与 dialog 首句
  model 漏传，切换时序零触碰。
