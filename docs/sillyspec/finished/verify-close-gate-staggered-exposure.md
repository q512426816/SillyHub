# verify 收口纯文档门分四轮逐个暴露 + 矩阵锚点正则吞中文左括号

> 记录时间：2026-10-15 · 来源变更：2026-10-14-admin-server-status（verify --done 四连撞实证）
> 状态：活跃坑（node 直调校验器实证根因，绕过可靠，待工具修复）

## 现象

verify `--done` 收口被纯文档门拦截时，CLI 承诺「一次性全列——全部修复后重跑一次 --done，
不必逐门连撞」，实际**四轮 --done 每轮只暴露一个新的文档问题**，且部分报错文案未给出根因线索：

| 轮次 | 拦截项 | 报错文案给的线索 | 实际根因（排查后） |
|---|---|---|---|
| 1 | module-impact 更新结果表 5 个 pending 死信 + target_files 2 个 undeclared | 清晰（真实义务，照做） | 真实义务，非缺陷；但 provider-caps 两文件实为 gen:types 幂等重生成的**零内容 diff**（纯行尾标记），仍要求补声明或回退 |
| 2 | 矩阵证据列「缺锚点」 | 提示五形态样例 | 我把测试 file:line 写在第 5 列，但判定=covered 需要的是 design表/权限矩阵/契约表/DDL/载荷五形态（测试锚点是 covered-service 的）——报错文案混排两套形态要求，需读源码才分清 |
| 3 | 同项「design.md 未命中 design 接口段解析面（空指）」 | 让补真实锚点 | 双因：① design.md 接口段是散文 bullet，parseDesignApiTable 解析零端点（表格化后仍空指）② facts 由 `--init` 落盘且**刻意不落 apiFace 键**（源码注释自认），--done backfill 才写——重跑 --init 刷新 facts 后仍失败，见第 4 轮 |
| 4 | 同项仍空指 | 无新线索 | 锚点正则 `API_ANCHOR_DESIGN_API_RE` 的路径字符类 `[^\s|，。；;）)]` 排除了中文右括号）却**没排除左括号（**——`design接口表#GET /api/system-status（design.md 接口定义节端点一致）` 的路径被吞成 `/api/system-status（design.md`，与 parseSet 永不匹配 |

轮次 4 用 `node --input-type=module` 直调 `validateApiCoverageMatrix` 复现 + 改分隔符后 ok=true 才定位。

## 影响

- 每轮 --done 前都先跑一遍实测门（test 195s），文档问题逐个暴露 = 约 20 分钟纯往返损耗；
- 报错文案与真实修复动作之间需要读 sillyspec 源码才能对上（本变更读了 stage-contract.js 三段源码）；
- 锚点正则缺陷会让任何「锚点后紧跟中文左括号注记」的写法恒空指，且报错指向「design.md 未命中」误导排查方向（实际 design.md 已有表格且 facts 已刷新）。

## 绕过

1. 矩阵行锚点写法：`design接口表#GET /api/path，<其余文字>`——锚点后**紧跟中文逗号或空格**，不要跟中文左括号注记；
2. covered 与 covered-service 的证据形态要分清：covered→五形态（design接口表#/权限矩阵[]/契约表@/DDL@/载荷@），covered-service→测试锚点三形态（.test. / file:line / 反引号测试名）；
3. 撞「未命中解析面」时：design 接口段先表格化（`| 方法 | 路径 | 说明 |`），跑 `verify-probes --init` 刷 facts，再用 node 直调校验器实证通过后才跑 --done（省实测门时间）。

## 修复建议

1. 收口校验真正一次性全列：把全部文档校验器先跑完再汇总报错（现在疑似第一项 fail 后短路）；
2. `API_ANCHOR_DESIGN_API_RE` 路径字符类补排除中文左括号（（与全角引号等注记起始符，与已排除的右括号）对称；
3. 「空指」报错附 facts.apiFace.endpoints 实际解析集（一眼看出是锚点吞字而非 design 缺表）；
4. provider-caps 类零内容 diff（gen 脚本幂等重生成行尾标记）在对账时按 `git diff --quiet` 判定忽略，不要求补声明。

## 处置记录（2026-10-15）

**四条建议全部落地**（sillyspec `2026-10-15-pitfall-batch-clearance`，归档 a493aef1）：

1. **收口一次全列 ✅**：文档门（module-impact 死信/target_files 对账/矩阵校验）并入
   一次全列汇总报错，不再逐门连撞（四轮 ×195s 实测门往返消除）；
2. **锚点正则括号对称 ✅**：`API_ANCHOR_DESIGN_API_RE` 路径字符类左右括号对称排除
   （（）()）——「锚点后紧跟中文左括号注记」不再吞字恒空指（本日 node 直调复验 PASS）；
3. **空指附解析面 ✅**：「未命中解析面」报错附 facts.apiFace.endpoints 实际解析集，
   一眼区分锚点吞字 vs design 缺表；
4. **零内容 diff 忽略 ✅**：对账剔纯行尾假红（numstat 配对探测）——gen:types 幂等重生成的
   零内容 diff 不再要求补声明。

归档。
