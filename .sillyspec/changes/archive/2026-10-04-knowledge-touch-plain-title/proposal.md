---
author: flow-machine-draft
created_at: 2026-10-04T07:59:55.041Z
---
# 提案书（Proposal）— 2026-10-04-knowledge-touch-plain-title

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:de45dabef399ae0fdab4dcc94cea9ff7abc3a6e4df65ca7e43cb645e085e2e85:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-04-knowledge-touch-plain-title 留痕重锚 -->
任务原话转写：变更详情页「知识触达」区块标题是后台机制黑话（注入命中 · 待复核标记反查 / 实时），用户看不懂（实测连问多轮才理解其含义），应改为用户语言，机制细节收进悬停提示。

成功标准：
- 归档态与在途态的知识触达区块标题均使用用户语言（「知识触达（本变更参考过的知识）」形态），标题正文不再出现「待复核标记反查」「注入命中」等机制黑话
- 数据口径（在途=执行期注入命中实时记录；归档=条目内「待复核」标记反查为权威、与实时命中合并去重）以悬停提示（title 属性）形式保留，表述准确
- change-assets-card 组件测试断言同步更新并通过
- 知识库 FR-auto-frontend-093 条目（引用了旧标签文案）做内容过时最小修正
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:8c06422f66248fd5bd9a5bb2ad5e64860b94e5116bf342c80f77d2b7d5f3f3e3:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-04-knowledge-touch-plain-title 留痕重锚 -->
按成功标准机械推导，共 5 条验收面：
1. 归档态与在途态的知识触达区块标题均使用用户语言（「知识触达（本变更参考过的知识）」形态），标题正文不再出现「待复核标记反查」「注入命中」等机制黑话
2. 数据口径（在途=执行期注入命中实时记录
3. 归档=条目内「待复核」标记反查为权威、与实时命中合并去重）以悬停提示（title 属性）形式保留，表述准确
4. change-assets-card 组件测试断言同步更新并通过
5. 知识库 FR-auto-frontend-093 条目（引用了旧标签文案）做内容过时最小修正
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:6cae75658427bae7351ed0f8b8fa83e24aa03cbea8d458657a42a67f8675b6f1:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-04-knowledge-touch-plain-title 留痕重锚 -->
1. 归档态与在途态的知识触达区块标题均使用用户语言（「知识触达（本变更参考过的知识）」形态），标题正文不再出现「待复核标记反查」「注入命中」等机制黑话
2. 数据口径（在途=执行期注入命中实时记录
3. 归档=条目内「待复核」标记反查为权威、与实时命中合并去重）以悬停提示（title 属性）形式保留，表述准确
4. change-assets-card 组件测试断言同步更新并通过
5. 知识库 FR-auto-frontend-093 条目（引用了旧标签文案）做内容过时最小修正
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
