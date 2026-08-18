---
schema_version: 1
doc_type: module-card
module_id: skill-manager
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 两级 skills 同步管理（skill-manager）

## 定位
daemon 平台 + workspace 两级 skills 同步（`src/skill-manager.ts`）：syncSkills 把
backend 分发的 sillyspec 平台 skills 拉到 `~/.sillyhub/daemon/skills/`（版本比对
+ sha256 校验）；syncWorkspaceSkills 把 workspace specDir 的自定义 skills 拷到
worktree `.claude/skills/workspace/`；linkSkillsToWorkdir 在 spawn 前把平台 skills
接到工作目录让 claude 能加载。所有网络/IO 失败不抛（返回 null/false/skipped），
不阻塞 daemon 启动与 spawn。

## 契约摘要
- `syncSkills(serverUrl, auth: SkillAuth, logger?): Promise<{ synced, skipped }>`——
  拉 `GET /api/daemon/skills/latest/manifest`（SkillsManifest `{ version, sha256?,
  published_at? }`）比对本地 manifest.json 版本；新则下载 bundle（tar.gz）→
  checkSha256 → 临时目录解压 → 清旧提升 → 写本地版本。
- `fetchRemoteManifest / fetchSkillsBundle / checkSha256 / extractSkillsBundle`——
  各步骤独立导出（gunzip 移出事件循环）。
- `syncWorkspaceSkills(workspaceSpecDir, worktreeDir, logger?): Promise<{ synced, skipped }>`——
  源 `{specDir}/skills/` → 目标 `{worktree}/.claude/skills/workspace/`（命名隔离，
  不覆盖平台 skills）；先清空再拷（已删 skill 不残留）。
- `linkSkillsToWorkdir(workdir, logger?): Promise<{ linked, skipped }>`——
  `~/.sillyhub/daemon/skills/` 下每个 skill 目录 → `{workdir}/.claude/skills/<name>`。
- `SkillAuth = { apiKey?, token? }`：apiKey → X-API-Key 优先，否则 token Bearer
  （对齐 hub-client._headers）。
- 依赖 hub-client（parseJsonFromResponse）；被 daemon（启动 syncSkills）与
  task-runner（spawn 前 linkSkillsToWorkdir）使用。

## 关键逻辑
```
syncSkills: manifest 版本一致 → skip；拉 bundle → sha256 校验失败丢弃
  → 解压到 skillsDir/.tmp-extract → 清 skillsDir 旧子目录（保留 manifest.json
    与 .tmp-extract）→ rename 提升 tmp/* → 写 manifest.json {version}
  （tmp 失败不影响现有 skills，零回归）
syncWorkspaceSkills: 源无 skills/ → skipped；否则 rm 重建 workspace/ 目标后
  copyDirBestEffort 递归拷（单文件失败 warn 不中断，返回成功文件数）
linkSkillsToWorkdir: copy 而非 symlink（Windows symlink 需开发者模式）；
  排除 manifest.json / .tmp-extract / 隐藏项；清旧再拷幂等覆盖
```

## 注意事项
- 提升语义是 task-07 修复：旧实现解压到 tmpDir 后从不提升——skills 实际从未
  安装且删除不清理；现在是 tmp 成功才清旧移新。
- linkSkillsToWorkdir 是 2026-07-08 补的接线：claude 只读 `<cwd>/.claude/skills/`
  + `~/.claude/skills/`，不接线则交互式/batch 会话看不到平台 skills。
- skillsDir / localManifestPath 懒计算（运行时读 homedir）——测试改
  HOME/USERPROFILE 即时生效，勿提升为模块级常量。
- workspace skills 与平台 skills 共存靠目录命名隔离（`workspace/` vs 平台 skill
  名），平台 skills 的子集裁剪（skill_refs 过滤）在 task-runner 侧做，不在本模块。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
