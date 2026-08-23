---
author: qinyi
created_at: 2026-08-23 11:02:00
---

# 三入口浏览器实证（task-08 AC-3，对照原型 v2）

部署：backend+frontend 镜像 --build --force-recreate（127.0.0.1:3001/8001，backend health ok，容器内新代码标识 grep 命中）。
时间：2026-08-23 10:40–11:02。截图 6 张（artifacts/）。

| # | 清单项 | 结果 | 证据 |
|---|---|---|---|
| 1 | 全局完整树：工作区分组手风琴+机器小节+创建人 chip+截断+空组+非工作区末尾组 | PASS | e01-global-tree.png：workflow(4)/deepseek-harness(1)/cc-switch(0)/sillyspec(0)/multica(0)/multi-agent-platform(24)/未知工作区(5)/非工作区(105 末尾组)；机器小节带在线/离线（牛逼的电脑💻在线、哈哈哈/DESKTOP-HJ0AM09 离线）；条目 chips 含 👤 admin；105 条「显示全部」截断；0 会话组仍显示 |
| 2 | 两层筛选 tab：机器 tab→智能体层出现+过滤生效+「全部」清空 | PASS | 点「牛逼的电脑💻」→ 第二层智能体 tab（全部/⚡Claude Code/◎Codex）出现；总数 139→103、未知工作区 5→0、非工作区 105→74；「全部」恢复 |
| 3 | 组头「＋」→两步浮层→预会话态（同构+锁定上下文行） | PASS | 浮层仅在线机器（心跳 10:42）→选智能体→右侧同构会话面板（面板头/空时间线/附件+发送输入区）；上下文行 📂workflow·🖥牛逼的电脑💻·⚡Claude Code·🔒创建会话后不可更换；e03-pre-session.png |
| 4 | 首句发送原地开聊（此刻创建） | PASS | 发送"实证测试：请只回复两个字：收到"→ 会话 #0c92cead 原地创建（活跃态/SSE 接管"正在思考…"/轮次配置快照/配置控件条四控件运行锁定）；左侧 workflow 组 4→5 新会话进组顶；e04-first-message-live.png |
| 5 | 创建失败保留输入可重试 | 测试覆盖 | 实机不制造故障；session-panel-pre-session.test 11 用例含失败/重试断言（worktree 回归 1921 全绿） |
| 6 | 不发言离开零残留 | PASS | change 入口预会话态（未输入）路由切走再返回 → 列表仍「共 0 个」 |
| 7 | owner chip（旧数据兜底） | PASS | 全部条目 👤 admin；旧数据 null 显"—" 由 pytest 用例覆盖 |
| 8 | workspace 入口预展开 | PASS | /workspaces/0771887d.../sessions 标题「智能体会话 · 工作区」+单组树预展开（workflow 组 5 会话，新会话组顶）；e08-workspace-entry.png |
| 9 | change 入口独立页+变更名上下文 | PASS | /workspaces/.../changes/78e30eed.../sessions 标题「智能体会话 · 变更」+页头「新建会话（本变更）」+左侧平铺现状保留；点新建→上下文行 🧩提案书（Proposal）— 平台承接 Agent 日志上报（platform-agent-log-ingest）·📂multi-agent-platform·🖥·⚡·🔒；e09-change-entry.png / e09b-change-pre-context.png |
| 10 | ?session= 深链（无效静默） | PASS | /sessions?session=nonexistent-id-12345 → 静默落空门户态、树正常渲染零报错（有效 id 直达由组件测试锁定） |

plan.md 全局验收 6 条对照：
1. backend daemon pytest 978 passed + frontend 1921 tests/tsc/lint 持平 → PASS（regression-evidence.md）
2. R-01 预会话各 effect 零调用专项 → PASS（session-panel-pre-session.test 9 项断言）
3. FR-03 行为（同构/首句创建/失败保留/零残留）→ PASS（上表 3/4/5/6）
4. 旧会话 owner null 显"—" → PASS（pytest + chip 渲染）
5. 三入口+深链实证 → PASS（上表 8/9/10）
6. NewSessionForm 零残留 → PASS（task-07 grep 四标识零残留）
