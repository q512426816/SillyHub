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

## 处置记录（2026-09-29）

**缺陷 1（建议域拼写漂移）已修**（sillyspec 仓工作树，未提交）——按坑建议的「词典校验」
方向落地，且把守卫同时接到**建议器与伪域路由两处**（生产事故里两者都产出了 rontend，
只修建议器不闭合）：

- 新增 `snapDomainToDictionary`（knowledge-digest.js 单源导出）：候选域与既有域全集
  （fr/*.md 文件名 = 真域+伪域）编辑距离 ≤1 → 判拼写漂移吸附既有域；典内/远距离
  （绿地新模块照旧铸造 auto-）/无词典 → 不干预。
- `suggestDomainFromFiles` 产出过守卫（fr-index 归档告警调用点传 knowledgeRoot）；
  `pseudoDomainFromPaths` 投票 top 过守卫——漂移段**直接落既有真域**（条目并进
  fr/frontend.md），不再铸 auto-rontend 类拼写壳。任一上游路径形态再出 mangle，
  拼写错域都无法凭空出生。
- **附带修掉同链实证缺陷**：`TEST_PATH_TOKEN_RE` 扩展名交替 `.ts` 贪心截断 `.tsx`
  ——事发归档绑定行 `governance-cards.test.tsx` 被截成 `.test.ts`（test-bindings 的
  .ts→.tsx 变体兜底正是其历史代偿），交替序改长度降序（tsx 先于 ts）。

**缺陷 2（unmapped 无分批迁移）已修**：`tests --redomain` 增 `--by-change <变更名>`——
按条目自带「变更：<名>」字段过滤，只迁命中条目、余条留守源域（源不删空壳）；干跑预览
同过滤并列出各条目来源变更（供 AI/人工按变更分批治理 699 条混合池）；未命中变更名
明确报错不静默全迁。用法：
`sillyspec tests --redomain --from unmapped --to frontend --by-change <名> [--write]`。

**根因定位附记**：建议器/路由函数本身自引入（e2da65a0）无字符截取逻辑，逐字节复算
正常 frontend 路径产出恒为 frontend；事发态（收口时交付未提交、断点续跑回读等中间
形态）未能完全复现 mangle 源——词典守卫正是对此类不可复现上游形态的结构性防线。
生产侧已手工补救（2842ec201），后续 4dfba3a2a 页面一键归位同批收口。

**测试**：`test/fr-domain-guard-and-redomain-bychange.test.mjs` 5/5（守卫吸附三态/
建议域过守卫/伪域路由落真域/by-change 分批含未命中报错/tsx 不再截断）；fr-index×2 +
knowledge-digest + redomain + flow-draft-binding-extract + flow-protocol + test-bindings
回归 59 例全绿。归档。
