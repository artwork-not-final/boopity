import { Children, createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { InvitationWelcome } from "../src/client/features/auth/InvitationWelcome";
import { Button } from "../src/client/components/ui/button";

const defaults = {
  businessName: "Maple Paws",
  signedInEmail: "alex@example.test",
  invitedEmail: "alex@example.test" as string | null,
  busy: false,
  onAccept: vi.fn(),
  onSwitchAccount: vi.fn(),
};
function render(changes: Partial<typeof defaults> = {}) {
  return renderToStaticMarkup(
    createElement(InvitationWelcome, { ...defaults, ...changes }),
  );
}

describe("client invitation welcome", () => {
  it("welcomes the client with the business name and one clear acceptance action", () => {
    const html = render();
    expect(html).toContain("Welcome to Maple Paws");
    expect(html).toContain("View your pets and manage bookings");
    expect(html).toContain("Accept invitation");
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).not.toMatch(
      /alex@example.test|Signed in as|Invitation for|Join your household/,
    );
  });
  it("matches email casing without displaying redundant account details", () => {
    expect(render({ signedInEmail: "Alex@Example.Test" })).toContain(
      "Accept invitation",
    );
  });
  it("explains the wrong-account case without offering an acceptance that will fail", () => {
    const html = render({ signedInEmail: "other@example.test" });
    expect(html).toContain("Use your invited email");
    expect(html).toContain("Switch accounts to continue");
    expect(html.match(/alex@example.test/g)).toHaveLength(1);
    expect(html.match(/other@example.test/g)).toHaveLength(1);
    expect(html).toContain("Use another email");
    expect(html).not.toContain("Accept invitation");
  });
  it("gives a next step when no usable invitation is available", () => {
    const html = render({ invitedEmail: null });
    expect(html).toContain("Open your invitation");
    expect(html).toContain("ask them for a new one");
    expect(html).not.toContain("Accept invitation");
    expect(html).not.toContain("alex@example.test");
  });
  it("disables both actions while a request is pending", () => {
    expect(
      render({ busy: true }).match(/<button\b[^>]*disabled=""/g),
    ).toHaveLength(2);
  });
  it("accepts only on the explicit action and offers a separate account switch", () => {
    const onAccept = vi.fn(),
      onSwitchAccount = vi.fn();
    const card = InvitationWelcome({ ...defaults, onAccept, onSwitchAccount });
    const actions: (() => void)[] = [];
    const visit = (node: ReactNode) => {
      if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(node))
        return;
      if (node.type === Button && node.props.onClick)
        actions.push(node.props.onClick);
      Children.forEach(node.props.children, visit);
    };
    visit(card);
    expect(onAccept).not.toHaveBeenCalled();
    expect(actions).toHaveLength(2);
    actions[0]();
    expect(onAccept).toHaveBeenCalledOnce();
    expect(onSwitchAccount).not.toHaveBeenCalled();
    actions[1]();
    expect(onSwitchAccount).toHaveBeenCalledOnce();
  });
  it("escapes business names instead of rendering supplied markup", () => {
    const html = render({ businessName: "<script>example</script>" });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
  it("uses a centered, narrow card with grouped copy and stacked full-width actions", () => {
    const html = render();
    expect(html).toContain("mx-auto w-full max-w-md gap-0");
    expect(html).toContain("p-6 text-center sm:p-8");
    expect(html).toContain("mt-6 flex flex-col gap-2");
    expect(html).toContain('data-variant="link"');
    expect(html.match(/min-h-11 w-full/g)).toHaveLength(2);
    expect(html).not.toContain('data-slot="card-header"');
  });
  it("keeps errors with the invitation and escapes provider messages", () => {
    const html = renderToStaticMarkup(
      createElement(InvitationWelcome, {
        ...defaults,
        error: "Invitation expired. <script>private</script>",
      }),
    );
    expect(html.match(/role="alert"/g)).toHaveLength(1);
    expect(html).toContain("Invitation expired. &lt;script&gt;");
    expect(html.indexOf('role="alert"')).toBeLessThan(
      html.indexOf("Accept invitation"),
    );
    expect(html).not.toContain("<script>");
    expect(render()).not.toContain('role="alert"');
  });
  it("uses one primary account-switch action for a mismatched invitation", () => {
    const html = render({ signedInEmail: "other@example.test" });
    expect(html.match(/<button\b/g)).toHaveLength(1);
    expect(html).toContain('data-variant="default"');
  });
});
