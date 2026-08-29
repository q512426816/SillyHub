# 跨仓任务 X1-X4（sillyspec CLI 配套）完成回执与工具摩擦记录

- 日期：2026-08-29
- 状态：**部分活跃**——X1/X2/X4 完成回执；X3 渲染侧一行接线为**活跃坑**（待后续变更补上，勿提前移 `finished/`）
- 发现来源：变更 `2026-08-29-change-delete-closure-and-spec-pull` task-13/task-14（跨仓，repo: sillyspec）执行过程
- 关联：平台端配套为主仓 worktree 分支 `sillyspec/2026-08-29-change-delete-closure-and-spec-pull`（task-02/04/08/11）；本文件按 CLAUDE.md 规则 15 记录工具缺陷/改进点

## 一、X1-X4 完成情况回执

sillyspec 仓分支 `sillyspec/2026-08-29-change-delete-closure-and-spec-pull`（基线 f5ce735 = 3.27.11）：

| 项 | 内容 | 落点 | 状态 |
|---|---|---|---|
| X1 墓碑上报 | 删除/归档触发点上行 `changes[].status='deleted'`（对齐既有 `'archived'` 状态语义）；平台 progress POST **写路径**处理（置 location='deleted' + 触发镜像软删收敛，区别于 `'archived'` 的纯 DTO 覆盖） | commit `b86a593`：src/sync.js 载荷 + src/run/shared.js；平台端 task-04（platform_sync/service.py 写路径 + 已删 key 409 code=change_deleted） | 完成 |
| X2 pullSpecBundle | `SyncManager.pullSpecBundle()`：GET `/api/changes/-/spec-bundle`（shpsync token）流式 tar 解压到 specDir；空目录直接解压/非空无 `--force` 拒绝/`--force` 整树覆盖（对齐 daemon 语义）；顶层命令 `sillyspec pull --spec`，帮助文案明示快照语义（无自动同步/会话中刷新） | commit `16c21b0`：src/sync.js + src/index.js；补丁 `fb35dc0`：`--force` 覆盖时**保留 local.yaml 连接凭据**（否则整树 rm 后 CLI 失联）；平台端点 task-08（字面量路由前置注册） | 完成 |
| X3 步骤开始上报 | 步骤启动补推一次 progress（同端点同结构，`stepStart: true` → sync.js `_projectStepStart` 载荷层投影，不写 DB）；真实效果=last_pushed_at 以步骤起点刷新，停滞判定可信 | commit `b86a593`：src/run/shared.js `triggerStepStartSync` 导出（quick 会话降级跳过/未连接静默跳过/8s 熔断/失败只 warn） | **部分完成——渲染侧一行接线留后续（见活跃坑）** |
| X4 任务边界上报 | execute 每完成一个任务（T1..Tn）调一次 triggerSync + Wave prompt 每任务上报指引 | commit `b86a593`：src/stages/execute.js | 完成 |
| 测试 | node:test：`test/platform-tombstone-and-activity-report.test.mjs`（X1 载荷形状/X3 步骤开始即推/X4 每任务一次/既有 --done 路径回归）、`test/pull-spec-bundle.test.mjs`（空目录/非空拒绝/--force 保留 local.yaml/鉴权头/未连接提示不崩） | 两测试文件随上述 commit 落盘 | 完成 |

daemon 零改动兼容（task-10）：主仓 `sillyhub-daemon/tests/test_bundle_metadata_compat.test.ts` 实证 bundle 含 `PLATFORM-BUNDLE.json` 后 pullSpecBundle/spec_version 判定不受影响。

## 二、活跃坑：X3 渲染侧一行接线未落（allowed_paths 粒度）

- 状态：**活跃坑**（待后续变更修复；非 sillyspec 工具 bug，是跨仓任务卡 allowed_paths 机制与实现粒度的摩擦）
- 现象：`triggerStepStartSync` 已导出且自洽（含降级/熔断/静默语义），但真正的调用点——步骤 prompt 渲染处（sillyspec 仓 `src/run/stage.js` outputStep 前段 / `src/run/prompt.js`）——**不在 task-13 的 allowed_paths 内**（`src/run/shared.js`、`src/sync.js`、`src/stages/execute.js`、`test/platform-tombstone-and-activity-report.test.mjs`），导致 X3 上报链路最后一环未接线；X3 实际生效面目前=每次 `--done` 推送 + X4 任务边界，「步骤起点刷新 last_pushed_at」的完整收益要等接线后才兑现。
- 证据：src/run/shared.js `triggerStepStartSync` docstring「接线说明（本变更 allowed_paths 约束）：……渲染侧一行 `triggerStepStartSync(cwd, changeName, platformOpts)` 的接线由后续变更补上」。
- 影响：前端活动徽标三态在长步骤场景仍可能误报「停滞」（R-12 边界未收窄到步骤粒度）；平台侧 Layer 1/2 设计目标部分达成。
- 绕过方式（当前）：无（行为等同现状——仅步骤完成/任务边界有信号，渐进增强语义下无回归）。
- 修复建议：sillyspec 仓后续小变更，在 `src/run/stage.js`（outputStep 前段）/`src/run/prompt.js` 步骤渲染点补一行调用 + 一条断言「步骤开始即有一次 progress POST」；平台端零改动。

