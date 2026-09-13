# docs gate 在共享工作区多会话并编辑时拦住无关推送（活跃坑）

- **日期**：2026-09-08（ql-20260908-012 推送时实测）
- **现象**：pre-push 钩子 `sillyspec docs gate` 对**整个工作区当前状态**做引用校验，而不是对「本次要推送的提交内容」。并行会话正在编辑（未提交）backend/daemon 源码时行号临时漂移，活文档锚点（architecture-4a.md / INTEGRATIONS.md 共 7 处）瞬时失效——任何会话此时推送都会被拦，即使它推的提交与漂移毫无关系（本次推的是纯 docs/qa 豁免提交）。失败数在两次运行间 5→7 波动，证实在途编辑是移动靶。
- **影响**：多 agent 共享同一工作区是本仓常态（SillySpec 任务隔离设计），该门槛会把「别人的半成品」变成「所有人的推送锁」，直到在途会话落定并修锚。
- **绕过（当下）**：等在途会话提交/修锚后再推；或由用户确认后 `--init-baseline`（不推荐，会把瞬时债固化）。**不应该**由旁观会话去修移动靶上的锚（会撞车且修完即过期），也不该 stash 他人在途文件。
- **建议工具修复方向**（任一即可）：
  1. gate/pre-push 只校验「被推送提交实际改动的文件所关联的文档引用」（push range diff 驱动），或
  2. 校验基线取 `HEAD`（git show）而非工作区文件内容，或
  3. gate 支持 `--against HEAD` 模式，pre-push 默认用之。
- **关联**：ql-20260908-011/012（snapshot 豁免是文档侧减敏，本坑是门槛侧机制问题，两者互补）。

## 巡检注记（2026-09-09 定时扫描）

- 定性：**门禁语义设计变更**（三选一：push range diff 驱动 / 校验基线取 git show HEAD / `--against HEAD` 模式 + pre-push 默认）——涉及 docs-check 读文件层重构与 pre-push 行为契约，属专项变更而非巡检级小修，本轮不代位实现。
- 关联减敏已落地：docs-fix-capability 变更（2026-09-08）的 snapshot/archive 豁免双通道减少了活文档锚点面；本坑是门槛侧机制问题的剩余半边。保持活跃待专项认领。

## 处置记录（2026-09-12 定时收口，方案③落地，归档）

- **已实现 `docs gate/check --against <ref>` 模式**（本坑建议③：gate 支持 --against HEAD，pre-push 默认用之）：`docs-check.js` 新增 HEAD 内容解析层——干净文件磁盘直读（与 HEAD 逐字节一致零开销）、脏文件（M/D/R）`git show` 取提交树内容、未跟踪视为不存在（文档静默跳过、源文件不作候选——皆「不随推送走」语义）；非 git 仓/子目录自动回退磁盘模式并附 warning。reader 经模块级 set/restore 激活，未激活时全部读取点字节等价（既有行为零变化）。
- **接线**：sillyspec 仓 `.husky/pre-push` 的 gate 命令已加 `--against HEAD`（本仓即时生效——hook 走 bin/sillyspec.js 本地代码）；CLI 层 `--fix/--dry-run` 与 `--against` 互斥（fix 恒操作工作区）。
- **本仓实测（2026-09-12，移动靶现场）**：工作区模式 31 失效拦截（并行在途编辑漂移中）vs `--against HEAD` **0 失效放行**——「推的是提交不是工作区」语义落地，别人的半成品不再变成所有人的推送锁。
- **测试**：新增 `test/docs-check-against-head.test.mjs` 5 用例（源码漂移隔离/未跟踪文档跳过/未跟踪源文件不作候选/非 git 回退/干净树两模式一致）5/5 绿；docs-check 消费面回归 20/20（doc-ref-check 与 check-syntax 的失败为并行在途漂移/他人在途新文件，与本次改动无关——reader 未激活时字节等价）。
- **遗留（部署节奏）**：其他仓的 `.git/hooks/pre-push`（调全局安装的 sillyspec，如本平台仓）须等 sillyspec npm 发版含本特性后再加 flag（旧版 CLI 未知 flag 会 exit 2 反而挡推送）——发版后逐仓更新一行。
