/**
 * GovernanceCards 组件测试（2026-09-27-knowledge-governance-cards）。
 * 三态：healthy 单行安语带底数；超阈逐卡（kind 图标/计数/明细/处置指引）；
 * 加载/错误轻量态。数据链 getKnowledgeGovernance mock（useQuery 消费面契约）。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GovernanceCards } from "@/components/knowledge/governance-cards";

// 惯例（仿 distill-task-bar.test.tsx）：vi.hoisted + importActual 部分 mock
const { mocked, actionMocked } = vi.hoisted(() => ({ mocked: vi.fn(), actionMocked: vi.fn() }));
vi.mock("@/lib/knowledge", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/knowledge")>()),
  getKnowledgeGovernance: mocked,
  postKnowledgeGovernanceAction: actionMocked,
}));

function renderCards() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GovernanceCards workspaceId="ws-1" />
    </QueryClientProvider>,
  );
}

afterEach(() => mocked.mockReset());

it("healthy：单行安语 + 底数（unmapped 池在场才展示）", async () => {
  mocked.mockResolvedValue({
    healthy: true,
    signals: [],
    totals: { rot: 3, inbox: 5, pseudo: 0, unmapped_pool: 12 },
  });
  renderCards();
  await waitFor(() =>
    expect(screen.getByTestId("governance-cards").textContent).toContain("安静即健康态"),
  );
  expect(screen.getByTestId("governance-cards").textContent).toContain("rot 3");
  expect(screen.getByTestId("governance-cards").textContent).toContain("unmapped 池 12");
  expect(screen.queryByTestId("governance-card-rot")).toBeNull();
});

it("超阈：逐卡渲染 kind/计数/处置指引", async () => {
  mocked.mockResolvedValue({
    healthy: false,
    signals: [
      {
        kind: "rot",
        title: "rot 待复核批量标记（101 条 > 100）",
        count: 101,
        detail: "cli 51、runtime 50",
        suggestion: "批量复核：文案漂移类可批量承接",
      },
      {
        kind: "inbox",
        title: "知识收件箱积压（39 条 > 20）",
        count: 39,
        detail: "install.sh 改动需重建 backend 镜像 等",
        suggestion: "sillyspec knowledge inbox 逐条 classify 清账",
      },
    ],
    totals: { rot: 101, inbox: 39, pseudo: 0 },
  });
  renderCards();
  await waitFor(() => expect(screen.getByTestId("governance-card-rot")).toBeInTheDocument());
  expect(screen.getByTestId("governance-card-rot").textContent).toContain("101");
  expect(screen.getByTestId("governance-card-rot").textContent).toContain("cli 51");
  expect(screen.getByTestId("governance-card-inbox").textContent).toContain("classify");
  expect(screen.getByTestId("governance-cards").textContent).toContain("2 类治理信号超阈");
});

it("请求失败：轻量降态不渲染卡", async () => {
  mocked.mockRejectedValue(new Error("boom"));
  renderCards();
  await waitFor(() => expect(screen.getByTestId("governance-cards").textContent).toContain("暂不可用"));
});


it("v2：actions_available 时伪域卡渲染迁移按钮（输入目标域+触发 mutation），local 模式隐藏", async () => {
  mocked.mockResolvedValue({
    healthy: false,
    signals: [
      { kind: "pseudo-domain", title: "伪域在库", count: 14, detail: "auto-backend 14", suggestion: "迁移" },
      { kind: "binding-unresolved", title: "坏绑定", count: 1, detail: "FR-cli-entry-091", suggestion: "repair" },
    ],
    totals: { pseudo: 14 },
    source: "daemon-rpc",
    actions_available: true,
  });
  renderCards();
  const input = await screen.findByTestId("redomain-target");
  fireEvent.change(input, { target: { value: "platform-sync" } });
  const btn = screen.getAllByRole("button", { name: /迁移 auto-backend/ })[0];
  fireEvent.click(btn as HTMLElement);
  await waitFor(() => expect(actionMocked).toHaveBeenCalledWith("ws-1", { kind: "redomain", from_domain: "auto-backend", to_domain: "platform-sync" }));
});

it("v2：local 模式（actions_available=false）不渲染动作按钮", async () => {
  mocked.mockResolvedValue({
    healthy: false,
    signals: [{ kind: "pseudo-domain", title: "伪域", count: 3, detail: "auto-x 3", suggestion: "迁移" }],
    totals: { pseudo: 3 },
    source: "local",
    actions_available: false,
  });
  renderCards();
  await waitFor(() => expect(screen.getByTestId("governance-card-pseudo-domain")).toBeInTheDocument());
  expect(screen.queryByTestId("governance-actions-pseudo-domain")).toBeNull();
});
