import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmailSetupGuide } from "../src/client/features/settings/EmailSetupGuide";
import { Workspace } from "../src/client/app/Workspace";
import {
  ownerDestination,
  settingsPath,
  type SettingsSection,
} from "../src/client/lib/navigation/settings-location";
import { SettingsLayout } from "../src/client/features/settings/SettingsLayout";

describe("post-installation settings", () => {
  it("points email help to the local test panel, keeping first-run wording in the wizard", () => {
    const settings = renderToStaticMarkup(
      createElement(EmailSetupGuide, {
        verificationLabel: "Test email delivery",
      }),
    );
    expect(settings).toContain("Test email delivery");
    expect(settings).not.toContain("Verify your inbox");
    const wizard = renderToStaticMarkup(createElement(EmailSetupGuide));
    expect(wizard).toContain("Verify your inbox");
  });
  it.each<SettingsSection>(["appearance", "email", "google", "payments"])(
    "keeps the %s section in a reloadable URL",
    (section) => {
      const path = settingsPath(section);
      expect(ownerDestination(path)).toEqual({ path, section });
      expect(ownerDestination(`${path}/`)).toEqual({ path, section });
    },
  );
  it.each(["/app/settings", "/app/settings/", "/app/settings/unknown"])(
    "defaults %s to appearance",
    (path) => {
      expect(ownerDestination(path)).toEqual({
        path: "/app/settings/appearance",
        section: "appearance",
      });
    },
  );
  it.each([
    "/",
    "/setup",
    "/login",
    "/app",
    "https://other.example/app/settings/email",
  ])(
    "sends an already-ready owner at %s to the workspace, never the wizard",
    (path) => {
      expect(ownerDestination(path)).toEqual({
        path: "/app/bookings",
        section: null,
      });
    },
  );
  it.each<SettingsSection>(["appearance", "email", "google", "payments"])(
    "renders %s as ordinary settings, without first-run controls",
    (section) => {
      const html = renderToStaticMarkup(
        createElement(SettingsLayout, {
          section,
          busy: false,
          navigate: () => {},
          children: "Current settings form",
        }),
      );
      expect(html).toContain('aria-label="Settings categories"');
      expect(html).toContain('aria-current="page"');
      expect(html).not.toContain("Back to workspace");
      expect(html).not.toContain("<aside");
      expect(html).not.toContain("<select");
      expect(html).toContain("Current settings form");
      expect(html).not.toMatch(
        /Setup steps|Next step|Finish setup|First-run setup|Verify inbox &amp; create owner/,
      );
    },
  );
  it("renders settings within the usual owner sidebar and mobile menu", () => {
    const html = renderToStaticMarkup(
      createElement(Workspace, {
        session: {
          role: "owner",
          user: { name: "Sitter", email: "owner@example.test" },
        },
        openSettings: () => {},
        recheckAccess: async () => {},
        settings: {
          busy: false,
          leave: () => {},
          content: createElement(SettingsLayout, {
            section: "appearance",
            busy: false,
            navigate: () => {},
            children: "Current settings form",
          }),
        },
      }),
    );
    expect(html).toContain('aria-label="Workspace sections"');
    expect(html).toContain('aria-label="Workspace section"');
    expect(html).toContain(
      '<option value="settings" selected="">Settings</option>',
    );
    expect(html).toContain("Bookings");
    expect(html).toContain("Clients &amp; pets");
    expect(html).toContain("Services &amp; rates");
    expect(html).toContain("Current settings form");
    expect(html.match(/<aside\b/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).not.toContain("Back to workspace");
    expect(html).not.toContain("Loading your workspace");
    expect(html).not.toContain("Refresh workspace");
  });
  it("never displays owner settings in the client shell", () => {
    const html = renderToStaticMarkup(
      createElement(Workspace, {
        session: {
          role: "client",
          user: { name: "Client", email: "client@example.test" },
        },
        openSettings: () => {},
        recheckAccess: async () => {},
        settings: {
          busy: false,
          leave: () => {},
          content: "Owner-only settings",
        },
      }),
    );
    expect(html).toContain('aria-label="Client portal"');
    expect(html).not.toContain('value="settings"');
    expect(html).not.toContain("Owner-only settings");
    expect(html).not.toContain("Refresh workspace");
  });
  it("keeps settings save feedback inside the page", () => {
    const html = renderToStaticMarkup(
      createElement(SettingsLayout, {
        section: "appearance",
        busy: false,
        navigate: () => {},
        children: null,
        message: "Changes saved.",
        error: "Reload before saving.",
      }),
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("Changes saved.");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Reload before saving.");
  });
});
