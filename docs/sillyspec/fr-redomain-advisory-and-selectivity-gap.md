# flow done 伪域迁移 advisory 未指引专用 redomain 命令 + 域级粒度不支持条目级选择性迁移

> 记录时间：2026-10-13 · 来源变更：2026-10-13-daemon-module-map（独立评审 P3 发现，主会话源码复核确认）
> 状态：活跃坑（已确认绕过方案：手工条目段手术，见下）

## 现象

变更收口触发 `[FR 域路由降级]` 告警时，工具给出的处置指引是：

> 按交付路径建议域迁移（确认后可迁移；补模块卡后新变更自动落回真域）
> 迁移/存量清单：sillyspec knowledge digest（伪域信号卡）

指引没有提到 sillyspec 其实有专用机器迁移通道：`sillyspec tests --redomain --from <域> --to <域>`（src/redomain.js，2026-09-27-redomain）。用户/agent 按 advisory 字面只能走「手工 redomain」，与信号卡「平台信号卡一键/手工 redomain」的措辞也不一致（digest 明示了 redomain 一词，flow done 告警没有）。

## 根因（sillyspec 仓）

- flow done 的告警文案（fr-index.js indexRequirements 尾部）只写「确认后可迁移」，未接 `--redomain` 命令名与用法。
- `--redomain` 实现是**域级**批量手术：`把 fr/<from>.md 的条目段整体切出、拼进 fr/<to>.md`——无条目级/变更级过滤参数。当伪域内混着多个来源变更的条目（如 auto-sillyhub-daemon 剩余 13 条属其它变更）而只想迁某变更的 5 条时，专用命令反而做不到，只能回退手工条目段手术。

## 身份铁律差异（对手工迁移的约束）

redomain.js D-001：**迁域不换号**——条目 ID（FR-<旧域>-NNN）保持原样，绑定行/supersede 链/最近确认锚全靠 ID 寻址（upsertFrBindings 按 `## ${frId}` 全目录扫描）。2026-10-13-daemon-module-map 的手工迁移按目标域接续重编号（034~038→016~020）：本例无旧 id 寻址引用（绑定行锚是变更作用域 `change:flow:FR-NN`，非条目 id），validate/digest 全绿无功能影响；但该处置与 D-001 约定相反，属「碰巧安全」——若被迁条目已有 supersede 链或跨文件 id 引用，重编号会断链。

## 期望修复（sillyspec 仓）

1. flow done 伪域告警文案接上专用命令：`sillyspec tests --redomain --from <域> --to <域>`。
2. `--redomain` 增加条目级过滤（如 `--entries FR-xxx-034,FR-xxx-035` 或 `--source-change <变更名>`），让「只迁某变更的条目」有机器通道。
3. 文档/告警明示 D-001 迁域不换号铁律，防手工迁移按序重编号断 supersede 链。

## 绕过方案（当前可靠）

条目级选择性迁移走手工条目段手术（Read 定位 → 整段搬移 → validate + digest 自检），并保持条目 id 原样不重编号（对齐 D-001）；域级整体迁移直接用 `--redomain`。
