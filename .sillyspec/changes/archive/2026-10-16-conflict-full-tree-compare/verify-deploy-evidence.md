# 部署真机复验证据（task-06 / D-008@v1）

- 复验时间：2026-10-17 00:03 ~ 00:12（北京时间）
- 复验人：zcode-agent（主会话，经运维通道签发 15min 管理员 token 执行 API 实测；凭据未落盘未回显）
- 部署版本：main `994656fdd`（本地打包 → 腾讯云生产 124.222.127.242，发布记录 009）
- 结论速览：**4 组证据中 3 组达成；「兜底对比 200」未达成**——机器侧冲突记录缺失（本变更编码的兜底行为已按设计工作，200 场景需机器侧再生记录后补验，见 ②）。

## ① 部署 commit_sha 核对 ✓

- 23:09 部署完成即验 + 00:03 复验：`GET /api/health`（容器内 127.0.0.1:8001 与公网 https://crrcdt.ppdmq.top 双路）
  → `{"status":"ok","db":"ok","redis":"ok","commit_sha":"994656fdd",...}`，与 build-and-save.sh 打包源一致（无互覆）。
- 5 容器 healthy；`SPEC_MIRROR_WRITE_OK` 探针过；alembic 干净落地（本次部署含的另一个变更 fix-auth-random-logout 的迁移）。

## ② 兜底对比（record_label=full-tree 200 场景）✗ 环境前提缺失

探针链（全部经生产 API 实测）：

| 时间 | 探针 | 结果 |
|---|---|---|
| 00:03 | `GET .../machines/16fef8b5…/sillyspec-conflicts/2026-10-13-fire-unitadd-form-import/compare?kind=spec-tree&workspace_id=4e9eb05b…` | 502 `HTTP_502_DAEMON_RPC_REMOTE`，`daemon_code=conflict_record_missing`，`daemon_message=冲突记录不存在：spec-sync-conflict-2026-10-13-fire-unitadd-form-import.json` |
| 00:05 | 同端点，记录名直探 `full-tree` | 502 同码，`daemon_message=冲突记录不存在：spec-sync-conflict-full-tree.json` |
| 00:08 | 绑定机定向同步：`GET .../changes/58fb5588…/files?sync=true`（181144 的绑定机即目标机） | `sync_result={"triggered":true,"ok":true}`——**定向同步成功且不触发树级冲突**，未再生记录 |
| 00:08+8s | full-tree 记录复查 | 仍缺失 |

判定：

- 机器（centos8，daemon 0.1.1 / sillyspec 3.33.0，online）`.sillyspec/.runtime/` 下**两个记录名都不存在**，与坑文档 16:4x 实测（`pending_conflicts: []`、`conflict_count: 0`）一致——记录缺失是机器侧事实，不是平台侧读取问题。
- 部署版兜底逻辑按设计工作：主取 `conflict_record_missing` → 重取 `full-tree` → 仍缺失 → 原错误上抛（`sillyspec_compare.py _fetch_snapshot`，与单测一致）。**502+新文案正是「记录缺失」态的设计输出**。
- 200 场景的再生成前提：树冲突记录只在**机器侧会话结束 / 扫描收尾的树级推送**冲突时落盘（`syncSpecTreeIfNeeded` 两个调用点）；平台侧无（也不应有）再生通道。
- 补验路径：冲突 7 路径中 6 条 archive 路径 server 版本未动（design 3/proposal 2/requirements 3/tasks 5 + relayout 2/2，00:10 清单实查）→ 机器下次树推送**必再冲突** → 新 open 行生成、`spec-sync-conflict-full-tree.json` 重新落盘 → 对本行 compare 应 200（record_label=full-tree、files=该变更 4 archive 路径、covered_changes 含两变更名）。**task-06 勾选状态留待该补验。**

## ③ 失败卡文案分支（conflict_record_missing 四臂）✓

- 真实生产响应（00:03/00:05 两次）：`message=该冲突在本机已无快照（可能已随同步清理或已裁决），请重新同步后再试。`——即 task-01 的「重新同步」口径新文案，替换旧误导文案（「冲突记录已失效，请刷新冲突列表」/页面级「机器可能离线或对比读取超时（504）」）。
- 前端分支渲染由该变更自带用例钉住（00:10 本地实测）：`conflict-compare-modal.test.tsx` + `platform-sync-section.test.tsx` **44/44 绿**（含 conflict_record_missing 无「重试」+服务端消息小字、504 保留重试、兜底命中来源提示条等分支）。

## ④ 行级关闭入口 ✓（两通道都实测）

- 00:03 before：`GET .../spec-conflicts?status=open` → `[('971af5b3-240d-409f-b0c3-af3f14c11b7b','spec-sync','open')]`（行在）。
- 00:08 定向同步全绿后（~00:12 复查）行已被**产品自动关行通道**置 resolved（「下一次推送全绿」语义，坑文档根因①的实测复现——注意：定向 per-change 同步的全绿同样会关工作区 open 行）。
- 00:12 `POST .../spec-conflicts/971af5b3…/resolve`（body `{"status":"resolved",...}`）→ 200，行 `status=resolved`（对已关行幂等）；open 列表 0 行；全量列表该行 resolved。端点鉴权（WORKSPACE_WRITE，workspace_owner 角色）走通。
- 附注：底层树冲突仍活（6 archive 路径 server 版本未动），机器下次树推送会再生新行——预期内，不是回归。

## 遗留（转坑文档）

- 「请重新同步后再试」文案对这类跨变更树冲突**不可完全行动**：产品内「刷新」触发的定向同步不会再生树记录（实测 ok:true 且记录仍缺失）。可行动路径只有坑文档处置 1（机器侧会话/扫描触发的树推送）与处置 2（平台裁决，UI 已由 task-04 落地行级按钮）。
- 结构性根因（记录名 vs 平台行名的口径、行开记录亡的生命周期断层）未修——见 `docs/sillyspec/conflict-compare-full-tree-label-mismatch.md` 状态更新。
