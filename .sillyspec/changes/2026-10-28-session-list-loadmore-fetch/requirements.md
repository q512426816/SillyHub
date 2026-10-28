---
author: flow-machine-draft
created_at: 2026-10-28T05:17:51.869Z
---
# 需求规格（Requirements）— 2026-10-28-session-list-loadmore-fetch

## 功能需求

### FR-01: 组内「加载更多」每次点击新增恰好 20 条此前未显示的可见行（跳过已显示计数，不被在线全显吞并），全组显示后按钮消失

- 展示集计算**必须**按「默认展示（前 10 ∪ 在线全显）之外的条目按服务端序给 extra 预算」计数——每次 +20 **必须**恰好新增 20 条此前未显示的行；extra=0 输出**必须**与既有默认基线逐字节一致；覆盖全组后**必须**移除按钮。

#### 场景：主路径

- Given 组内 35 条（在线 2 条在第 21/31 位）：默认 12 行（10+2 在线）
- When 点一次「加载更多」
- Then 展示 32 行（恰好 +20 条此前隐藏行，仍有 3 条隐藏 → 按钮在场「还有 3 条」）；再点一次 → 35 全量、按钮消失

### FR-02: 组内「加载更多」点击时若服务端总数 > 已加载数，立即触发后端接口按相同筛选参 offset 续拉 20 条（每次点击真拉取，全部拉完为止不再请求）

- 组内点击时若 `总数 > 已加载数`，**必须**并行触发数据层续拉（同筛选参 + offset=已加载数 + limit=20）；in-flight 守卫**必须**防双拉；全部拉完（已加载=总数）后点击**必须**不再发请求（纯本地展开）。

#### 场景：主路径

- Given 首屏已加载 3 条、服务端总数 4（组内尚有隐藏行）
- When 点击组内「加载更多」
- Then 本地展开立即生效，同时 listAgentSessions 以 offset=3、limit=20 被调用；追加去重后已加载=4，再点不再发请求

### FR-03: 树底部「加载更多会话」同样每次拉 20 条（与组内入口同一数据层函数）

- 树底部入口**必须**复用同一续拉函数（EXTRA_PAGE_LIMIT=20），两入口行为一致。

#### 场景：主路径

- Given 已加载 < 总数
- When 点击树底部「加载更多会话」
- Then 续拉 20 条（offset=已加载数）追加展示

### FR-04: 附加段追加仍按 id 去重；筛选/scope/视图切换重置语义不变

- 附加段 append **必须**按 id 去重；筛选/scope/归档视图切换的重置语义**必须**与上一变更保持一致（组内递增清零 + 附加段清空）。

#### 场景：主路径

- Given 续拉响应含与已加载重叠的条目（排序漂移）
- Then 附加段去重后不重复渲染；切换引擎 tab 后组内回默认基线、附加段清空

### FR-05: 触达测试全绿，既有递增用例改写为新语义并新增触网断言用例

- 既有递增用例**必须**改写为新语义（+20 恰好新增 20 行）；新增用例**必须**断言组内点击触网（offset/limit）；收口前触达测试**必须**全绿。

#### 场景：主路径

- Given session-list-panel 测试文件
- When vitest run
- Then 全部通过（含改写与新增用例）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「组内 35 条（在线 2 条在第 21/31 位）：加载更多两次 +20 恰好新增 20 行至全量（改写）」
FR-02: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「组内点击触发数据层续拉（offset=已加载 limit=20）+ 拉完不再请求（新增）」
FR-03: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「点『加载更多会话』→ offset 续拉（同筛选参）+ 附加段去重后追加展示（改写，limit 断言 20）」
FR-04: 同上用例去重断言 + 「两层筛选切换 → 组内递增重置回默认基线（既有，保持绿）」
FR-05: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx 全文件 vitest 绿（收口实测）+ tsc/eslint 0 error
