---
author: flow-machine-draft
created_at: 2026-10-19T01:56:39.052Z
---
# 需求规格（Requirements）— 2026-10-19-shared-agent-onboarding-hint

## 功能需求

### FR-01: 预会话态(sessionId 为空)下,用户无自有机器且无「共享给我的」机器、且存在 runtime_online 的平台共享智能体时,预会话档案自动默认选中第一个在线共享智能体

- 预会话态（sessionId 为空）下，当用户无自有机器（GET /api/daemon/machines 响应 total=0）且无「共享给我的」机器（shared_to_me 为空/缺省）、且平台共享智能体生效列表中存在 runtime_online=true 的条目、且用户尚未手动选择过档案时，系统必须自动将预会话档案暂存值设为第一个在线共享智能体的 agent_profile_id。

#### 场景：主路径

- Given 180072 类新用户（无自有 daemon、无工作区共享机器），平台有生效共享智能体「平台向导」且其钉定 runtime 在线
- When 打开会话门户进入预会话态（sessionId=null）
- Then 预会话档案暂存值自动等于「平台向导」的 agent_profile_id，配置条档案按钮显示「平台向导」

### FR-02: 用户手动切换过档案(含选「不指定」)后,自动默认选中不再覆盖用户选择

- 用户在预会话态通过档案下拉手动操作过档案选择（切换到任一档案或「不指定」）后，系统必须停止自动默认选中，禁止后续 effect 覆盖用户选择。

#### 场景：手动选回不指定

- Given 自动默认选中已生效（preProfileId=共享智能体 id）
- When 用户在档案下拉点选「不指定（无人格）」
- Then preProfileId 保持空串，系统不再自动改回共享智能体，引导提示消失

### FR-03: 满足默认选中条件时,预会话区显示引导提示,说明该共享智能体读平台源码不受限、写操作限制在共享输出目录,且可在智能体下拉切换

- 当门控条件（无自有机器且无共享机器）成立且预会话档案暂存值等于某在线共享智能体的 agent_profile_id 时，系统必须在预会话配置条上方渲染引导提示（data-testid="pre-session-shared-agent-hint"），内容必须包含该共享智能体名称、「读平台源码不受限」与「写操作限制在共享输出目录」的约束说明及可在智能体下拉切换的指引。

#### 场景：主路径

- Given 自动默认选中已生效
- Then 预会话区渲染提示条，文案含共享智能体名与读写约束说明

### FR-04: 有自有机器或有共享机器、共享智能体全部离线、机器数据加载中或请求失败时,均不自动选中也不显示提示(fail-open 不阻塞)

- 以下任一情形系统必须不自动选中档案且不渲染引导提示：用户有自有机器（total>0）或有「共享给我的」机器；平台共享智能体全部 runtime_online=false；机器门控数据加载中或请求失败；共享智能体生效列表请求失败（既有降级 []）。引导数据缺失必须不影响预会话其余功能。

#### 场景：机器请求失败

- Given listDaemonMachines 请求 reject
- Then 不自动选中、不显示提示，预会话输入区正常可用

### FR-05: 聚焦测试覆盖上述分支,tsc 0 错误

- 本变更必须以聚焦组件测试覆盖 FR-01~FR-04 全部分支（默认选中、手动守卫、提示渲染、四类 fail-open），且 `pnpm exec tsc --noEmit` 0 错误。

#### 场景：主路径

- Given 变更代码完成
- When 运行聚焦测试文件与 tsc
- Then 全部用例通过、tsc 无错误

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/session-panel-platform-shared.test.tsx「无自有/共享机器 + 在线共享智能体 → 默认选中并显示读写约束引导提示」
FR-02: frontend/src/components/daemon/__tests__/session-panel-platform-shared.test.tsx「手动选『不指定』后自动选中让位，提示消失且不再被改回」
FR-03: frontend/src/components/daemon/__tests__/session-panel-platform-shared.test.tsx「无自有/共享机器 + 在线共享智能体 → 默认选中并显示读写约束引导提示」（读写约束与切换指引断言并入该用例）
FR-04: frontend/src/components/daemon/__tests__/session-panel-platform-shared.test.tsx「有自有机器（total>0）→ 不自动选中、不显示提示」「有『共享给我的』机器 → 不自动选中、不显示提示」「共享智能体全部离线 → 不自动选中、不显示提示」「门控机器查询失败 → fail-open 不选中不提示，面板正常」「共享智能体生效列表请求失败（降级 []）→ 门控不成立，不选中不提示」
FR-05: 不适用：tsc 与聚焦测试命令为质量门槛（CI 面），非单条用例可断言；测试覆盖由 FR-01~04 绑定行承担
