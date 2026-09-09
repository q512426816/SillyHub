---
author: qinyi
created_at: 2026-09-09 22:50:18
---
# 任务清单（Tasks）

> 任务注册表唯一真相；Wave 分组见 plan.md（纯 ID 引用行）。

- [x] task-01: pi extension_ui_request 提问类桥接——归一化 questions[] 包装 + requestUserDialog 上抛 + 挂起表 (depends_on: task-02)
- [x] task-02: driver-factory sessionPermission 注入 pi 分支 + PiStartOptions 槽位
- [x] task-03: pi 答案 denormalize 回流（对照 rpc.md L1130-1217，编码期确认可达性）+ 会话中止/close 兜底 cancelled + 权限类拒绝路径保持 (depends_on: task-01)
- [x] task-04: daemon 单测——pi 桥接四态（上抛/应答/中止/权限类拒绝） (depends_on: task-01, task-03)
- [x] task-05: cursor spike——真机 10 次澄清场景遵守率判定（≥8/10 门槛，go/no-go）
- [x] task-06: 前端 askuser-marker 解析器（宽容边界清单）+ 单测
- [x] task-07: AskUserMarkerCard + turn-timeline 渲染接入 + 已答态 best-effort 判定 + 单测 (depends_on: task-06)
- [ ] task-08: daemon marker prompt 注入（caps 分派）+ 单测 (depends_on: task-05, task-12)
- [x] task-09: backend 影子会话答题授权放开（授权门 :949 + manual_approval 第二道守卫 L959-963 影子分支豁免 ask_user 类；session_kind='group_member' + 群成员校验）+ answered_by 实际答题人 + 越权反例测试
- [x] task-10: AskUserDialogCard 群聊推荐条 + 已答关闭态实际答题人 + 单测 (depends_on: task-09)
- [x] task-11: 群聊聚合渲染（pending 原生卡 + marker 卡 + 先到先得关闭态 + 成员来源标注）+ 单测 (depends_on: task-07, task-09, task-10)
- [x] task-12: caps 三端 dialog 键 + 对齐测试解析器扩展 string 枚举 + pi permission_dialog 翻真
- [ ] task-13: 三波真机冒烟验收（pi 一问一答同轮 / cursor 标记全流程 / 群聊聚合答题） (depends_on: task-04, task-07, task-08, task-11)
