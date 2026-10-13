# design 清单跨仓声明的「路径前缀」静默归主仓坑（关联仓已注册也不触发跨仓对账）

> 记录时间：2026-10-12 · 来源：SillyHub 平台 workspace 4e9eb05b 变更 2026-10-12-fire-route-model-dup
> （服务器归档件实证）+ CLI 源码 `change-list.js` / `stages/plan-postcheck.js` 机制核对
> 状态：活跃坑（设计权衡下的既有语义，非 bug；缺的是防呆提示，待工具加 advisory）

## 现象

变更收口（closedBy: flow done）后，归档冻结件 change-patch.json 的 `scopeAudit` 无
`repos` 键，全部对账行仅 1 行：`sub-grid-security/src/common/router.js` 标
「计划未动 0/0」；平台「归档留档」卡文件清单只有主仓 spec 文档，跨仓 diff 正文完全
缺席。而该 workspace 平台侧「关联仓」已配置 subgrid（repos·✓，守护进程已写入绑定机器
local.yaml 跨仓注册表），执行机 CLI 也是带 patch 冻结能力的新版（2026-10-10-cross-repo-patch-freeze）。

## 根因

design.md「文件变更清单」写的是：

```
| 修改 | sub-grid-security/src/common/router.js | ... |
```

CLI 的跨仓归因只认三种显式语法（key 必须与 local.yaml repos 注册 key 完全一致）：

1. 段头：`## <key> 仓变更`（h2/h3，段内表格/列表条目整体归该仓，路径为**仓根相对**）；
2. 分类列表子段：`### <key>` 或 `### <key> 仓/仓库`（detectRepoFromSubsection）；
3. 条目显式前缀：`cross-repo:<key>:<仓根相对路径>`（splitCrossRepoPrefix，前缀剥除）。

「路径前缀写仓目录名」不在其中——解析器把整条当主仓路径（parseDesignCoverageByRepo
无段头时整节归 main），主仓无此文件 → 冻结为「计划未动」，跨仓对账与 patch 冻结
（reconcileCrossRepoPlan）从不触发。雪上加霜：注册 key 是 `subgrid`，即便写
`## sub-grid-security 仓变更` 段头也因 key 不在注册表而不命中。

## 伤害

静默误导三层：冻结件「计划未动」行看起来像执行方漏做（实际跨仓已做完）；平台审计面
丢失跨仓 diff 正文与哈希锚；收口八子步全部正常通过、评审豁免，零拦截零告警——
声明面写错只有在人读冻结件时才现形。

## 期望修复（防呆 advisory，非语义变更）

flow done 解析 design 清单时：声明路径在主仓不存在、且首段路径 token 命中 local.yaml
repos 注册表的某个仓目录名（或 basename）→ 出一条 advisory（「疑似跨仓声明未按段头/
cross-repo: 前缀标注，已按主仓路径对账为『计划未动』」）。配套：平台「关联仓」卡展示
注册 key（当前卡片名即 key，需在 design 编辑提示中显式说明三种标注语法与 key 一致性）。

## 正确写法备查（key 以 local.yaml repos 注册为准，本例为 `subgrid`）

```
## subgrid 仓变更

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | src/common/router.js | 四条 fire 路由 models 声明改为空数组 |
```

或单表格内：`| 修改 | cross-repo:subgrid:src/common/router.js | ... |`

## 处置记录（2026-10-13）

**防呆 advisory 已修**（sillyspec 仓工作树，坑期望的「非语义变更」方向）：flow done 解析
design 清单后——声明路径在主仓不存在、且首段 token 命中注册仓的 key **或注册路径
basename**（本例 `sub-grid-security` → key `subgrid`）→ 一条点名 warning + 三种正确语法
指引（段头/子段/cross-repo: 前缀，key 以 local.yaml 注册为准）。已带跨仓标注（e.repo）
与主仓存在的路径不查；best-effort 不阻断收口。坑现场形态功能验证 PASS（basename 别名
命中）+ flow-protocol / change-list / plan-postcheck / design-facts 回归 34/34 绿。
平台侧「关联仓卡展示注册 key」的配套文案属平台 UI 面小改，随需要另行处理。归档。
