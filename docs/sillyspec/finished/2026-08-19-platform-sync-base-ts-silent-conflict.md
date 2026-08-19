# platform sync base_ts 字典序冲突静默卡死（同步死亡不报错）

- **发现日期**: 2026-08-19
- **影响变更**: 2026-08-18-workspace-role-type（平台永远停在"执行中"）、2026-08-18-workspace-file-browser（自竞态变体）
- **状态**: 已修复（2026-08-19 sillyspec 仓 b557253 冲突醒目横幅/pull 自竞态重读防御/推送回填+X-SillySpec-User 兜底 + 9edbf2d resolve keep-local 单调防回退；下方 4 条改进建议全覆盖，测试 platform-sync-silent-death 215 行守护）

## 现象

本地 CLI 进度已推进（role-type 实际已 verify 完成 + 归档），但平台变更详情页永远显示旧阶段（"执行中"）。期间本地多次触发同步无任何报错，看似一切正常。

## 根因

§4.2 base_ts 字典序冲突检测存在两个缺陷叠加：

1. **推送成功后本地 base_ts 不回填**：15:40:19 的推送（镜像里 `changes[0].last_local_modified_ts=15:40:19.096`，恰等于 execute 阶段 `started_at`，即"execute 开始"的阶段迁移推送）在平台侧成功写入（`last_pushed_at` 更新），但本地 sqlite 的 `last_synced_platform_ts` / `platform_last_sync` 停留在上一次的 15:40:01。此后本地每次 sync 携带的 base_ts(15:40:01) < 平台 `last_pushed_at`(15:40:19)，必判"平台有更新"→ 拒绝推送——同步从此静默死亡，且再也无法自愈。
2. **冲突时静默落盘不提示**：冲突只写 `.sillyspec/.runtime/sync-conflict-<change>.json`，CLI 输出无任何警告，Agent/用户无从察觉。

### role-type 时间线（UTC）

| 时间 | 事件 |
|---|---|
| 15:39:53 | 平台 changes 表落库（brainstorm/draft） |
| 15:40:01 | 推送#1 成功，本地回填 base_ts=15:40:01.060 |
| 15:40:19 | 推送#2（execute 开始迁移）平台侧成功、last_pushed_at=15:40:19.127（last_pusher 为空），**本地 base_ts 未回填** |
| 18:05:48 | 本地 verify 完成触发 sync → base_ts(15:40:01) < last_pushed_at(15:40:19) → 判冲突，落 sync-conflict 文件 |
| 此后 | 全部 sync 被拒（含 00:39 归档），平台永远停在"执行中"快照 |

file-browser 变更同形实证：base_ts=07:24:58 在自己 07:32:12.432 的推送后未回填，120ms 后即被判冲突落文件——同根因，仅暴露时序不同（推送后立刻自撞 vs 下次 sync 才撞）。

## 指纹（怎么快速识别）

- `.sillyspec/.runtime/sync-conflict-<change>.json` 存在；
- 本地 sqlite `changes` 表 `platform_last_sync` 远小于 `last_local_modified_ts`。

## 恢复办法

```bash
npx sillyspec platform resolve <change-name> --keep-local
npx sillyspec platform sync --change <change-name>
```

## 改进建议（给 sillyspec 仓）

1. **每次推送成功后必须把平台返回/回读的 ts 原子写回本地 base_ts**（`last_synced_platform_ts` + `platform_last_sync` 同步更新）——这是根因，15:40:19 那次迁移推送漏回填直接判了这个变更同步死刑；
2. 冲突发生时 CLI 必须显式输出警告（醒目横幅/非零语义），不能只静默落文件；
3. 自竞态窗口：push 后回读的 ts 若等于自己刚写的推送时间，不应判为"平台有更新"；
4. last_pusher 字段为空值得排查（推送链路没记录写入者身份）。
