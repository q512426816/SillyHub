---
author: flow-machine-draft
created_at: 2026-10-07T14:58:35.065Z
---
# 提案书（Proposal）— 2026-10-07-assets-patch-scope-audit-fallback

## 动机

任务原话转写：厚流程归档只有 scope-audit.json/patch 没有 change-patch.json，沉淀资产·归档留档 patch 块整块不渲染（assets._read_patch_meta 只认 change-patch.json）；缺陷记录见 docs/sillyspec/thin-flow-done-no-scope-audit-snapshot.md 镜像缺口一节，本次落地平台读侧回退。

成功标准：
- 归档目录无 change-patch.json 但有 scope-audit.json 时，归档留档 patch 块出数：files/additions/deletions 取 totals，file_list 取 rows[].path，patch_status/saved_at 取快照同名字段
- 该形态下点文件看 diff 从 scope-audit.patch 切片（复用既有切片函数），弹窗可看
- 两份留档都缺失时 patch 仍为 None 且 diff 端点 note 说明缺两份留档（fail-open 语义保留）
- change-patch.json 存在时行为与现状完全一致（thin 形态回归不破）
- assets 模块聚焦测试通过

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. 归档目录无 change-patch.json 但有 scope-audit.json 时，归档留档 patch 块出数：files/additions/deletions 取 totals，file_list 取 rows[].path，patch_status/saved_at 取快照同名字段
2. 该形态下点文件看 diff 从 scope-audit.patch 切片（复用既有切片函数），弹窗可看
3. 两份留档都缺失时 patch 仍为 None 且 diff 端点 note 说明缺两份留档（fail-open 语义保留）
4. change-patch.json 存在时行为与现状完全一致（thin 形态回归不破）
5. assets 模块聚焦测试通过

## 成功标准（可验证）

1. 归档目录无 change-patch.json 但有 scope-audit.json 时，归档留档 patch 块出数：files/additions/deletions 取 totals，file_list 取 rows[].path，patch_status/saved_at 取快照同名字段
2. 该形态下点文件看 diff 从 scope-audit.patch 切片（复用既有切片函数），弹窗可看
3. 两份留档都缺失时 patch 仍为 None 且 diff 端点 note 说明缺两份留档（fail-open 语义保留）
4. change-patch.json 存在时行为与现状完全一致（thin 形态回归不破）
5. assets 模块聚焦测试通过
