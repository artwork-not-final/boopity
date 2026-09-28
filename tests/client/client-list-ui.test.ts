import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ClientList } from "../../src/client/features/clients/ClientList";

const client = {
  id: "client-test",
  firstName: "Alex",
  lastName: "River",
  email: "alex@example.test",
  status: "active",
  petCount: 2,
  members: 0,
  invitationExpiresAt: null as number | null,
};
function render(
  changes: Partial<typeof client> = {},
  busy = false,
  portalEnabled = true,
) {
  return renderToStaticMarkup(
    createElement(ClientList, {
      clients: [{ ...client, ...changes }],
      busy,
      portalEnabled,
      onSelect: () => {},
    }),
  );
}

describe("main client list", () => {
  it("uses flat rows with separate, keyboard-accessible client and pet actions", () => {
    const html = render();
    expect(html).toContain('aria-label="Clients"');
    expect(html.match(/<button\b/g)).toHaveLength(2);
    expect(html.match(/type="button"/g)).toHaveLength(2);
    expect(html).not.toMatch(
      /<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<button\b/,
    );
    expect(html).toContain("Open client:");
    expect(html).toContain("Pets for Alex River:");
    expect(html).not.toMatch(
      /<form\b|<input\b|Create invitation|Archive client/,
    );
    expect(html).toContain("rounded-none");
    expect(html).toContain("hover:bg-brand-soft-hover");
    expect(html).not.toContain("hover:bg-muted");
    expect(html).not.toContain("bg-accent");
  });
  it("routes the pet shortcut directly to the selected client's Pets tab", () => {
    const onSelect = vi.fn();
    const list = ClientList({
      clients: [client],
      busy: false,
      portalEnabled: true,
      onSelect,
    })!;
    const row = list.props.children[0];
    const [open, pets] = row.props.children;
    open.props.onClick();
    pets.props.onClick();
    expect(onSelect.mock.calls).toEqual([[client.id], [client.id, "pets"]]);
  });
  it("keeps contact details visible and capitalizes the client status", () => {
    const html = render();
    expect(html).toContain("Alex River");
    expect(html).toContain("alex@example.test");
    expect(html).toContain(">Active</span>");
    expect(render({ status: "lead" })).toContain(">Lead</span>");
    expect(render({ status: "archived" })).toContain(">Archived</span>");
    expect(render({ email: "" })).toContain("No email");
    expect(html).toContain("break-all");
  });
  it("handles zero, one and multiple pets without hiding the shortcut", () => {
    expect(render({ petCount: 0 })).toContain("0 pets</button>");
    expect(render({ petCount: 1 })).toContain("1 pet</button>");
    expect(render({ petCount: 121 })).toContain("121 pets</button>");
  });
  it("distinguishes active access, pending invitations and no access", () => {
    expect(render()).toContain("No portal access");
    expect(render({ members: 1 })).toContain("Portal access active");
    expect(render({ invitationExpiresAt: Date.now() + 60_000 })).toContain(
      "Invitation pending",
    );
    expect(render({ invitationExpiresAt: Date.now() - 1 })).not.toContain(
      "Invitation pending",
    );
  });
  it("does not claim clients can sign in when the portal or client is disabled", () => {
    const disabled = render({ members: 1 }, false, false);
    expect(disabled).toContain("Portal disabled");
    expect(disabled).not.toContain("Portal access active");
    for (const status of ["lead", "archived"]) {
      const html = render({
        status,
        members: 1,
        invitationExpiresAt: Date.now() + 60_000,
      });
      expect(html).toContain("No portal access");
      expect(html).not.toMatch(/Portal access active|Invitation pending/);
    }
  });
  it("disables both navigation actions while work is pending", () => {
    expect(render({}, true).match(/<button\b[^>]*disabled=""/g)).toHaveLength(
      2,
    );
  });
  it("does not render an empty outline", () => {
    expect(
      renderToStaticMarkup(
        createElement(ClientList, {
          clients: [],
          busy: false,
          portalEnabled: true,
          onSelect: () => {},
        }),
      ),
    ).toBe("");
  });
});
