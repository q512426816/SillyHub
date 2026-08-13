---
id: task-07
title: spec-sync.ts postSpecSync 内部改增量 diff + 本地清单缓存移出 specDir + 回退旧 tar
title_zh: daemon 增量 diff 推送客户端
author: qinyi
created_at: 2026-08-13 15:23:34
priority: P0
depends_on: [task-06]
blocks: []
requirement_ids: [FR-01, FR-02, FR-05, FR-06, FR-07]
decision_ids: [D-001@v1, D-004@v1, D-005@v1, D-006@v1]
allowed_paths:
  - sillyhub-daemon/src/spec-sync.ts
provides:
  - contract: incremental_diff_push
    fields: [local hash diff, ops, base_version, rename detection, old tar fallback, first sync full]
    desc: daemon 增量 diff 推送 + 首同步/回退旧 tar
  - contract: local_manifest_cache
    fields: [~/.sillyhub/daemon/manifests, hash, version, mtime]
    desc: 本地清单缓存移出 specDir
expects_from:
  task-06:
    - contract: postSpecSyncIncremental
      needs: [ops, new_versions, conflict, server_versions]
goal: >
  daemon 推送从整树 tar 改文件级增量 diff（本地 hash 与清单比对只发变化 op），首同步/回退仍走旧 tar。
implementation:
  - postSpecSync 先读本地清单缓存 ~/.sillyhub/daemon/manifests/{ws}.json（os.homedir() 下移出 specDir，BL-4/R-03）；缓存格式为 version + files 映射（每路径含 hash/version/mtime，mtime 未变跳过重算 R-05）；首同步（无缓存）走旧 tar client.postSpecSync + packSpecDir，成功后写缓存全量快照
  - 增量路径 walk specDir 逐文件 hash 与缓存比对 diff，新文件 add、内容变 update、缓存有本地无 delete、同 hash 异路径 rename（不重传内容，R-02 注意 Windows 大小写）；.runtime（有点）/runtime（无点）/worktrees 跳过（D-006）；op 带 per-file base_version（取缓存 version，无缓存 0）
  - client.postSpecSyncIncremental 成功按 new_versions 回写缓存 version；conflict=True 抛 SpecPushConflict，由 syncSpecTreeIfNeeded catch 后 warn 不阻塞人工拍板（NFR-02）；增量 404/失败回退旧 tar；缓存写失败 try/catch warn 不阻塞
acceptance:
  - 首同步走旧 tar 且写缓存；之后增量 diff 仅变化 op
  - 缓存位于 ~/.sillyhub/daemon/manifests/{ws}.json（不在 specDir 内）；增量 404/失败回退旧 tar
  - conflict 抛错不静默；rename 检测（同 hash 异路径）+ .runtime 排除
verify:
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
constraints:
  - 不改 pull 侧（NG-04）；packSpecDir 保留（首同步/回退用）；rename 兼容 Windows 大小写（R-02）
  - 现有测试 spec-transport-tar-sync 与 task-09-spec-pull-push 锁定 postSpecSync 契约，由 task-08 独立测试 task 更新断言，本 task 不改测试文件
---
