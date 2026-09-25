export const dateLabel = (
  date: string,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
) =>
  new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00Z`),
  );
