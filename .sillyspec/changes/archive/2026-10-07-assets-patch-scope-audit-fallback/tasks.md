---
author: flow-machine-draft
created_at: 2026-10-07T14:58:35.066Z
---
# 任务注册表（Tasks）— 2026-10-07-assets-patch-scope-audit-fallback

- [x] task-01: 归档目录无 change-patch.json 但有 scope-audit.json 时，归档留档 patch 块出数：files/additions/deletions 取 totals，file_list 取 rows[].path，patch_status/saved_at 取快照同名字段
- [x] task-02: 该形态下点文件看 diff 从 scope-audit.patch 切片（复用既有切片函数），弹窗可看
- [x] task-03: 两份留档都缺失时 patch 仍为 None 且 diff 端点 note 说明缺两份留档（fail-open 语义保留）
- [x] task-04: change-patch.json 存在时行为与现状完全一致（thin 形态回归不破）
- [x] task-05: assets 模块聚焦测试通过
