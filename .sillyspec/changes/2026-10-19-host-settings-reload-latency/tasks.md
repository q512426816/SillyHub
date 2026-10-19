---
author: agent
created_at: 2026-10-19T02:34:00.000Z
---
# 任务注册表（Tasks）— 2026-10-19-host-settings-reload-latency

- [x] task-01: 轮询默认节拍 3000→1000（单一源导出常量 HOST_SETTINGS_POLL_INTERVAL_MS，注入覆盖口径不变），两拍去抖/指纹/容错/关闭阀/筛选零回退；新增默认节拍断言用例，watcher 9 例 + HOST-1~6 全绿
- [x] task-02: deploy 技能文档 HEAD→GET 口径修正（.zcode/skills/sillyhub-docker-deploy/SKILL.md 两处），判定语义保留（200 + application/javascript）
- [x] task-03: 相关 daemon 测试绿 + tsc 零错；部署后真机端到端延迟实测 ≤4s 留痕（发布记录）
