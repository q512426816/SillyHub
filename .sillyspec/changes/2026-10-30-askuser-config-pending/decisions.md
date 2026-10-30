---
author: qinyi
created_at: 2026-10-30T11:55:00+08:00
---
# 决策记录（Decisions）— 2026-10-30-askuser-config-pending

| ID | 决策 | source | 依据 |
| --- | --- | --- | --- |
| D-001@v2 | 待生效标记形态=brand 描边+浅底（`ring-1 ring-brand-400 bg-brand-50`），**无文字角标**；悬停 title「已记住，将随下一条消息发送时生效」 | user | 用户两轮裁决：首轮「只逐控件标记不加汇总行」，次轮「⏱待生效角标不需要展示」——高亮本体即标记 |
| D-002@v1 | 生效时机维持「随下一条消息发送时生效」，不扩答复提交协议（respondSessionPermission 零改动） | user | 用户在知晓技术背景（答复后同轮继续、中途换模型=打断）后选方案 A；2026-10-26 已放弃无轮切换通道 |
| D-003@v1 | 范围仅主会话页面（page 模式）四控件；dialog 弹窗面板不补配置条 | user | 用户确认使用场景为 page 模式；dialog 补配置条范围收益不成比例 |
| D-004@v1 | 暂存持久化用 sessionStorage（key `sh:config-staged:<sessionId>`，含 labels 同存） | user+code | 用户裁决方案 A；sessionStorage 刷新保留/关标签页自清/per-tab 隔离三特性恰好命中三个需求点，零清理逻辑零写竞争（localStorage 需 TTL 清理且多标签页写竞争） |
| D-005@v1 | 持久化数据损坏（JSON 坏/结构异常）静默丢弃并清坏条目，不弹错 | agent | 持久化是纯体验增强，坏数据回退空暂存即可；弹错打断主流程得不偿失 |
| D-006@v1 | 恢复时不校验暂存值有效性（供应商/档案可能已被删） | agent | 沿用既有「发送失败保留暂存可重试可改选」语义，不前置校验；失败路径用户可感知 |
| D-007@v1 | 原型走真码管线（prototype/ 视图源码 + prototype:build 产物登记变更目录） | agent | 本仓 ui_prototype 登记 form=real-code（local.yaml），UI 变更定稿原型必须真码 |
| D-008@v1 | askuser 场景零逻辑改动，靠高亮+悬停文案弥合「提交后按新选项执行」认知 | user+code | 现有链路（同轮回喂继续+暂存等下一条消息）已满足「不打断+按新配置执行后续」，缺的只是感知 |
| D-009@v1 | pending 悬停 title 与禁用态 title 冲突时**禁用态文案优先**（ended/离线时暂存可能仍挂着：高亮在但不可点，禁用原因更关键） | agent（我的判断，Grill B-001） | 实现者视角追问回收：不写清会靠猜，猜错方向=禁用会话上悬停显示「将随下一条消息生效」误导用户去发消息 |
