---
author: flow-machine-draft
created_at: 2026-09-26T23:28:32.581Z
---
# 提案书（Proposal）— 2026-09-27-audit-followup-hardening

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:8c0e35865df57ff79864e4e70d855b7e39a52675b874d934e5abcec2f7163180:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-audit-followup-hardening 留痕重锚 -->
任务原话转写：24h 只读审查的低置信收尾四项：①资产卡模块触达 doc 路径未归一化——_read_touched_modules 对模块图 doc 值直接拼路径读盘，含 .. 或绝对路径可越出 docs/<project> 读宿主文件（仅 h1 行回显，低 severity 但应守）；②docker-compose frontend 运行时 NEXT_PUBLIC_COMMIT_SHA 空覆盖残行——backend 同型行已删（空串覆盖镜像 ENV 回退 unknown），frontend 漏删同型埋雷；③gen-api-types 守卫错误提示 \n 为字面两字符非换行（显示 bug）；④迁移 234000 docstring 缺「卡在被删修订号 063000/3931ff71bd32 的库须先 stamp 20260926083000 再 upgrade」运维注记。

成功标准：
- _read_touched_modules 对含 .. 段或绝对路径的 doc 值不读盘：模块名回退 id、doc 字段不外发越界路径（不放 chip），正常相对 doc 行为零回归
- docker-compose frontend 运行时 NEXT_PUBLIC_COMMIT_SHA 覆盖行删除并留同 backend 口径的注释说明
- gen-api-types 守卫提示的换行为真实换行（多文件列表逐行显示）
- 234000 迁移 docstring 补 stranded revision 人工 stamp 运维注记
- test_assets 新增越界 doc 用例（../ 与绝对路径两形态）绿，既有聚焦测试绿
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:2163d50219470fc74065213764ca6653c201951fa337a27a751a3210c539673f:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-audit-followup-hardening 留痕重锚 -->
按成功标准机械推导，共 6 条验收面：
1. _read_touched_modules 对含 .. 段或绝对路径的 doc 值不读盘：模块名回退 id、doc 字段不外发越界路径（不放 chip），正常相对 doc 行为零回归
2. docker-compose frontend 运行时 NEXT_PUBLIC_COMMIT_SHA 覆盖行删除并留同 backend 口径的注释说明
3. gen-api-types 守卫提示的换行为真实换行（多文件列表逐行显示）
4. 234000 迁移 docstring 补 stranded revision 人工 stamp 运维注记
5. test_assets 新增越界 doc 用例（..
6. 与绝对路径两形态）绿，既有聚焦测试绿
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:cf46402a2b07efc2496b33dd6977f80711aa86e2d17f92dd66d15e24a68d13f5:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-audit-followup-hardening 留痕重锚 -->
1. _read_touched_modules 对含 .. 段或绝对路径的 doc 值不读盘：模块名回退 id、doc 字段不外发越界路径（不放 chip），正常相对 doc 行为零回归
2. docker-compose frontend 运行时 NEXT_PUBLIC_COMMIT_SHA 覆盖行删除并留同 backend 口径的注释说明
3. gen-api-types 守卫提示的换行为真实换行（多文件列表逐行显示）
4. 234000 迁移 docstring 补 stranded revision 人工 stamp 运维注记
5. test_assets 新增越界 doc 用例（..
6. 与绝对路径两形态）绿，既有聚焦测试绿
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
