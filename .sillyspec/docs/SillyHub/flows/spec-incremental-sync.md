---
author: qinyi
created_at: 2026-08-18 02:50:00
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
---

# Spec 文件增量同步流程（manifest + FileOp）

## 目标
SillySpec CLI / daemon 与平台之间 spec 文件树的服务器权威增量同步：以 manifest 全量清单比对算差异、FileOp 增量上行、base_version 乐观锁做冲突检测，替代旧「整树 tar 全量覆盖无冲突检测」方式。

## 参与模块
- platform_sync：`GET /changes/-/spec-manifest` + `POST /changes/-/spec-sync` 两端点（shpsync_ 鉴权，workspace_id 从 token 派生，服务层不重复校验）；manifest/sync 透调 spec_workspace（共享 session）
- spec_workspace：apply_ops 增量落盘核心（SpecFileManifest 的唯一写者，D-011 单写者语义）、get_manifest（含软删行）、sync-incremental 同源语义、落盘后触发 change reparse
- daemon：spec-sync.ts——本地 manifest 扫描、与服务器清单 diff 算 FileOp ops、hub 404 首推全量、junction 挂载与 pending-push 标记、SpecPushConflict 与 push-before-pull 防护
- change：reparse 对齐 changes/ 索引（scoped / 全量）
- scan_docs：archive 路径触发全量 reparse 时的 docs 树对账

## 流程摘要

```text
(daemon/CLI) 触发：交互会话结束 postSpecSync / CLI 直跑 platform 同步
     │
(1) 拉清单   GET /api/changes/-/spec-manifest（Bearer shpsync_）
     │        返回服务器权威全量行（per-file content_hash + version）
     │        ——含 exists=False 软删行，据此识别服务端已删文件并对齐下发 delete
     ▼
(2) 本地比对 daemon 本地扫描 spec 树 → 与 manifest 逐文件 diff（content hash）
     │        算出 FileOp ops：add / update / delete / rename（每个带 base_version）
     │        hub 404（服务器无清单）→ 首推全量
     ▼
(3) 增量上行 POST /api/changes/-/spec-sync {ops[]}
     │        单事务全成全败
     ▼
(backend)   apply_spec_ops → SpecWorkspaceService.apply_ops：
     ├─ 预校验：全部 op 路径 containment + .runtime 排除
     │    → 越界 422 整体不落盘（不留半落盘状态）
     ├─ local.yaml 写 op 静默丢弃（服务器排除项；delete 放行清存量行）
     ├─ 循环前 IN 预取清单行消 N+1；逐 op：
     │    有行且 version != base_version
     │      → 同 hash 豁免（no-op 对齐，D-008@v2）
     │        否则记 conflict + 收集 server_versions + 跳过该 op
     │    无行 → hash 兜底（add/update=新建 v1；delete=no-op 幂等；rename 按 add）
     ├─ delete = move 到 spec-backups/{ws}/{ts}/{path} + exists=False（30 天机会式修剪）
     └─ 返回 {new_versions, conflict, server_versions}（有冲突 HTTP 仍 200）
     ▼
(4) 落盘后   事务外 best-effort 触发 change reparse：
     │        有 change_dirs 标注 → scoped；含 archive 路径 → 全量；
     │        无标注扫 ops 内 changes/ 前缀兜底；零 changes 路径零触发（R-01 防空转）
     ▼
(daemon)    conflict=true → 据 server_versions 字段提示人工拍板
            （SpecPushConflict / push-before-pull 防护）
```

## 失败回滚

| 失败点 | 处理 |
|--------|------|
| op 路径越界 / 含 .runtime | 422 整体不落盘，manifest version 不前移 |
| base_version 过期且 hash 不同 | 该 op 跳过不落盘，返回 conflict=True + server_versions，daemon 侧人工拍板 |
| 同文件同 hash 重复推 | no-op 豁免，不误报冲突（旧 daemon 不传 hash 则仍按冲突） |
| 服务器文件已删 | manifest 含 exists=False 行 → daemon 下发 delete 对齐 |
| local.yaml 被推 | 写 op 静默丢弃，不进 new_versions / 不置 conflict，幂等重推无副作用 |
| 落盘事务失败 | 单事务全成全败，无半落盘状态 |
| token 无效/缺失 | 401（写通道仅接受 shpsync_；凭据有效但走错通道 403） |
| ops 漏 change_dirs 标注 | 兜底扫 ops 内 changes/ 前缀触发 reparse |
| daemon manifest 缓存过旧 | 推不出新 change（已知运维坑）→ sync-manual / 从仓库导入 RPC 通道兜底 |
