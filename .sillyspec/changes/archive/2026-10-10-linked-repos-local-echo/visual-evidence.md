---
author: qinyi
created_at: 2026-10-11 00:05:00
change: 2026-10-10-linked-repos-local-echo
---

# 渲染对照证据（Visual Evidence）— 2026-10-10-linked-repos-local-echo

> execute 期落盘的 UI 对照结论（本变更是既有卡片内的增量区块，无独立原型——
> design 自审已声明复用上一变更原型设计语言；以下为代码级对照 + 组件测试断言）。

## 本机现状区对照（LocalEchoSection vs design FR-04）

| design 要求 | 实现（linked-repos-card.tsx LocalEchoSection） | 结论 |
|---|---|---|
| 初始引导文案零请求（D-003） | `!snapshot` 分支引导文案；测试断言 fetchSnapMock 零调用 | 一致 |
| 手动刷新按钮 | 「刷新本机现状」按钮 + fetched_at 时间戳展示 | 一致 |
| 三态徽标 | both=「两边一致」（brand 阶）/local_only=「仅本机」（amber 阶，路径未知标注）/platform_only=底部摘要行 | 一致 |
| 可导入条目勾选 | checkbox + 「导入所选（n/m）」计数按钮；路径未知条目（rel_path 与 abs_path 均 null）不渲染 checkbox | 一致 |
| 成员/管理员分层 | 成员无 checkbox 与导入按钮（测试断言 queryByRole null）；仅刷新可用 | 一致 |
| 四态降级占位 | binding_missing（请先绑定守护进程）/daemon_offline/daemon_unsupported 各引导文案；源级 skipped 并入空态文案 | 一致 |
| 双主题 | brand-*/amber 语义阶复用主题 token，零硬编码 hex | 一致 |
| 导入成功教育性文案（R-04） | message.success 含「已登记，可点『立即同步』落盘」 | 一致 |

## 组件测试佐证

`__tests__/linked-repos-card.test.tsx` 10/10 绿（新增 4 例：初始态零请求/三态渲染+勾选/
binding_missing 引导/成员视角无导入入口）。

## 已知偏差

无新增偏差（复用上一变更原型的设计语言，无独立原型需求——design 自审声明在案）。
