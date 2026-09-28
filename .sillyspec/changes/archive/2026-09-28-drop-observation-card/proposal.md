---
author: flow-machine-draft
created_at: 2026-09-28T01:42:46.078Z
---
# 提案书（Proposal）— 2026-09-28-drop-observation-card

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:827536c240e14b46109c0831dd498fe6d630af95c0d06a819e770bed58386cbf:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-drop-observation-card 留痕重锚 -->
任务原话转写：侧栏观测事件卡与主栏真实留痕时间线卡功能重叠（同表同数据双显），产品裁决直接移除观测事件卡，事件流水由主栏时间线卡独家承担
成功标准：
- 变更详情页不再挂载观测事件卡（desktop 与移动端全挂载点清除）
- 卡组件与其前端封装若无其他引用则一并删除（不留死代码）
- 相关测试同步更新（原断言该卡在场的用例改口径）并全部通过
- 后端 /changes/{name}/events 端点不动（CLI 推送与调试面仍在用）
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:ff795e641eb0a058c2889f97a729f1cf805414fcf6b21eea6c95f9028b2df176:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-drop-observation-card 留痕重锚 -->
按成功标准机械推导，共 4 条验收面：
1. 变更详情页不再挂载观测事件卡（desktop 与移动端全挂载点清除）
2. 卡组件与其前端封装若无其他引用则一并删除（不留死代码）
3. 相关测试同步更新（原断言该卡在场的用例改口径）并全部通过
4. 后端 /changes/{name}/events 端点不动（CLI 推送与调试面仍在用）
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:187eaa3fbf40f6e62ef76e78961669cb53a380a7b31ff878e251b915fbc0b184:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-drop-observation-card 留痕重锚 -->
1. 变更详情页不再挂载观测事件卡（desktop 与移动端全挂载点清除）
2. 卡组件与其前端封装若无其他引用则一并删除（不留死代码）
3. 相关测试同步更新（原断言该卡在场的用例改口径）并全部通过
4. 后端 /changes/{name}/events 端点不动（CLI 推送与调试面仍在用）
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
