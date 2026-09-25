/** Display only: keep the original IANA identifier for storage and date formatting. */
export function timeZoneLabel(timeZone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longGeneric",
    });
    const canonical = formatter.resolvedOptions().timeZone;
    if (canonical === "UTC") return "UTC";
    const name = formatter
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value;
    if (!name) return timeZone;
    const city =
      canonical.includes("/") && !canonical.startsWith("Etc/")
        ? canonical.split("/").at(-1)!.replaceAll("_", " ")
        : null;
    return city && !name.includes(city) ? `${name} (${city})` : name;
  } catch {
    return timeZone;
  }
}
