---
plan_level: full
---

# 实现计划（Plan）— AskUser 提问通道 pi/cursor 接入 + 群聊聚合

## Spike 前置验证

| Spike | 验证内容 | 不通过后果 |
|---|---|---|
| spike-01（=task-05） | cursor 真机 10 次澄清场景，模型合法输出 ```askuser JSON 尾块标记 ≥8/10（可解析 + kind/question 必填齐） | task-08（prompt 注入）取消、cursor caps=none；task-06/07 保留为协议资产（解析器与卡片已实现但不启用）；Wave C 群聊 marker 卡分支不激活 |

## Wave 1（前置基础，并行无依赖、无共享文件）
- task-05
- task-02
- task-06
- task-12

## Wave 2（pi 桥接主体，依赖 task-02）
- task-01

## Wave 3（pi 收尾 + cursor 前端 + 后端授权，三者无共享文件；task-03 与 task-01 同文件故分波）
- task-03
- task-07
- task-09

## Wave 4（测试收口 + prompt 注入 + 卡片增强，依赖前置各自就绪）
- task-04
- task-08
- task-10

## Wave 5（群聊聚合，依赖 task-07/09/10）
- task-11

## Wave 6（总验收，依赖全部）
- task-13

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-05 | cursor spike 遵守率判定 | W1 | P0 | — | FR-04, D-003@v2 | 真机 10 场景 ≥8/10 门槛；结果写入 spike 记录，go/no-go 决定 W4 的 task-08 |
| task-02 | driver-factory sessionPermission 注入 pi 分支 | W1 | P0 | — | FR-01, D-002@v1 | session-manager/driver-factory.ts L291-315 扩 pi + PiStartOptions 槽位（对齐 CodexStartOptions） |
| task-06 | 前端 askuser-marker 解析器 + 单测 | W1 | P0 | — | FR-03, D-003@v2 | NEW:frontend/src/lib/askuser-marker.ts + NEW:.../__tests__/askuser-marker.test.ts；宽容边界清单（design §Wave B.2） |
| task-12 | caps 三端 dialog 键 | W1 | P0 | — | FR-06, D-005@v1 | providers.ts/provider_caps.py/provider-caps.ts + 对齐测试 _TS_BOOL_PAIR_RE 扩 string 枚举（test_provider_caps_alignment.py:57）+ 未知回退 'none' + pi permission_dialog 翻 true；连带债：session-panel-provider-caps.test.tsx 等消费 caps 的既有断言同步适配 |
| task-01 | pi dialog 桥接（上抛+挂起表） | W2 | P0 | task-02 | FR-01, D-002@v1 | pi-rpc-driver 四方法归一化 questions[] → requestUserDialog；dialog_kind=pi_extension_ui |
| task-03 | pi 答案回流+兜底+红线保持 | W3 | P0 | task-01 | FR-02, D-002@v1 | 同文件后继任务（与 task-01 分波防并行覆盖）；denormalize 对照 rpc.md L1130-1217（编码期确认该文档可达性，不可达则以 pi-events.ts 既有注释与实测帧为准）；close/abortAll 兜底 cancelled；权限类继续自动拒绝 |
| task-07 | AskUserMarkerCard + 时间线接入 | W3 | P0 | task-06 | FR-03, D-003@v2 | NEW:frontend/src/components/ask-user-marker-card.tsx；turn-timeline 文本段渲染+隐藏标记；已答态 best-effort；spike 不过仍交付（资产保留）；连带债：turn-timeline 系列既有测试若断言文本段渲染结构需同步适配 |
| task-09 | 影子会话答题授权放开 | W3 | P0 | — | FR-05, D-004@v2, D-006@v2 | permission_service.py:949 授权门 + **L959-963 manual_approval 第二道守卫影子分支**（群聊影子 manual_approval 恒关是现状——dialog 提问类放行须豁免该守卫的审批语义，仅 ask_user 类）；session_kind='group_member' + resolve_shadow_member 群成员校验；answered_by 实际答题人；连带债：backend test_session_permissions.py 既有断言适配 + 越权反例单测 |
| task-04 | daemon 单测 pi 四态 | W4 | P0 | task-01, task-03 | FR-01/FR-02 | tests/interactive/pi-rpc-driver.test.ts：上抛/应答/中止/权限拒绝 |
| task-08 | daemon marker prompt 注入 | W4 | P0 | task-05(go), task-12 | FR-03, D-003@v2 | session-manager consume 按 caps=marker 分派前缀协议常量 + 单测；spike 不过则取消 |
| task-10 | AskUserDialogCard 群聊增强 | W4 | P1 | task-09 | FR-05, D-004@v2 | 推荐人 @条（dialog_payload.recommendResponders）+ 已答关闭态显示实际答题人；连带债：ask-user-dialog-card.test.tsx 既有断言适配 |
| task-11 | 群聊聚合渲染 | W5 | P0 | task-07, task-09, task-10 | FR-05, D-004@v2 | group-chat-panel 聚合 pending 原生卡 + 群消息行 marker 卡 + 先到先得关闭态 + NEW 测试文件；连带债：group-chat-panel.test.tsx（2661 行）既有断言适配 |
| task-13 | 三波真机冒烟 + 回归 | W6 | P0 | task-04, task-07, task-08, task-11 | 全 FR | pi 一问一答同轮续跑 / cursor 标记全流程（spike go 时）/ 群聊成员答题 + 越权反例；相关套件回归全绿 |

## 关键路径

task-02 → task-01 → task-03 → task-04 → task-13（pi 主线）；task-09 → task-10 → task-11 → task-13（群聊线）；spike 侧线 task-05 → task-08。

## 全局验收标准

1. 相关单元/组件测试全绿（daemon pi 四态 + marker 解析 + 前端卡片/聚合/越权反例 + caps 对齐），连带既有测试债全部同步适配不欠账
2. 真机冒烟三项：pi 会话提问弹卡→作答→同轮继续；cursor 会话标记提问→卡片→答案作消息→续答（spike go 时）；群聊成员（非群主）作答成功 + 后答者见关闭态 + 非群成员 404
3. brownfield 回归：claude/codex 既有会话、普通单聊答题授权、caps=none 引擎行为与今日一致；page.test/sessions-portal/group-chat-panel 等相关既有套件不回归
4. 未启用路径可独立回退（pi fail-closed / cursor 不注入 / 授权放开独立提交）

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | （流程）六 Wave 组织 | plan.md Wave 1-6 结构 |
| D-002@v1 | task-01, task-02, task-03, task-04 | AC-2 pi 冒烟 + pi 四态单测 |
| D-003@v2 | task-05, task-06, task-07, task-08 | AC-1 解析单测 + AC-2 cursor 冒烟（go 时）+ spike 记录 |
| D-004@v2 | task-09, task-10, task-11 | AC-2 群聊冒烟 + 越权反例单测 |
| D-005@v1 | task-12 | AC-1 caps 对齐测试 |
| D-006@v2 | task-09（唯一例外）+ 其余任务复用管道 | AC-3 回归全绿 |
| D-007@v1 | （结构）全部任务 | 无网关层；端头直挂 |
