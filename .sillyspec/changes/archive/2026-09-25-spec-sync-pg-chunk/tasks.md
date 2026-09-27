---
author: flow-machine-draft
created_at: 2026-09-25T05:20:23.143Z
---
# 任务注册表（Tasks）— 2026-09-25-spec-sync-pg-chunk

> 机器稿（成功标准机械推导）；轻量跑直写=零任务卡（任务即 checkbox 行）；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。

<!-- MACHINE-DRAFT:tasks-rows:6596d6f3749cc5934185e37a530baa962812b7f135b9c0d42c5bb3a91af312c6:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-spec-sync-pg-chunk 留痕重锚 -->
- [ ] task-01: pending_adds 批量 upsert 按固定批大小分片执行（批大小使单语句绑定参数远低于 32767，含安全余量
- [ ] task-02: 超大批功能测试：>批大小数倍的 pending adds 全部落库且版本/哈希正确（sqlite 测试库虽无该上限，分片
- [ ] task-03: 既有 spec_workspace apply_ops 相关测试零回归
- [ ] task-04: 生产部署后 spec-sync 恢复（CLI 重试成功、镜像更新、变更详情文件/文档数据回填）
<!-- MACHINE-DRAFT:tasks-rows:end -->

