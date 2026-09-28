/**
 * GovernanceCards 组件测试（2026-09-27-knowledge-governance-cards；
 * 2026-09-28-knowledge-gov-ux 人话改版；-detail 二轮：查看明细 + AI 指令入口）。
 *
 * 覆盖：healthy 人话安语；伪域分池（推荐去向预填 / unmapped 无按钮 / 查看明细
 * 深链）；一键归位（Popconfirm → redomain 预填参数）与一键修复（repair-paths）；
 * rot/inbox 处理入口（复制 AI 指令：clipboard 成功反馈 / 失败内联降级 + 分域查看
 * 链接）；binding 锚点明细；local 模式按钮隐藏；请求失败降态。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GovernanceCards } from "@/components/knowledge/governance-cards";

// 惯例（仿 distill-task-bar.test.tsx）：vi.hoisted + importActual 部分 mock
const { mocked, actionMocked, pushMocked } = vi.hoisted(() => ({
  mocked: vi.fn(),
  actionMocked: vi.fn(),
  pushMocked: vi.fn(),
}));
vi.mock("@/lib/knowledge", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/knowledge")>()),
  getKnowledgeGovernance: mocked,
  postKnowledgeGovernanceAction: actionMocked,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMocked }),
}));

function renderCards() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GovernanceCards workspaceId="ws-1" />
    </QueryClientProvider>,
  );
}

const writeTextMock = vi.fn();

beforeEach(() => {
  pushMocked.mockClear();
  writeTextMock.mockReset();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: writeTextMock },
  });
});

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
  // unmapped：无害说明，不给归位按钮
  expect(card.textContent).toContain("早期遗留 699 条");
  expect(card.textContent).toContain("可以不处理");
  expect(screen.queryByTestId("redomain-go-unmapped")).toBeNull();
  // 三个已知池各一枚归位按钮
  expect(screen.getByTestId("redomain-go-auto-sillyhub-daemon")).toBeInTheDocument();
  expect(screen.getByTestId("redomain-go-auto-backend")).toBeInTheDocument();
  expect(screen.getByTestId("redomain-go-auto-frontend")).toBeInTheDocument();
});

it("伪域分池查看明细：深链到本页对应知识文件（含 unmapped 与未知池）", async () => {
  mocked.mockResolvedValue({
    healthy: false,
    signals: [
      {
        kind: "pseudo-domain",
        title: "伪域",
        count: 21,
        detail: "auto-backend 14、auto-round5 4、unmapped 3",
        suggestion: "迁移",
      },
    ],
    totals: { pseudo: 21 },
    source: "daemon-rpc",
    actions_available: true,
  });
  renderCards();
  fireEvent.click(await screen.findByTestId("view-fr-auto-backend"));
  expect(pushMocked).toHaveBeenCalledWith(
    `/workspaces/ws-1/knowledge?file=${encodeURIComponent("fr/auto-backend.md")}`,
  );
  // 未知池（暂无推荐去向）也可查看
  fireEvent.click(screen.getByTestId("view-fr-auto-round5"));
  expect(pushMocked).toHaveBeenCalledWith(
    `/workspaces/ws-1/knowledge?file=${encodeURIComponent("fr/auto-round5.md")}`,
  );
  // unmapped 同样给查看入口（看得到才能处置）
  fireEvent.click(screen.getByTestId("view-fr-unmapped"));
  expect(pushMocked).toHaveBeenCalledWith(
    `/workspaces/ws-1/knowledge?file=${encodeURIComponent("fr/unmapped.md")}`,
  );
});

it("rot：分域查看链接 + 复制 AI 指令（含分布与计数）成功反馈", async () => {
  writeTextMock.mockResolvedValue(undefined);
  mocked.mockResolvedValue({
    healthy: false,
    signals: [
      { kind: "rot", title: "rot（364 条 > 100）", count: 364, detail: "lib-api 64、daemon 52", suggestion: "批量复核" },
    ],
    totals: { rot: 364 },
  });
  renderCards();
  // 分域查看链接
  fireEvent.click(await screen.findByTestId("view-fr-lib-api"));
  expect(pushMocked).toHaveBeenCalledWith(
    `/workspaces/ws-1/knowledge?file=${encodeURIComponent("fr/lib-api.md")}`,
  );
  // 复制处理指令：内容含总数与分布
  fireEvent.click(screen.getByTestId("copy-ai-prompt-rot"));
  await waitFor(() => expect(writeTextMock).toHaveBeenCalledTimes(1));
  expect(writeTextMock.mock.calls[0]![0]).toContain("共 364 条");
  expect(writeTextMock.mock.calls[0]![0]).toContain("lib-api 64");
  expect(screen.getByTestId("copy-ai-prompt-result").textContent).toContain("已复制");
});

it("inbox：查看明细深链 uncategorized.md + 复制 AI 指令；clipboard 失败内联降级", async () => {
  writeTextMock.mockRejectedValue(new Error("no clipboard"));
  mocked.mockResolvedValue({
    healthy: false,
    signals: [
      { kind: "inbox", title: "收件箱积压（39 条 > 20）", count: 39, detail: "install.sh 改动需重建镜像 等", suggestion: "classify" },
    ],
    totals: { inbox: 39 },
  });
  renderCards();
  fireEvent.click(await screen.findByTestId("view-inbox-file"));
  expect(pushMocked).toHaveBeenCalledWith(
    `/workspaces/ws-1/knowledge?file=${encodeURIComponent("uncategorized.md")}`,
  );
  // 复制失败 → 内联展示提示词供手动复制
  fireEvent.click(screen.getByTestId("copy-ai-prompt-inbox"));
  await waitFor(() => expect(screen.getByTestId("copy-ai-prompt-fallback")).toBeInTheDocument());
  expect(screen.getByTestId("copy-ai-prompt-fallback").textContent).toContain("uncategorized.md");
});

it("说明型信号用人话，不再出现 CLI 命令字样当处置指引", async () => {
  mocked.mockResolvedValue({
    healthy: false,
    signals: [
      { kind: "rot", title: "rot（260 条 > 100）", count: 260, detail: "lib-api 64、daemon 52", suggestion: "批量复核" },
      { kind: "inbox", title: "收件箱积压（40 条 > 20）", count: 40, detail: "install.sh 等", suggestion: "sillyspec knowledge inbox 逐条 classify 清账" },
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

it("binding-unresolved：锚点明细可见 + 一键修复路径（repair-paths）", async () => {
  actionMocked.mockResolvedValue({ output: "repaired" });
  mocked.mockResolvedValue({
    healthy: false,
    signals: [
      { kind: "binding-unresolved", title: "坏绑定", count: 3, detail: "FR-cli-091、FR-styles-014、FR-types-002", suggestion: "repair" },
    ],
    totals: {},
    source: "daemon-rpc",
    actions_available: true,
  });
  renderCards();
  await waitFor(() => expect(screen.getByTestId("governance-binding-detail").textContent).toContain("FR-cli-091"));
  fireEvent.click(await screen.findByTestId("repair-paths-btn"));
  fireEvent.click(await screen.findByRole("button", { name: "一键修复" }));
  await waitFor(() => expect(actionMocked).toHaveBeenCalledWith("ws-1", { kind: "repair-paths" }));
});

it("local 模式（actions_available=false）：无归位按钮，给守护进程在线提示（查看链接仍在）", async () => {
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
  // 查看明细不依赖 daemon 在线，仍可用
  expect(screen.getByTestId("view-fr-auto-backend")).toBeInTheDocument();
});

it("请求失败：轻量降态不渲染卡", async () => {
  mocked.mockRejectedValue(new Error("boom"));
  renderCards();
  await waitFor(() => expect(screen.getByTestId("governance-cards").textContent).toContain("暂不可用"));
});
