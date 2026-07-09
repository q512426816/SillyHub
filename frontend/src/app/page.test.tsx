import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

import HomePage from "@/app/page";
import { useSession } from "@/stores/session";

// ── next/navigation mock ────────────────────────────────────────────────────
const nav = {
  replace: vi.fn(),
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), refresh: vi.fn() }),
}));

describe("HomePage 落地页分流", () => {
  beforeEach(() => {
    nav.replace = vi.fn();
  });

  afterEach(() => {
    useSession.setState({
      hydrated: false,
      accessToken: null,
      refreshToken: null,
      user: null,
    } as never);
  });

  it("未登录：hydrated 后 redirect 到 /login", async () => {
    useSession.setState({ accessToken: null, hydrated: true } as never);

    render(<HomePage />);

    await waitFor(() => {
      expect(nav.replace).toHaveBeenCalledWith("/login");
    });
    expect(nav.replace).not.toHaveBeenCalledWith("/workspaces");
  });

  it("登录态：hydrated 后 redirect 到 /workspaces", async () => {
    useSession.setState({ accessToken: "tok", hydrated: true } as never);

    render(<HomePage />);

    await waitFor(() => {
      expect(nav.replace).toHaveBeenCalledWith("/workspaces");
    });
    expect(nav.replace).not.toHaveBeenCalledWith("/login");
  });

  it("persist 未恢复（hydrated=false）：不跳转，避免首帧误判", () => {
    useSession.setState({ accessToken: null, hydrated: false } as never);

    render(<HomePage />);

    expect(nav.replace).not.toHaveBeenCalled();
  });
});
