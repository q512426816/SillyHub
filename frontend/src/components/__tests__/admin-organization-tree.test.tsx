import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { AdminOrganizationTree } from "@/components/admin-organization-tree";
import type { OrganizationRead } from "@/lib/admin";

function makeOrg(
  id: string,
  name: string,
  parentId: string | null = null,
  extra: Partial<OrganizationRead> = {},
): OrganizationRead {
  return {
    id,
    name,
    code: name.toLowerCase(),
    description: null,
    parent_id: parentId,
    status: "active",
    sort_order: 0,
    member_count: 0,
    children_count: 0,
    subtree_member_count: 0,
    created_at: "",
    updated_at: "",
    ...extra,
  };
}

const FIXTURE: OrganizationRead[] = [
  makeOrg("hq", "HQ"),
  makeOrg("eng", "Engineering", "hq"),
  makeOrg("qa", "QA", "hq"),
  makeOrg("fe", "Frontend", "eng"),
  makeOrg("be", "Backend", "eng"),
];

describe("AdminOrganizationTree", () => {
  it("renders nested tree from flat list", () => {
    render(
      <AdminOrganizationTree
        nodes={FIXTURE}
        selectedId={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText(/HQ/)).toBeInTheDocument();
    expect(screen.getByText(/Engineering/)).toBeInTheDocument();
    expect(screen.getByText(/QA/)).toBeInTheDocument();
    // Children rendered because root defaults to expanded
    expect(screen.getByText(/Frontend/)).toBeInTheDocument();
    expect(screen.getByText(/Backend/)).toBeInTheDocument();
  });

  it("clicking a node triggers onSelect", () => {
    const onSelect = vi.fn();
    render(
      <AdminOrganizationTree
        nodes={FIXTURE}
        selectedId={null}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByText(/QA/));
    expect(onSelect).toHaveBeenCalledWith("qa");
  });

  it("collapse arrow hides children", () => {
    render(
      <AdminOrganizationTree
        nodes={FIXTURE}
        selectedId={null}
        onSelect={() => {}}
      />,
    );
    // HQ has children → has arrow
    const hqArrow = screen.getAllByLabelText("折叠")[0]!;
    fireEvent.click(hqArrow);
    expect(screen.queryByText(/Engineering/)).not.toBeInTheDocument();
    expect(screen.queryByText(/QA/)).not.toBeInTheDocument();
  });

  it("selectedId highlights the corresponding node", () => {
    render(
      <AdminOrganizationTree
        nodes={FIXTURE}
        selectedId="eng"
        onSelect={() => {}}
      />,
    );
    const eng = screen.getByText(/Engineering/).closest("div");
    expect(eng?.className).toContain("bg-primary/10");
  });

  it("searchKeyword filters + highlights matches and expands ancestors", () => {
    render(
      <AdminOrganizationTree
        nodes={FIXTURE}
        selectedId={null}
        onSelect={() => {}}
        searchKeyword="front"
      />,
    );
    expect(screen.getByText("Front")).toBeInTheDocument();
    expect(screen.getByText("end")).toBeInTheDocument();
    expect(screen.getByText(/Engineering/)).toBeInTheDocument();
    expect(screen.getByText(/HQ/)).toBeInTheDocument();
    expect(screen.queryByText(/QA/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Backend/)).not.toBeInTheDocument();
    expect(document.querySelector("mark")).not.toBeNull();
  });

  it("disabled org is greyed", () => {
    const fixture = [
      ...FIXTURE,
      makeOrg("ops", "Ops", "hq", { status: "disabled" }),
    ];
    render(
      <AdminOrganizationTree
        nodes={fixture}
        selectedId={null}
        onSelect={() => {}}
      />,
    );
    const ops = screen.getByText(/Ops/).closest("div");
    expect(ops?.className).toContain("text-muted-foreground");
  });

  it("shows empty state when no nodes", () => {
    render(
      <AdminOrganizationTree
        nodes={[]}
        selectedId={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("暂无组织")).toBeInTheDocument();
  });
});
