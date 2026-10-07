---
author: flow-machine-draft
created_at: 2026-10-07T12:51:13.995Z
---
# 决策记录（Decisions）— 2026-10-07-hide-quicklog-tab

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险是既有测试对「点击 tab 进入」路径的依赖（桌面 2 个用例、移动端 12 处点击 + 2 处断言）——逐一改为 `?tab=quicklog` URL 初始化进入，并为隐藏补缺席断言。放弃的方案：a) 彻底删除 quicklog 视图与后端接口（存量历史数据失去唯一入口、牵动面数倍于收益）；b) CSS/条件 className 隐藏 tab 按钮（留下永假分支死代码，违反仓库一致性规则）。两者均未采用。
