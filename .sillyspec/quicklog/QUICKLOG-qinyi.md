
## ql-20260909-024-02ba | 2026-09-09 20:52:08 | sessions/page.test.tsx 12 用例失败修复——三重根因（视觉焕新漏跑断言过时/刻度轨阈值夹具/once 队列泄漏污染）
状态：已完成
关联变更：（无）
文件：
- frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx（12 失败归零——轮次胶囊节点级断言×4+头像 title 断言+跳转夹具补第三轮+beforeEach mockReset 防 once 队列泄漏）
需求：sessions/page.test.tsx 12 用例失败修复——三重根因（视觉焕新漏跑断言过时/刻度轨阈值夹具/once 队列泄漏污染）
根因：视觉焕新提交（618bdaec2）只跑相关 40 套件未含本文件——轮尾换 RoundDivider 胶囊后轮次标签与状态拆成兄弟文本节点、头像换 ChatMessageAvatar 失去 aria-label；ql-20260909-005 刻度轨 <3 轮整条隐藏而轮次导航夹具仅 1-2 个 run；两类失败又经 vi.clearAllMocks 不清 mockResolvedValueOnce 队列的缺口连锁污染后继用例首屏
方案：page.test.tsx 五处修——4 处 getByText(/第 N 轮 ·/) 改节点级 getByText("第 N 轮")；头像 getByLabelText("发送者 X") 改 getByTitle（我（名字）/他人名字）；桌面跳转公共夹具 2→3 轮（最旧 r-ancient completed 孤儿补建为已加载第1轮，UNLOADED_TICK_LABEL 第1轮→第2轮）+直跳单轮补两个更新 failed run；beforeEach 对 getAgentSessionLogs 加 mockReset 防 once 队列泄漏
结果：page.test.tsx 36/36 两轮全绿（原 12 失败归零，文件时长 60s→9.7s）；tsc 0 错；eslint 0 error（4 warning 全预存）；frontend.changelog.md 已登记并勘正 ql-20260909-022 条目「存量环境债」误判
审计：⚖️ 归属切分：1 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：docs/sillyspec/brainstorm-gate-agent-unavailable-and-list-path-parse.md

## ql-20260909-025-b045 | 2026-09-09 21:12:57 | 修冲突对比假差异——仅行尾/末尾换行差异的文件不再判 modified（换行归一化后比较）
状态：进行中
关联变更：（无）
文件：backend/app/modules/daemon/sillyspec_compare.py, backend/app/modules/daemon/tests/test_sillyspec_compare.py
