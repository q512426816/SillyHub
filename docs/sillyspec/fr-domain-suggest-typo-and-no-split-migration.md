# fr 域路由两缺陷：建议域拼写漂移（rontend）+ unmapped 无分批迁移能力

登记：2026-09-28（会话实测，活跃坑，待工具修复）

## 缺陷 1：flow done 域路由建议产出拼写错域

**现象**：`2026-09-28-knowledge-gov-ux-detail` 变更 flow done 归档时，11 条 FR 被索引进
`fr/auto-rontend.md`（frontend 拼成 rontend）。归档输出原文：「按交付路径建议域：rontend」。

**影响**：新伪域凭空出生（auto-rontend），知识页治理卡显示「暂无推荐去向」——用户侧看
就是「为什么有一组东西不能处理」。已手工补救：`sillyspec tests --redomain --from
auto-rontend --to frontend --write`（2026-09-28，11 条归位、空壳删除、INDEX 路由行已补）。

**疑似根因**：建议域从交付路径前缀截取（`frontend/src/...` → 去掉首个字符或截断
`front`？），具体在 suggestDomainFromFiles 的路径→域映射。建议修复：产出建议域后对其
做「既有域文件名/常见目录名词典」校验，未命中且与既有域差一个编辑距离时拒用并回退
保守域。

## 缺陷 2：redomain 只支持整域迁移，unmapped 混合池无法分流

**现象**：`sillyspec tests --redomain --from <X> --to <Y> --write` 以域文件为单位整体
搬运。unmapped 池 699 条来自 ~4 个月、上百个变更（后端/前端/daemon 主题混杂），任何
单一目标域都会错置大部分条目——治理卡只能标注「放着无害」。

**期望**：支持按来源变更（条目自带「变更：<name>」字段）分批迁移，如
`--from unmapped --by-change <name> --to <domain>`，或提供「按建议域逐条路由」的
dry-run 清单输出供 AI/人工批量执行。

**当前绕过**：三选一——AI 会话按变更分组手工搬段（重）；local.yaml 设
`fr_unmapped_baseline: 699` 消音（快，治标）；保持现状（unmapped.md 零命中不污染注入，
真正的源记录在 changes/archive/ 里不受影响）。
