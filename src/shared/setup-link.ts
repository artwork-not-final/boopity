/** Setup links carry their credential in a fragment, never in the HTTP URL. */
export function readSetupLink(fragment: string) {
  const params = new URLSearchParams(fragment.replace(/^#/, ""));
  const present = params.has("setup");
  const value = params.get("setup");
  return {
    present,
    token:
      present &&
      params.getAll("setup").length === 1 &&
      !params.has("invite") &&
      value &&
      /^[A-Za-z0-9_-]{32,256}$/.test(value)
        ? value
        : null,
  };
}

export function setupLink(origin: string, token: string) {
  if (!readSetupLink(`#setup=${encodeURIComponent(token)}`).token)
    throw new Error("Invalid setup link credential");
  const url = new URL("/setup", origin);
  url.hash = new URLSearchParams({ setup: token }).toString();
  return url.href;
}
