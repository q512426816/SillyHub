---
author: flow-machine-draft
created_at: 2026-10-21T04:01:29.175Z
---
# 提案书（Proposal）— 2026-10-21-archive-patch-repair

## 动机

任务原话转写：重建刷新按钮变更归档冻结件

动机：2026-10-21-files-refresh-spinner 归档时共享暂存区竞态致冻结件错位——change.patch 装入他侧文档 hunk、scopeAudit 误判源码文件 untouched（评审 P3-1 留痕），平台归档卡面与未来 FR 归属持续被误导。

成功标准：
- change.patch 内容等于 git diff c71b875a1..e88ffddb7 两源码文件
- change-patch.json files/totals/scopeAudit.rows 与 git 实况一致，verdict 不确定处注记兜底
- patchSha256 与新 patch 字节哈希一致且原错误锚值保留于 repair 注记字段
- patch-file 切片实跑返回两源码文件 diff，平台投影重新同步

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. change.patch 内容等于 git diff c71b875a1..e88ffddb7 两源码文件
2. change-patch.json files/totals/scopeAudit.rows 与 git 实况一致，verdict 不确定处注记兜底
3. patchSha256 与新 patch 字节哈希一致且原错误锚值保留于 repair 注记字段
4. patch-file 切片实跑返回两源码文件 diff，平台投影重新同步

## 成功标准（可验证）

1. change.patch 内容等于 git diff c71b875a1..e88ffddb7 两源码文件
2. change-patch.json files/totals/scopeAudit.rows 与 git 实况一致，verdict 不确定处注记兜底
3. patchSha256 与新 patch 字节哈希一致且原错误锚值保留于 repair 注记字段
4. patch-file 切片实跑返回两源码文件 diff，平台投影重新同步
