import { describe, expect, it } from "vitest";
import { readSetupLink, setupLink } from "../src/shared/setup-link";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmailSetupGuide } from "../src/client/EmailSetupGuide";

const token = "synthetic-setup-link-0000000000000000000000000";
describe("private wizard entry", () => {
  it("puts the credential only in a fragment on the configured installation", () => {
    const url = new URL(setupLink("https://care.example.test", token));
    expect(url.origin).toBe("https://care.example.test");
    expect(url.pathname).toBe("/setup");
    expect(url.search).toBe("");
    expect(url.origin + url.pathname + url.search).not.toContain(token);
    expect(readSetupLink(url.hash)).toEqual({ present: true, token });
  });
  it("does not mistake ordinary navigation, invitations or recovery for setup", () => {
    for (const value of [
      "",
      "#appearance",
      "#invite=private",
      "#recovery=private",
    ])
      expect(readSetupLink(value)).toEqual({ present: false, token: null });
  });
  it.each([
    "#setup=",
    "#setup=short",
    `#setup=${"a".repeat(257)}`,
    `#setup=${token}&setup=${token}`,
    `#setup=${token}&invite=private`,
    `#setup=${token}%0A`,
    "#setup=%3Cscript%3E",
    "#setup=%ZZ",
  ])("rejects malformed or ambiguous fragments: case %#", (value) => {
    expect(readSetupLink(value)).toEqual({ present: true, token: null });
  });
  it("does not construct a link with an arbitrary secret or fragment injection", () => {
    expect(() => setupLink("https://care.example.test", "short")).toThrow();
    expect(() =>
      setupLink("https://care.example.test", token + "&invite=other"),
    ).toThrow();
  });
  it("includes both DIY provider guides and the explicit delivery test", () => {
    const html = renderToStaticMarkup(createElement(EmailSetupGuide));
    for (const instruction of [
      "Boopity emails sign-in codes to you and your clients.",
      "Using Resend",
      "Using another provider (SMTP)",
      "Verify your inbox",
      "send a code and check it arrives",
      "sending-only API key",
      "Keep existing email DNS records",
      "secure SMTP connection with a password",
    ])
      expect(html).toContain(instruction);
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<script");
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it("keeps provider instructions and troubleshooting collapsed until requested", () => {
    const html = renderToStaticMarkup(createElement(EmailSetupGuide));
    const introduction = html.slice(0, html.indexOf("<details"));
    expect(introduction).toContain("Boopity emails sign-in codes");
    expect(introduction).toContain("Connect an email service below");
    expect(html).not.toContain("Email setup help");
    expect(html.match(/<details\b/g)).toHaveLength(3);
    expect(html).not.toMatch(/<details\b[^>]*\bopen(?:\s|=|>)/);
    expect(html.match(/<summary\b/g)).toHaveLength(3);
    expect(html).toContain("Code not arriving?");
    expect(html).not.toContain("Help me connect email");
    expect(html).not.toContain("Provider acceptance");
  });
});
