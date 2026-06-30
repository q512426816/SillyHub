---
author: qinyi
created_at: 2026-06-30T10:20:00
task_id: task-14
status: implemented
---
# task-14: daemon-client 详情页扫描入口

## 目标
daemon-client workspace 详情页加「扫描」按钮，点击触发 scan-generate，复用 AgentRunPanel 展示进度，scan 完成 reload。修复 daemon-client 创建后无首次 scan 触发入口（repo-native/repo-mirrored 下源项目 .sillyspec 数据无法回灌平台 specRoot）。

## 上下文
- **现状**：daemon-client 创建走 `createWorkspace`（workspace-scan-dialog.tsx:89，只创建不 scan）；详情页 platform-managed 有「初始化」bootstrap 按钮（page.tsx:422）但无 scan 入口；后端 `scan_generate_daemon_client`（service.py:1058）对已存在 workspace 安全复用（`_find_active_by_root_path :1076`），从 `spec_ws.strategy` 读真实策略派 scan lease（task-03 已实现）。
- **前端 scanGenerate**（lib/workspaces.ts:123-140）已支持 pathSource/daemonRuntimeId，待补 specStrategy。
- **实证**：workspace 5c22aa2e（strategy=repo-native 已落库）创建后 daemon 从未 scan，平台 specRoot 空。

## 具体做什么

### 1. `frontend/src/lib/workspaces.ts` scanGenerate 补 specStrategy 透传
- import SpecStrategy 类型 from "@/lib/spec-workspaces"（已存在 `SpecStrategy = "platform-managed"|"repo-mirrored"|"repo-native"`）。
- scanGenerate 签名加 `specStrategy?: SpecStrategy` 参数（放 daemonRuntimeId 后）。
- 请求体加 `...(specStrategy ? { spec_strategy: specStrategy } : {})`。

### 2. `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` 加 scan 按钮 + 状态 + panel + 互斥
**直接复刻现有 bootstrap 模式改 scan 命名**（bootstrap 见 :123-126 状态 / :234-251 handleBootstrap / :419-448 extra 按钮 / :497-518 AgentRunPanel）。

a. 新增状态（:126 `bootstrapError` 后）：
```tsx
const [activeScanRunId, setActiveScanRunId] = useState<string | null>(null);
const [scanStatus, setScanStatus] = useState<AgentRunStatus | null>(null);
const [scanError, setScanError] = useState<string | null>(null);
const [scanning, setScanning] = useState(false);
```

b. handleScan（参考 handleBootstrap :234）：
```tsx
async function handleScan() {
  if (!workspace?.daemon_runtime_id) return;
  setScanning(true);
  setPageError(null);
  setActiveScanRunId(null);
  setScanStatus(null);
  setScanError(null);
  try {
    const result = await scanGenerate(
      workspace.root_path,
      workspace.default_agent ?? null,
      workspace.default_model ?? null,
      "daemon-client",
      workspace.daemon_runtime_id,
      specWs?.strategy,
    );
    setActiveScanRunId(result.agent_run_id);
    setScanStatus("pending");
  } catch (err) {
    setPageError(err instanceof ApiError ? err.message : "扫描失败");
  } finally {
    setScanning(false);
  }
}
```
（顶部 import 加 `scanGenerate` from "@/lib/workspaces"。）

c. closeScanPanel / handleScanRunDone（参考 closeBootstrapPanel :219 / handleBootstrapRunDone :226）：
```tsx
const closeScanPanel = useCallback(() => {
  setActiveScanRunId(null); setScanStatus(null); setScanError(null);
}, []);
const handleScanRunDone = useCallback((status: string) => {
  setScanStatus(status as AgentRunStatus);
  void load();
}, [workspaceId]);
```

