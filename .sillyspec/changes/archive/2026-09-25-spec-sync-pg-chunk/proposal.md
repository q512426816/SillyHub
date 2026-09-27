---
author: flow-machine-draft
created_at: 2026-09-25T05:20:23.141Z
---
# 提案书（Proposal）— 2026-09-25-spec-sync-pg-chunk

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:14ecd0cd8a3cb6ca854f0cfa3d6364ac17632e7fa931f39b0b20de16001df4a1:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-spec-sync-pg-chunk 留痕重锚 -->
任务原话转写：生产热修：spec 树增量同步 apply_ops 的 manifest 批量 upsert 未分片，单批 ops 文件数大（归档移动整树，如 sillyspec 狗粮区单批数千行）时 pg_insert(SpecFileManifest).values([...]) 绑定参数超 asyncpg 32767 上限 → POST /changes/-/spec-sync 500，CLI 反复重试刷屏（生产实测 30 分钟 963KB 错误日志），spec 镜像停更，变更详情按 path 读镜像的文件/文档数据全空。
成功标准：
- pending_adds 批量 upsert 按固定批大小分片执行（批大小使单语句绑定参数远低于 32767，含安全余量），行级 upsert 语义逐字不变（on_conflict_do_update 同款）
- 超大批功能测试：>批大小数倍的 pending adds 全部落库且版本/哈希正确（sqlite 测试库虽无该上限，分片循环的正确性可验）
- 既有 spec_workspace apply_ops 相关测试零回归
- 生产部署后 spec-sync 恢复（CLI 重试成功、镜像更新、变更详情文件/文档数据回填）
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:0e91f8602e3b35f4a386170e2250c7697bf851d8fcba9a966df93a3b19367372:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-spec-sync-pg-chunk 留痕重锚 -->
按成功标准机械推导，共 4 条验收面：
1. pending_adds 批量 upsert 按固定批大小分片执行（批大小使单语句绑定参数远低于 32767，含安全余量），行级 upsert 语义逐字不变（on_conflict_do_update 同款）
2. 超大批功能测试：>批大小数倍的 pending adds 全部落库且版本/哈希正确（sqlite 测试库虽无该上限，分片循环的正确性可验）
3. 既有 spec_workspace apply_ops 相关测试零回归
4. 生产部署后 spec-sync 恢复（CLI 重试成功、镜像更新、变更详情文件/文档数据回填）
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:b850435ac3d807f7086eb07fd67443adad3f91f1a9971913624ea220f3b902bc:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-spec-sync-pg-chunk 留痕重锚 -->
1. pending_adds 批量 upsert 按固定批大小分片执行（批大小使单语句绑定参数远低于 32767，含安全余量），行级 upsert 语义逐字不变（on_conflict_do_update 同款）
2. 超大批功能测试：>批大小数倍的 pending adds 全部落库且版本/哈希正确（sqlite 测试库虽无该上限，分片循环的正确性可验）
3. 既有 spec_workspace apply_ops 相关测试零回归
4. 生产部署后 spec-sync 恢复（CLI 重试成功、镜像更新、变更详情文件/文档数据回填）
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
