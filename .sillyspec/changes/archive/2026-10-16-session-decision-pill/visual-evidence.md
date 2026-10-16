# UI 视觉证据（2026-10-16-session-decision-pill）

浏览器实测（部署后 IAB 截图，会话 f231ca18-0a5b-403d-a594-edf105827f1c，4 条已答 AskUser 提问）：

1. **双 pill 并排渲染**：聊天区右下输入条上方悬浮行——"待决策"pill（徽标 0，无 pending 不呼吸）与"变更文件"pill 并排；`data-testid=session-decisions-hover` 与 `session-change-files-hover` 均在场。
2. **分组下拉**：点击 pill 弹出——"待决策（0）"组 + "▸ 已答历史（4）— 点击展开"折叠行；展开后 4 条历史项（问题标题 + "提问/已答"徽标 + 短时间 + "你的回答：…"摘要）。
3. **只读详情弹窗**：点历史项打开——问题 + 全部选项（选中项 ✓"你的选择"，未选 ○）+ 提问/回答时间；自定义文本作答行"你的回答（自定义文本）：这三种都做一个原型图，我看完后确认。"（修复后复验通过）。
4. **截图存档**：
   - `C:\Users\12532\.zcode\cli\artifacts\sess_8a0bfc49-2dd7-476c-933b-b69d7a2d1e34\call_6b5dc4e9af2c45ceab7bd471-tool-result-517d8304-7a18-4fc9-8726-eae310b44e1d.png`（详情弹窗·修复前）
   - `C:\Users\12532\.zcode\cli\artifacts\sess_8a0bfc49-2dd7-476c-933b-b69d7a2d1e34\call_18792be059f74f1497758ab7-tool-result-9c630280-e077-40f0-beb0-3f1836f4e007.png`（双 pill + 分组下拉·终态）

## 未覆盖面（如实登记）

- **pending 项点击定位还原**：需活体 agent 提问（会话在跑 + daemon + 模型链路），本次未安排；由单测覆盖回调链（onFocusPending 哨兵路由）与 TurnTimeline focus effect（turn-timeline-dialog-minimize 回归 6 用例绿）。
- **ended 会话孤儿 pending 行归历史**：实测 ended 会话（57dfc7c5）面板本身不挂载任何 pill（变更文件 pill 先例同行为，非本次回归），该路径仅单测覆盖。
