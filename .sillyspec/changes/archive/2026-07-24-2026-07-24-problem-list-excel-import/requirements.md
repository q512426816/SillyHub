---
author: qinyi
created_at: 2026-07-24 09:35:35
---

# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 项目经理 / 责任人 | 批量录入问题（拥有 problem 创建权限），下载模板、上传、预览、确认导入 |
| 系统管理员 | 同上（超管可操作所有项目的问题） |
| 普通成员 | 受 data_scope 限制：commit 时仅能导入自己可访问项目下的问题 |

## 功能需求（FR）

> 每条 FR 标注覆盖决策；可回退/可测试。

- **FR-01 模板下载**：问题清单页提供「下载导入模板」，17 列全字段中文表头 + 1 行示例（D-003）。可测试：下载得到 .xlsx，表头含「项目名称/模块名称/问题描述/.../备注」。
- **FR-02 上传预览**：上传 .xlsx → `import-preview` 解析返回全字段行 + valid/error（D-001）。可测试：合法文件返回 rows；非法扩展名/超大文件被 `validate_xlsx_upload` 拒绝（D-013）。
- **FR-03 严格匹配校验**：项目名必填且须匹配 `PpmProjectMaintenance.project_name`（D-002/D-009）；module/duty/audit 填了须匹配（duty/audit 限该项目成员 PpmProjectMember，D-006/D-014）；填了未匹配 → 整行 `valid=false` 标 error（D-004）。可测试：造未匹配行 → valid=false + error 文案。
- **FR-04 必填校验**：`project_name` 空/未匹配、`pro_desc` 空 → `valid=false`（D-009）；其余字段空允许。可测试：空 pro_desc 行 valid=false。
- **FR-05 原子入库**：`import-commit` 单次事务提交，全成或全回滚，不部分入库（D-008）。可测试：构造一行触发 DB 异常 → 整批回滚 created=0。
- **FR-06 防篡改**：commit 不信任前端回传 UUID，按原文重新反查 + data_scope 校验 project 可访问（D-011）。可测试：前端伪造 project_id → commit 重算/拒绝。
- **FR-07 字段映射与转换**：`module_name`→ORM `model_name` + 反查 `module_id`（D-012）；`date`→`datetime`（D-010）；`is_urgent`/`is_delay_plan`「是/否」→「1/0」（importer 规范化）。可测试：导入后 DB model_name/is_urgent 正确。
- **FR-08 系统字段**：入库 `status="新建"`、`created_by`=当前用户、`file_urls`=[]（D-007）。可测试：导入后问题为「新建」态、创建人正确。
- **FR-09 不查重**：Excel 几行建几条（D-005）。可测试：两行相同内容 → 建两条。
- **FR-10 跨项目**：Excel 每行项目名反查，支持一次导入多项目（D-002）。可测试：两行不同项目名 → 分别归属。
- **FR-11 权限**：导入端点权限同 `create_problem`（D-001）。可测试：无权限用户 403。
- **FR-12 前端三态弹窗**：上传（Dragger+下载模板）→ 预览（全字段 Table + 标红）→ 结果（统计），成功后刷新列表（D-001）。可测试：组件测试覆盖三态切换/标红/提交回传。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-02, FR-11, FR-12 | 后端解析+两步式+权限同 create |
| D-002@v1 | FR-03, FR-10 | 项目名反查、跨项目 |
| D-003@v1 | FR-01 | 全字段模板 |
| D-004@v1 | FR-03 | 严格匹配校验 |
| D-005@v1 | FR-09 | 不查重 |
| D-006@v1 | FR-03, FR-07 | 反查源 |
| D-007@v1 | FR-08 | 系统字段默认 |
| D-008@v1 | FR-05 | 原子单次事务 |
| D-009@v1 | FR-04 | 必填维度 |
| D-010@v1 | FR-07 | date→datetime |
| D-011@v1 | FR-06 | commit 重查防篡改 |
| D-012@v1 | FR-07 | module_name→model_name+module_id |
| D-013@v1 | FR-02 | 上传校验抽 common |
| D-014@v1 | FR-03 | duty/audit 限项目成员 |

全部 D-001~D-014 均被 FR 覆盖，无剩余风险。