d. extra 区加「扫描」按钮（:419 `<div className="flex gap-2">` 内，daemon-client 时显示，与 platform-managed 的初始化按钮并列）：
```tsx
{isDaemonClientWorkspace(workspace) && (
  <Button size="sm" variant="outline"
    onClick={handleScan}
    disabled={!!activeBootstrapRunId || !!activeScanRunId || scanning || importing}
  >
    {scanning ? "派发中…" : activeScanRunId ? "扫描运行中…" : "扫描"}
  </Button>
)}
```

e. bootstrap 按钮（:427 `disabled`）追加 `|| !!activeScanRunId`（互斥）。

f. scan AgentRunPanel 实例（:518 bootstrap panel `</div>` 后）：
```tsx
{activeScanRunId && (
  <div className="mb-3">
    <AgentRunPanel
      workspaceId={workspaceId}
      runId={activeScanRunId}
      isActive={scanStatus === "running" || scanStatus === "pending"}
      title="扫描运行"
      emptyText="等待日志输出..."
      isLive={scanStatus === "running" || scanStatus === "pending"}
      summary={<Badge variant={statusToVariant(scanStatus)}>{scanStatus ?? "等待中"}</Badge>}
      onClose={closeScanPanel}
      onDone={handleScanRunDone}
    />
    {scanError && <p className="mt-2 text-xs text-destructive">{scanError}</p>}
  </div>
)}
```

## 接口定义
- `scanGenerate(rootPath, provider?, model?, pathSource?, daemonRuntimeId?, specStrategy?) → {workspace_id, agent_run_id}`
- `POST /api/workspaces/scan-generate` body: `{root_path, path_source:'daemon-client', daemon_runtime_id, spec_strategy?}`（既有端点 router.py:114，不改）

## 边界处理
- daemon-client 但 daemon_runtime_id 为空：按钮 disabled（handleScan 守卫 `if (!workspace?.daemon_runtime_id) return`）。
- scan 运行中重复点击：按钮 disabled（activeScanRunId/scanning）。
- scan/bootstrap 互斥：彼此 disabled 联动（R-07）。
- scan 失败：pageError 展示。
- 页面 reload 时 scan run 恢复：复用 listAgentRuns 恢复逻辑（:179-202），scan run 与 bootstrap run 都是 change_id==null；如需区分可按 created_at 最近，当前实现允许 scan/bootstrap 共用恢复（幂等，R-08 兜底）。

## 参考
- **现有 bootstrap 模式** page.tsx:123-126/234-251/419-448/497-518（直接复刻改 scan 命名，零回归）。
- CONVENTIONS：useClient + useEffect/apiFetch 手动取数；AgentRunPanel 承担 SSE（hook 内闭环）；操作成功手动 `load()` reload（无全局缓存）。
- `isDaemonClientWorkspace` 已有（page.tsx:347 已用，from "@/lib/workspace-path"）。
- `scanGenerate` lib/workspaces.ts:123-140。

## TDD 步骤
1. 写测试（task-15）：scanGenerate spec_strategy 透传 + 按钮渲染/调用/互斥。
2. `cd frontend && pnpm test` 确认失败。
3. 实现 lib/workspaces.ts scanGenerate specStrategy + page.tsx scan 按钮/状态/panel/互斥。
4. `cd frontend && pnpm test` 确认通过。
5. `cd frontend && npx tsc --noEmit` 类型检查。

## 验收标准
- [x] daemon-client workspace 详情页（platform-managed/repo-mirrored/repo-native 三策略）显示「扫描」按钮
- [x] platform-managed 同时显示「初始化」+「扫描」，互斥 disabled（跑一个时另一个 disabled）
- [x] 点击扫描调 scanGenerate（root_path / path_source=daemon-client / daemon_runtime_id / spec_strategy）
- [x] scan 进度 AgentRunPanel 展示，onDone → load() reload（componentCount/activeChanges/archivedChanges/specWs）
- [x] scan 失败 pageError 展示
- [x] `cd frontend && pnpm test` 通过（522 passed 含新增 7 测试）+ `npx tsc --noEmit` 通过

## 覆盖
FR-14, D-006@v1, R-07, R-08。参考 design §5.5。
