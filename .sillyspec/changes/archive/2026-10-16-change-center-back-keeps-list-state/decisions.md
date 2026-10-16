---
author: flow-machine-draft
created_at: 2026-10-16T13:53:06.486Z
---
# 决策记录（Decisions）— 2026-10-16-change-center-back-keeps-list-state

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：- **风险①（已知取舍）**：`history.length > 1` 判定在「从站外页点链接进详情」场景会 back 回站外页——内部工具场景罕见，且符合浏览器标准「返回」语义；Next 14.2.5 的 history.state 无可靠栈深标记（idx 为 Next 15+ 字段），无法精确判定「上一条是否本站」， 接受该取舍。 - **风险②**：原生 replaceState 后浏览器「后退」退出列表（不回溯列表内翻页历史）——与 改造前行为一致（useState 翻页本就不产生历史条目），非行为退化；URL 与 UI 的瞬时不一致 仅出现在列表页内按浏览器后退的瞬间（随即整页离开列表），用户实证范围内不可见。 - **死路 A（放弃）**：router.replace 写回——每次翻页触发 RSC 导航请求（页面是 server component 树根），快速翻页产生请求风暴且可能互相竞态。 - **死路 B（放弃）**：sessionStorage 记「最后列表 URL」——多标签页隐式共享面、SSR hydration 需要挂载后二次渲染切 href，复杂度高于收益。 - **死路 C（放弃）**：详情页 URL 反向携带列表 query——污染详情 URL（分享/收藏语义脏）， 且从工作区首页等非列表入口进详情时无 query 可带。
