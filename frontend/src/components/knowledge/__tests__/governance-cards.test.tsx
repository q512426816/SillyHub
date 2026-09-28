/**
 * GovernanceCards 组件测试（2026-09-27-knowledge-governance-cards；
 * 2026-09-28-knowledge-gov-ux 人话改版重写）。
 *
 * 覆盖：healthy 安语带人话底数；超阈逐卡人话文案（无 CLI 命令字样）；伪域卡
 * 分池渲染（推荐去向预填 / unmapped 无按钮说明）；一键归位（Popconfirm 确认 →
 * redomain 预填参数）与一键修复（repair-paths）；local 模式按钮隐藏 + 守护进程
 * 提示；请求失败轻量降态。数据链 getKnowledgeGovernance mock。
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

afterEach(() => {
  mocked.mockReset();
  actionMocked.mockReset();
});

it("healthy：人话安语 + 底数（早期遗留在场才展示）", async () => {
  mocked.mockResolvedValue({
    healthy: true,
    signals: [],
    totals: { rot: 3, inbox: 5, pseudo: 0, unmapped_pool: 12 },
  });
  renderCards();
  await waitFor(() =>
    expect(screen.getByTestId("governance-cards").textContent).toContain("知识库状态良好"),
  );
  expect(screen.getByTestId("governance-cards").textContent).toContain("待复核 3");
  expect(screen.getByTestId("governance-cards").textContent).toContain("早期遗留 12");
  expect(screen.queryByTestId("governance-card-rot")).toBeNull();
});

it("超阈：伪域卡分池人话渲染——推荐去向预填、unmapped 无按钮无害说明", async () => {
  mocked.mockResolvedValue({
    healthy: false,
    signals: [
      {
        kind: "pseudo-domain",
        title: "伪域在库（共 792 条）",
        count: 792,
        detail: "auto-backend 73、auto-frontend 72、auto-sillyhub-daemon 20、unmapped 699",
        suggestion: "按建议域迁移",
      },
    ],
    totals: { pseudo: 792 },
    source: "daemon-rpc",
    actions_available: true,
  });
  renderCards();
  await waitFor(() => expect(screen.getByTestId("governance-card-pseudo-domain")).toBeInTheDocument());
  const card = screen.getByTestId("governance-card-pseudo-domain");
  // 分池行：人话标签 + 条数 + 推荐去向
  expect(card.textContent).toContain("daemon 后台服务知识");
  expect(card.textContent).toContain("20");
  expect(card.textContent).toContain("归入「daemon」");
  expect(card.textContent).toContain("后端知识");
  expect(card.textContent).toContain("归入「backend」");
  // unmapped：无害说明，不给按钮
  expect(card.textContent).toContain("早期遗留 699 条");
  expect(card.textContent).toContain("可以不处理");
  expect(screen.queryByTestId("redomain-go-unmapped")).toBeNull();
  // 三个已知池各一枚归位按钮
  expect(screen.getByTestId("redomain-go-auto-sillyhub-daemon")).toBeInTheDocument();
  expect(screen.getByTestId("redomain-go-auto-backend")).toBeInTheDocument();
  expect(screen.getByTestId("redomain-go-auto-frontend")).toBeInTheDocument();
});

it("说明型信号（rot/inbox）用人话，不再出现 CLI 命令字样", async () => {
  mocked.mockResolvedValue({
    healthy: false,
    signals: [
      { kind: "rot", title: "rot 待复核批量标记（260 条 > 100）", count: 260, detail: "lib-api 64、daemon 52", suggestion: "批量复核" },
      { kind: "inbox", title: "知识收件箱积压（40 条 > 20）", count: 40, detail: "install.sh 改动需重建镜像 等", suggestion: "sillyspec knowledge inbox 逐条 classify 清账" },
    ],
    totals: { rot: 260, inbox: 40, pseudo: 0 },
  });
  renderCards();
  await waitFor(() => expect(screen.getByTestId("governance-card-rot")).toBeInTheDocument());
  const rotCard = screen.getByTestId("governance-card-rot");
  expect(rotCard.textContent).toContain("规则待复核");
  expect(rotCard.textContent).toContain("不影响日常使用");
  const inboxCard = screen.getByTestId("governance-card-inbox");
  expect(inboxCard.textContent).toContain("经验待归类");
  expect(inboxCard.textContent).toContain("AI 会话");
  // 人话改版验收：卡片正文不再把 CLI 命令当处置指引展示
  expect(inboxCard.textContent).not.toContain("sillyspec knowledge");
  expect(screen.getByTestId("governance-cards").textContent).toContain("2 项可以整理");
});

it("一键归位：Popconfirm 确认后以预填的 from/to 调 redomain，成功有反馈", async () => {
  actionMocked.mockResolvedValue({ output: "🔧 已迁移 20 条 → fr/daemon.md" });
  mocked.mockResolvedValue({
    healthy: false,
    signals: [
      { kind: "pseudo-domain", title: "伪域", count: 20, detail: "auto-sillyhub-daemon 20", suggestion: "迁移" },
    ],
    totals: { pseudo: 20 },
    source: "daemon-rpc",
    actions_available: true,
  });
  renderCards();
  fireEvent.click(await screen.findByTestId("redomain-go-auto-sillyhub-daemon"));
  fireEvent.click(await screen.findByRole("button", { name: "确认归位" }));
  await waitFor(() =>
    expect(actionMocked).toHaveBeenCalledWith("ws-1", {
      kind: "redomain",
      from_domain: "auto-sillyhub-daemon",
      to_domain: "daemon",
    }),
  );
  await waitFor(() =>
    expect(screen.getByTestId("governance-action-result").textContent).toContain("已完成"),
  );
});

it("binding-unresolved：一键修复路径（repair-paths）", async () => {
  actionMocked.mockResolvedValue({ output: "repaired" });
  mocked.mockResolvedValue({
    healthy: false,
    signals: [
      { kind: "binding-unresolved", title: "坏绑定", count: 1, detail: "FR-cli-entry-091", suggestion: "repair" },
    ],
    totals: {},
    source: "daemon-rpc",
    actions_available: true,
  });
  renderCards();
  fireEvent.click(await screen.findByTestId("repair-paths-btn"));
  fireEvent.click(await screen.findByRole("button", { name: "一键修复" }));
  await waitFor(() => expect(actionMocked).toHaveBeenCalledWith("ws-1", { kind: "repair-paths" }));
});

it("local 模式（actions_available=false）：无按钮，给守护进程在线提示", async () => {
  mocked.mockResolvedValue({
    healthy: false,
    signals: [{ kind: "pseudo-domain", title: "伪域", count: 3, detail: "auto-backend 3", suggestion: "迁移" }],
    totals: { pseudo: 3 },
    source: "local",
    actions_available: false,
  });
  renderCards();
  await waitFor(() => expect(screen.getByTestId("governance-card-pseudo-domain")).toBeInTheDocument());
  expect(screen.queryByTestId("redomain-go-auto-backend")).toBeNull();
  expect(screen.getByTestId("governance-card-pseudo-domain").textContent).toContain("守护进程在线");
});

it("请求失败：轻量降态不渲染卡", async () => {
  mocked.mockRejectedValue(new Error("boom"));
  renderCards();
  await waitFor(() => expect(screen.getByTestId("governance-cards").textContent).toContain("暂不可用"));
});
