---
author: qinyi
created_at: 2026-10-10 23:02:30
generated_by: sillyspec-fourpiece-init
---
# 提案书（Proposal）

## 动机
关联仓功能已有下行链路（平台登记→daemon 落盘），但对偶缺失：成员本地手工配置的
sillyspec projects 子项目登记与 local.yaml repos: 注册表，平台卡片看不到——用户期望
「本地已配置好的关联仓，平台页面能看到回显」（D-001）。

## 关键问题
- **本地配置不可见**：手工 `workspace add`/`register-repo` 的成果只在本机，平台侧
  零感知，团队成员无法对照「平台登记 vs 本机实际」。
- **重复录入成本**：本地已配好的仓要在平台再用一遍表单，无导入通道。

## 变更范围
- daemon：只读快照 RPC（linked_repos_snapshot——spawn `workspace status --json` +
  `config cat` 解析 repos 段，归一 projects/repos/fetched_at，零写盘）。
- backend：GET local-snapshot（RPC 拉取+三态对照计算+降级）与 POST import（复用
  create_repo/upsert_my_path 逐条导入，重名跳过）两端点。
- frontend：关联仓卡片新增「本机已有配置」区（三态徽标/手动刷新/勾选导入/离线占位）。
- 测试：daemon 命令拼装与解析、backend 对照与导入幂等、前端区块交互。

## 不在范围内（显式清单）
- 不做：快照持久化/自动轮询/WS 推送（手动刷新即弃，D-003/D-005）。
- 不做：本地配置写/纠偏（快照只读；写仍属下行链路）。
- 不做：跨成员聚合（快照=当前用户绑定机器）。
- 不做：自动判断哪些本地条目是「关联仓」（照实展示，用户勾选导入）。
- 不做：sillyspec 工具改动。
- 不做：既有下行链路（登记 CRUD/同步/落盘/状态回环）任何行为变化。

## 成功标准（可验证）
- 本地手工 `workspace add demo ../demo` + `register-repo demo C:/x/demo` 后，平台卡片
  「刷新本机现状」能列出 demo 两条本地条目（projects/repos 双源）且标 local_only。
- 勾选导入后：平台列表出现 demo 登记行（rel_path=../demo；当前用户 my_path=C:/x/demo），
  重复导入第二次响应 skipped；导入后点「立即同步」走既有落盘链路不报错。
- daemon 离线时刷新显示「守护进程离线」占位，列表主体与其它按钮不受影响。
- 老 daemon/老 CLI 降级路径按兼容策略生效（unsupported/skipped 标注非报错）。
