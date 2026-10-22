# 视觉对照证据 — 2026-10-22-file-changes-card-fix

原型形态：**真码页面** `/proto/session-file-changes`（`frontend/src/app/proto/session-file-changes/page.tsx`，Next dev 路由，桩数据），非手绘稿。
复跑方式：`cd frontend && pnpm dev` → `pnpm exec playwright test e2e/proto-file-card.spec.ts`（1400×900，零 console/page error）。

## 对照

| 项 | 基线（2026-10-21 原型截图） | 本次（2026-10-22） |
|---|---|---|
| 折叠头文案 | 「已编辑 8 个文件」 | 「8 个文件变更」（快照是工作区口径，不宣称全部由本轮编辑产生） |
| 文件状态 | 无状态徽标，A/M/D/? 不可区分 | 每行状态徽标：新增 / 修改 / 删除 / 新文件 |
| 未跟踪新文件 | 与普通行一样显示 `+0 −0` | 徽标「新文件」+ 行级统计破折号 |
| 删除文件 | 与普通行一样可点击打开 | 路径删除线、`data-clickable="false"` 不可点击 |
| 无文件清单的 partial | 「工作区快照未完成（超时或队列溢出）」 | 「工作区快照采集超时（1.5s），本轮改动未知」+ 共享工作区提示 |
| 「改N次」 | 工具种数（同工具多次只算 1） | 真实编辑调用次数 |

- 基线截图：`.sillyspec/changes/archive/2026-10-20-session-page-dsh-alignment/proto-file-card-2026-10-21.png`
- 本次截图：`proto-file-card-2026-10-22.png`（折叠/展开/截断/notice 四态同页）、`proto-file-card-100files-2026-10-22.png`（100 文件限高内滚）

## 自动化断言（Playwright，1 passed）

- 折叠头 28px、展开后文件行 24px、命令行徽标恰 1 次；
- 状态徽标「新增/删除/新文件」各 1 次；未跟踪行显示破折号；
- notice 卡可见且文案含 `1.5s` 与「共享工作区」；
- 点击可打开行触发 `onOpenFile`，删除行不触发；
- 100 文件列表 `clientHeight ≤ 240`、可滚到底且头部不滚出；
- console error / pageerror 均为 0。

## 评审修复轮（P1/P2/P3）

- P1：`session-manager` 工具路径累加不再按 `toolName+path` 去重——同一文件 Edit 3 次在采集器收到 3 条（新增接线测试断言重复项保留）。
- P2：status/name-status/numstat 子进程自身 timeout 也调用 `noteCollectTimeout` 升级该工作区预算（新增子进程 timeout 升级测试）。
- e2e 补「未跟踪行破折号」「删除行点击不触发 onOpenFile」断言——上表自动化断言全部由 Playwright 覆盖。
- 文档/源码注释/design 文件清单按评审指出的漂移同步；复跑：daemon 43 passed、frontend 62 passed、e2e 1 passed、双端 tsc 零错。

## 视觉降级裁决

无视觉降级：所有新增状态均为既有卡片内的文本/徽标增量，未改布局、未缩范围。无需用户裁决。
