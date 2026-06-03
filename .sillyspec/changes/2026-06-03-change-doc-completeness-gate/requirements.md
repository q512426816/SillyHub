---
author: qinyi
created_at: 2026-06-03 16:51:54
---

# Requirements

author: qinyi
created_at: 2026-06-03 16:51:54

## 角色

| 角色 | 说明 |
|---|---|
| 业务用户 | 在变更详情页查看文档完整度、判断变更是否具备推进/归档条件 |
| 评审者 | 在 accepted 阶段依据归档门禁 6 项检查决定是否归档 |
| 开发者 | 维护变更中心前后端，需要前后端契约一致 |

## 功能需求

### FR-01: 完整度计数只以四件套为分母
Given 一个变更目录下存在 proposal/design/requirements/tasks 四件套且无可选文档
When 用户打开变更详情页查看"变更文档完整性"卡片
Then 卡片显示"4/4 就绪"，可选文档（plan/verify_result/module_impact/MASTER/prototypes/references）的缺失不计入分母

### FR-02: 必需与可选文档分区展示
Given 变更目录四件套齐全、缺少 plan.md 与 verify-result.md
When 用户查看完整度卡片
Then 必需组四项全部显示为就绪（绿色✓），可选组中 plan/verify_result 显示为缺失（灰显），且不拉低"4/4"计数

### FR-03: 归档门禁 documents_complete 判四件套齐全
Given 变更处于 accepted 阶段且四件套全部 exists
When 系统执行归档门禁检查
Then documents_complete 检查项 passed=true

### FR-04: 缺必需文档时门禁失败并说明
Given 变更处于 accepted 阶段但缺少 design.md
When 系统执行归档门禁检查
Then documents_complete 检查项 passed=false，detail 指明"缺少必需文档: design"

### FR-05: 归档门禁 UI 正确渲染后端返回
Given 后端返回 {can_archive, checks:[{name,passed,detail}×6]}
When 用户在 accepted 阶段查看归档门禁面板
Then 6 项检查逐项正确显示通过/未通过状态与说明，未通过项 badge 计数等于 checks 中 passed=false 的数量

### FR-06: status 字段不再影响门禁
Given ChangeDocument.status 恒为 None（解析器不写入）
When 系统执行 documents_complete 检查
Then 检查结果只取决于四件套 exists，与 status 取值无关

## 非功能需求

- 兼容性：不改后端 ArchiveGateResponse / ArchiveCheckItem schema，以其为契约基准；本项目未上线无数据兼容负担。
- 可回退：归档门禁此前 UI 即不可用，本次为净改善，无需回退路径。
- 可测试：documents_complete 的齐全/缺件两种结果可单元测试；前端契约对齐由 tsc + 手动验证覆盖。
- 一致性：前端完整度分母与后端 documents_complete 必须共用同一四件套集合，不得各自硬编码出现分歧。