## 三、跨仓 taskcard/review/verify 流程体验记录（正面 + 改进点）

### 正面（可复用经验）

1. **跨仓任务卡机制整体可用**：taskcard `repo: sillyspec` + `local.yaml repos:` 注册（plan 阶段加入）后，allowed_paths 相对 sillyspec 仓根书写，review/verify 按「仓根相对路径」对账成立；两仓各自 `baseline checkpoint` commit（主仓 f5656863 / sillyspec db69eaf）把并行在途文件显式归因排除，逐任务 diff 归因清晰。
2. **同文件分波防冲突**：task-13（W4，只动上行载荷构造）与 task-14（W5，只新增 pullSpecBundle）同改 `src/sync.js` 但按 Wave 分开 + 卡内 constraints 显式声明边界，实际零冲突——排波粒度经验值得沿用。
3. **命名留白无坑**：plan 阶段把 CLI 命令命名留「执行时定」，最终 `pull --spec` 与既有 `platform pull`（进度六表下行）语义可区分，未误用。

### 改进点（工具侧，待 sillyspec 上游评估）

1. **allowed_paths 粒度不足以覆盖「一行接线」类需求**（即活跃坑根因）：跨仓任务卡的 allowed_paths 在 plan 阶段定死，execute 发现还需要触碰渲染层一个调用点时只能「导出钩子 + 留活跃坑」。建议：taskcard 支持 execute 中经确认追加 allowed_paths（留审计痕迹），或 plan 阶段对「新导出符号」强制 grep 调用点清单入卡。
2. **跨仓 review 对账的路径口径靠卡内注释自律**：taskcard 注释自带提醒「allowed_paths 禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中」，但没有机械校验，写错要到 review 阶段才暴露。建议 taskcard 生成时对带 `/`、`C:`、仓 key 前缀的 allowed_paths 直接校验拒绝。
3. **head_commit 记录口径不一**：task-13 记 40 位全 hash（b86a5937907e…），task-14 记短 hash（fb35dc0）——同一变更内两种格式，脚本化核对不便。建议 taskcard 校验统一为全 hash。
4. **跨仓 verify 的命令上下文切换**：verify 命令需 `cd C:/Users/qinyi/IdeaProjects/sillyspec` 执行 node:test，而 SillySpec CLI 本身必须留在主仓根跑（规则 22）——执行子代理需显式区分「目标仓命令」与「CLI 命令」的 cwd，目前全靠 constraints 文字约束。建议 verify 命令支持按仓标注执行目录。

## 四、关联遗留（平台端，非本文件处置）

- `POST /changes/-/spec-sync` HTTP 响应未透传 `platform_deleted` 诊断键（service 层 apply_ops 返回已含，端点 DTO 暂不透出）——CLI「被平台删除拒绝」感知接线待后续（平台端裁量，见 scan/CONCERNS 条目①）。
- X1 墓碑依赖 CLI 升级发版后才能覆盖旧版 CLI；平台侧方案 A（镜像驱动收敛）不依赖它，旧 CLI 残留由平台删除入口/重扫描收敛兜底（D-005）。

## 五、处置记录（2026-08-29 收口）

**X3 渲染侧接线已补上（本文件唯一活跃坑解除）**：

- 接线点：sillyspec 仓 `src/run/prompt.js` outputStep 越界守卫后、渲染前段，fire-and-forget 调 `triggerStepStartSync(cwd, changeName, platformOpts)`（不 await，prompt 渲染不被网络阻塞；未连接静默 / quick 降级 / 8s 熔断契约全在钩子内）。
- 配套：`src/run/shared.js` docstring「接线说明」更新为已接线；补 null changeName 静默护栏（渲染层个别路径无变更名时不打 warn）。
- 测试：`test/platform-tombstone-and-activity-report.test.mjs` 新增 X3-4「outputStep 渲染步骤即推一次 progress」（含 in-progress 投影断言），该文件 11 测试全过；受影响面（import prompt/stage/shared/complete/command 的 55 个测试文件）除一个与本接线无关的既有失败（worktree-execute-spec-drift AC-A6，在途 worktree/commit 工作引入，摘除接线复测同样失败）外全过。
- 效果：步骤起点即刷新平台 last_pushed_at，前端活动徽标停滞误报收窄到步骤粒度（R-12 边界达成）。
- 「三、改进点」中 allowed_paths 粒度 / 路径口径机械校验 / head_commit 统一 / verify 按仓标注等仍为上游 backlog 建议，不阻塞本文件归档。
