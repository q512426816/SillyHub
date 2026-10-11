---
author: flow-machine-draft
created_at: 2026-10-11T04:46:29.120Z
---
# 决策记录（Decisions）— 2026-10-11-retire-components-page

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-11-retire-components-page 留痕重锚 --> <!-- MACHINE-DRAFT:design-risks:end --> 最大风险：有外部脚本/书签直连 /components 路径——下线后 404。接受理由：该页 13/15 工作区 本就空数据，无可书签价值；信息已在关联仓回显。放弃的方案：①加「从模块索引生成」按钮复活 组件页（选项 B）——为空页续命而非解决问题；②后端端点一并删——破坏 openapi 面且无收益 （无人调用的 GET 无害）。
