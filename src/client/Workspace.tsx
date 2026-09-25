import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ClipboardList,
  PawPrint,
  Plus,
  ReceiptText,
  Settings2,
  Users,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Field, Text, Area, Hint, FormSection } from "./WorkspaceFields";
import { Clients } from "./clients/Clients";
import { HouseholdPets } from "./clients/HouseholdPets";
import { speciesLabel } from "./clients/species-label";
import type { ClientSummary, Pet } from "./clients/types";
import { money } from "./workspace-format";
import type { RunWorkspaceAction as Run } from "./workspace-types";
import { Services } from "./services/Services";
import type { Service } from "./services/types";
import { Choice } from "./Choice";
import { Panel } from "./WorkspacePanel";
import { workspaceApi as api, WorkspaceError } from "./workspace-api";
import { hasWorkspaceEditor, watchWorkspaceResume } from "./workspace-refresh";
import {
  navigateLocal,
  updateWorkspaceLocation,
  useWorkspaceLocation,
  workspaceHref,
  workspaceSection,
  type WorkspaceSection,
} from "./workspace-location";
import { timeZoneLabel } from "./time-zone-label";
import { BookingCalendar } from "./BookingCalendar";
import { BookingList } from "./BookingList";
import {
  BookingDetailHeader,
  BookingOverview,
  BookingTimeline,
  type BookingEvent,
} from "./BookingDetail";
import { Cancellations } from "./Cancellations";
import { bookingSearchTarget } from "./booking-search";
import { useBookingAvailability } from "./booking-availability";
import { BookingAvailabilityNotice } from "./BookingAvailabilityNotice";
import { bookingTime, businessToday, dateLabel } from "./booking-calendar";
import { FirstBookingGuide } from "./FirstBookingChecklist";
import type { FirstBookingStep } from "../shared/first-booking";
import type { BookingPolicy, WorkspaceSession } from "../shared/portal";
import { BookingPayments } from "./payments/BookingPayments";
import { PaymentRecords } from "./payments/PaymentRecords";
import { settingsPath } from "./SettingsLayout";
import {
  compactPage,
  VISIBLE_PAGE_SIZE,
  PageControls,
  PagedSelect,
  SearchBox,
  usePage,
} from "./Pagination";

export type Booking = {
  id: string;
  clientId: string;
  clientName?: string;
  serviceName: string;
  status: string;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  startAt: number;
  endAt: number;
  totalAmountCents: number;
  requestExpiresAt: number | null;
  version: number;
  canCancel: boolean;
  clientRequest: string;
  clientUpdate: string;
  privateNotes?: string;
  postServiceNotes?: string;
  pets: Pet[];
  policy: {
    cancelHours: number;
    timeZone: string;
    approvalMode: string;
  } | null;
  price: {
    currency: string;
    baseCents: number;
    additionalPetCents: number;
    petCount: number;
    days: number;
    pricingRule: string;
  } | null;
};
type Policy = BookingPolicy & { version: number };
type Data = {
  policy: Policy;
  regional: { timeZone: string; currency: string };
  revision: number;
};
type FormProps = { data: Data; busy: boolean; run: Run };
type FirstBookingTarget = {
  step: Exclude<FirstBookingStep, "booking">;
  clientId: string | null;
};
const days = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function Workspace({
  session,
  openSettings,
  recheckAccess,
  settings,
}: {
  session: WorkspaceSession;
  openSettings: () => void;
  recheckAccess: () => Promise<void>;
  settings?: {
    content: ReactNode;
    busy: boolean;
    leave: (path: string) => void;
  };
}) {
  const owner = session.role === "owner";
  const viewingSettings = owner && Boolean(settings);
  const location = useWorkspaceLocation();
  const tab = workspaceSection(location.section, owner);
  useEffect(() => {
    if (!viewingSettings) {
      // Client accounts never mount owner pages; paths are not authorization.
      if (
        location.section !== tab ||
        (!owner &&
          (window.location.pathname.startsWith("/app/settings") ||
            ["/login", "/register", "/setup", "/app/invitation"].includes(
              window.location.pathname,
            )))
      )
        navigateLocal(workspaceHref({ section: tab }), true);
      else if (!location.notFound) navigateLocal(workspaceHref(location), true);
    }
  }, [viewingSettings, owner, tab, location]);
  const [data, setData] = useState<Data | null>(null),
    [revision, setRevision] = useState(0);
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const resumeState = useRef({
    busy,
    viewingSettings,
    tab,
    revision,
    loaded: Boolean(data),
  });
  resumeState.current = {
    busy,
    viewingSettings,
    tab,
    revision,
    loaded: Boolean(data),
  };
  function applyPolicy(policy: { policy: Policy; regional: Data["regional"] }) {
    setData((previous) => ({
      ...policy,
      revision: (previous?.revision ?? 0) + 1,
    }));
    setRevision((value) => value + 1);
  }
  async function reload() {
    const policy = await api<{ policy: Policy; regional: Data["regional"] }>(
      "/policy",
    );
    applyPolicy(policy);
  }
  async function report(error: unknown) {
    setError(
      error instanceof Error ? error.message : "Unable to load the workspace.",
    );
    if (error instanceof WorkspaceError && [401, 403].includes(error.status)) {
      setData(null);
      await recheckAccess().catch(() => {
        setError("Unable to recheck access. Reload the page to sign in again.");
      });
    }
  }
  const reportLoadError = useEffectEvent(report);
  useEffect(() => {
    // Re-read regional and booking policy settings when returning to work.
    if (!viewingSettings) void reload().catch(reportLoadError);
  }, [viewingSettings]);
  useEffect(
    () =>
      watchWorkspaceResume({
        windowTarget: window,
        documentTarget: document,
        isVisible: () => document.visibilityState === "visible",
        isOnline: () => navigator.onLine,
        canRefresh: () => {
          const current = resumeState.current;
          return (
            current.loaded &&
            !current.busy &&
            !current.viewingSettings &&
            current.tab !== "payments" &&
            !hasWorkspaceEditor(content.current)
          );
        },
        getKey: () => JSON.stringify(resumeState.current),
        read: (signal) =>
          api<{ policy: Policy; regional: Data["regional"] }>(
            "/policy",
            "GET",
            undefined,
            signal,
          ),
        apply: applyPolicy,
        // Browsing data remains available after a connection failure. A later return
        // retries; explicit list errors still have their existing Retry controls.
        onError: (error) => {
          if (
            error instanceof WorkspaceError &&
            [401, 403].includes(error.status)
          )
            void reportLoadError(error);
        },
      }),
    [],
  );
  const run: Run = async (work, success = "Changes saved.") => {
    resumeState.current.busy = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
      await reload();
      setMessage(success);
    } catch (error) {
      await report(error);
    } finally {
      setBusy(false);
    }
  };
  const tabs = owner
    ? ([
        ["bookings", "Bookings", CalendarDays],
        ["clients", "Clients & pets", Users],
        ["rates", "Services & rates", PawPrint],
        ["rules", "Portal & rules", Settings2],
        ["followups", "Cancellations", ClipboardList],
        ["payments", "Payments", ReceiptText],
      ] as const)
    : ([
        ["bookings", "My bookings", CalendarDays],
        ["pets", "My pets", PawPrint],
      ] as const);
  const currentSection = viewingSettings ? "settings" : tab;
  const navigationBusy = busy || (viewingSettings && settings!.busy);
  function selectSection(value: WorkspaceSection | "settings") {
    setError("");
    setMessage("");
    if (value === "settings") {
      // Load settings before mounting editors, never over an open settings form.
      if (!viewingSettings)
        void run(async () => {
          await recheckAccess();
          openSettings();
        }, "");
    } else {
      const path = workspaceHref({ section: value });
      if (viewingSettings) settings!.leave(path);
      else navigateLocal(path);
    }
  }
  return (
    <section
      className="grid items-start gap-6 md:grid-cols-[190px_minmax(0,1fr)]"
      aria-label={owner ? "Sitter workspace" : "Client portal"}
    >
      <aside className="min-w-0 md:sticky md:top-6">
        <div className="flex gap-2 md:hidden">
          <Choice
            aria-label="Workspace section"
            value={currentSection}
            disabled={navigationBusy}
            onValueChange={(value) =>
              selectSection(value as WorkspaceSection | "settings")
            }
            options={[
              ...tabs.map(([value, label]) => ({ value, label })),
              ...(owner ? [{ value: "settings", label: "Settings" }] : []),
            ]}
          />
        </div>
        <nav
          className="hidden flex-col gap-1 md:flex"
          aria-label="Workspace sections"
        >
          {tabs.map(([value, label, Icon]) => (
            <Button
              key={value}
              className="shrink-0 justify-start whitespace-normal text-left md:w-full"
              variant={currentSection === value ? "secondary" : "ghost"}
              aria-current={currentSection === value ? "page" : undefined}
              disabled={navigationBusy}
              onClick={() => selectSection(value)}
            >
              <Icon aria-hidden="true" />
              {label}
            </Button>
          ))}
        </nav>
        {owner && (
          <div className="mt-3 hidden space-y-1 border-t pt-3 md:block">
            <Button
              className="w-full justify-start"
              variant={viewingSettings ? "secondary" : "ghost"}
              aria-current={viewingSettings ? "page" : undefined}
              disabled={navigationBusy}
              onClick={() => selectSection("settings")}
            >
              <Settings2 aria-hidden="true" />
              Settings
            </Button>
          </div>
        )}
        <p className="mt-5 hidden break-words text-xs text-muted-foreground md:block">
          {session.user.email}
        </p>
      </aside>
      <div
        ref={content}
        id="workspace-content"
        tabIndex={-1}
        data-skip-target
        className="min-w-0 space-y-4"
      >
        {!viewingSettings && (
          <h1 className="sr-only">
            {location.notFound
              ? "Page not found"
              : tabs.find(([value]) => value === tab)?.[1]}
          </h1>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-destructive bg-card p-4 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="rounded-xl border bg-card p-4 text-sm">
            {message}
          </p>
        )}
        {viewingSettings ? (
          settings!.content
        ) : location.notFound ? (
          <Panel title="Page not found">
            <Button onClick={() => selectSection("bookings")}>
              Back to bookings
            </Button>
          </Panel>
        ) : !data ? (
          <Panel title="Loading your workspace">
            <Button
              variant="outline"
              onClick={() => void run(async () => {}, "")}
            >
              Retry
            </Button>
          </Panel>
        ) : (
          <>
            {tab === "bookings" && (
              <Bookings
                key={session.user.email}
                data={data}
                owner={owner}
                busy={busy}
                run={run}
                revision={revision}
                onError={report}
                ownerEmail={session.user.email}
                onFirstBookingStep={(step, clientId) => {
                  navigateLocal(
                    workspaceHref(
                      step === "service"
                        ? { section: "rates", service: "new" }
                        : {
                            section: "clients",
                            client: step === "client" ? "new" : clientId,
                            clientTab: step === "pet" ? "pets" : "contact",
                          },
                    ),
                  );
                }}
                onPayments={() => navigateLocal(settingsPath("payments"))}
              />
            )}
            {tab === "clients" && (
              <Clients
                revision={data.revision}
                portalEnabled={data.policy.portalEnabled}
                busy={busy}
                run={run}
              />
            )}
            {tab === "rates" && (
              <Services
                revision={data.revision}
                currency={data.regional.currency}
                busy={busy}
                run={run}
              />
            )}
            {tab === "rules" && (
              <Rules
                key={data.policy.version}
                data={data}
                busy={busy}
                run={run}
              />
            )}
            {tab === "followups" && (
              <Cancellations
                revision={data.revision}
                timeZone={data.regional.timeZone}
                busy={busy}
                run={run}
              />
            )}
            {tab === "payments" && (
              <PaymentRecords
                revision={data.revision}
                timeZone={data.regional.timeZone}
                currency={data.regional.currency}
              />
            )}
            {tab === "pets" && <HouseholdPets revision={data.revision} />}
          </>
        )}
      </div>
    </section>
  );
}

function Bookings({
  data,
  owner,
  busy,
  run,
  revision,
  onError,
  ownerEmail,
  onFirstBookingStep,
  onPayments,
}: FormProps & {
  owner: boolean;
  revision: number;
  onError: (error: unknown) => Promise<void>;
  ownerEmail: string;
  onFirstBookingStep: (
    step: FirstBookingTarget["step"],
    clientId: string | null,
  ) => void;
  onPayments: () => void;
}) {
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [status, setStatus] = useState("all");
  const location = useWorkspaceLocation();
  const selected = location.booking;
  const adding = selected === "new";
  const view = location.view;
  const anchor = location.date ?? businessToday(data.regional.timeZone);
  const setSelected = (booking: string | null) =>
    updateWorkspaceLocation({ booking, bookingTab: "overview" });
  const setAdding = (value: boolean) => setSelected(value ? "new" : null);
  const setView = (value: "week" | "month" | "list") =>
    updateWorkspaceLocation({ view: value });
  const setAnchor = (date: string) => updateWorkspaceLocation({ date });
  const params = new URLSearchParams({
    status,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  });
  const page = usePage<{ bookings: Booking[] }>(
    `/bookings?${params}`,
    revision,
    view === "list",
  );
  const bookings = page.data?.bookings ?? [];
  if (adding)
    return (
      <div className="space-y-6" data-refresh-paused>
        <Button
          className="-ml-3 min-h-11"
          disabled={busy}
          variant="ghost"
          onClick={() => setAdding(false)}
        >
          <ArrowLeft aria-hidden="true" />
          Back to bookings
        </Button>
        <NewBooking
          data={data}
          owner={owner}
          busy={busy}
          run={run}
          done={setSelected}
        />
      </div>
    );
  if (selected)
    return (
      <BookingDetails
        key={selected}
        id={selected}
        data={data}
        owner={owner}
        busy={busy}
        run={run}
        close={() => setSelected(null)}
        onError={onError}
      />
    );
  return (
    <div className="space-y-6">
      {owner && (
        <FirstBookingGuide
          ownerEmail={ownerEmail}
          revision={revision}
          busy={busy}
          onError={onError}
          onPayments={onPayments}
          onChoose={(step, clientId) => {
            if (step === "booking") setAdding(true);
            else onFirstBookingStep(step, clientId);
          }}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">
            {owner ? "Bookings" : "My bookings"}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {timeZoneLabel(data.regional.timeZone)}{" "}
            {owner ? "" : `· ${data.policy.leadHours} hours’ notice required`}
          </p>
        </div>
        <Button
          className="min-h-11"
          disabled={busy}
          onClick={() => setAdding(true)}
        >
          <Plus aria-hidden="true" />
          {owner ? "New booking" : "Request a booking"}
        </Button>
      </div>
      <nav
        aria-label="Booking view"
        className="inline-grid grid-cols-3 gap-1 rounded-xl bg-muted p-1"
      >
        {(["week", "month", "list"] as const).map((value) => (
          <Button
            key={value}
            variant="ghost"
            disabled={busy}
            aria-pressed={view === value}
            className={`min-h-11 px-5 hover:text-foreground ${view === value ? "bg-card text-foreground shadow-sm hover:bg-card dark:hover:bg-card" : "text-muted-foreground hover:bg-card/70 dark:hover:bg-card/70"}`}
            onClick={() => setView(value)}
          >
            {value.charAt(0).toUpperCase() + value.slice(1)}
          </Button>
        ))}
      </nav>
      <div className="grid items-end gap-5 rounded-xl border bg-card p-5 sm:grid-cols-2 sm:p-6">
        <SearchBox
          label={
            owner
              ? "Search by client, pet, or service"
              : "Search by pet or service"
          }
          onSearch={(text) => {
            const target = bookingSearchTarget(text, { view, from, to });
            setView(target.view);
            setFrom(target.from);
            setTo(target.to);
            page.search(target.search);
          }}
          initialValue={page.term}
        />
        <Field label="Booking status">
          {(id) => (
            <Choice
              id={id}
              value={status}
              onValueChange={(value) => {
                setStatus(value);
                page.reset();
              }}
              options={[
                ["all", "All bookings"],
                ["requested", "Requested"],
                ["active", "Confirmed"],
                ["completed", "Completed"],
                ["cancelled", "Cancelled"],
                ["declined", "Declined"],
                ["expired", "Expired"],
              ].map(([value, label]) => ({ value, label }))}
            />
          )}
        </Field>
        {view === "list" && (
          <>
            <Text
              label="Bookings from"
              type="date"
              value={from}
              onChange={(v) => {
                setFrom(v);
                page.reset();
              }}
            />
            <Text
              label="Bookings through"
              type="date"
              value={to}
              onChange={(v) => {
                setTo(v);
                page.reset();
              }}
            />
          </>
        )}
      </div>
      {view !== "list" ? (
        <BookingCalendar
          view={view}
          anchor={anchor}
          onAnchor={setAnchor}
          timeZone={data.regional.timeZone}
          status={status}
          search={page.term}
          revision={revision}
          owner={owner}
          busy={busy}
          onSelect={setSelected}
        />
      ) : (
        <>
          <BookingList
            bookings={bookings.slice(0, VISIBLE_PAGE_SIZE)}
            owner={owner}
            busy={busy}
            currency={data.regional.currency}
            timeZone={data.regional.timeZone}
            onSelect={setSelected}
          />
          {page.data && !bookings.length && <Hint>No bookings found.</Hint>}
          {(page.error ||
            page.loading ||
            page.offset > 0 ||
            compactPage(page.data?.pagination, bookings.length)?.hasMore) && (
            <PageControls
              label="bookings"
              {...page}
              pagination={compactPage(page.data?.pagination, bookings.length)}
            />
          )}
        </>
      )}
    </div>
  );
}
export function NewBooking({
  data,
  owner,
  busy,
  run,
  done,
}: FormProps & { owner: boolean; done: (id: string) => void }) {
  const [client, setClient] = useState<ClientSummary | null>(null),
    [service, setService] = useState<Service | null>(null),
    [selectedPets, setSelectedPets] = useState<Pet[]>([]);
  const clientId = client?.id ?? "",
    serviceId = service?.id ?? "",
    petIds = selectedPets.map((p) => p.id);
  const [date, setDate] = useState(""),
    [endDate, setEndDate] = useState(""),
    [time, setTime] = useState(""),
    [message, setMessage] = useState("");
  const [requestId] = useState(() => crypto.randomUUID());
  const availability = useBookingAvailability({
    owner,
    serviceId,
    durationMinutes: service?.durationMinutes,
    date,
    endDate,
    time,
    timeZone: data.regional.timeZone,
    revision: data.revision,
  });
  const { slots, error: slotError, historical, directTime } = availability;
  const hasSelectedSlot = Boolean(
    slots?.some(
      (slot) =>
        slot.startTime === (service?.durationMinutes === null ? null : time),
    ),
  );
  useEffect(() => {
    setTime("");
  }, [serviceId, date]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (
      busy ||
      !hasSelectedSlot ||
      !petIds.length ||
      (service?.durationMinutes !== null && !time)
    )
      return;
    void run(
      async () => {
        const response = await api<{ booking: Booking }>("/bookings", "POST", {
          requestId,
          ...(owner ? { clientId } : {}),
          serviceId,
          petIds,
          startDate: date,
          ...(service?.durationMinutes === null
            ? { endDate }
            : { startTime: time }),
          message,
        });
        done(response.booking.id);
      },
      historical
        ? "Past booking recorded. No payment was recorded."
        : "Booking saved. Review its confirmation or approval status below.",
    );
  };
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold tracking-tight">
        {owner ? "New booking" : "Request a booking"}
      </h2>
      <form
        aria-label={owner ? "New booking" : "Request a booking"}
        className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px]"
        onSubmit={submit}
      >
        <div className="min-w-0 space-y-6">
          <FormSection title={owner ? "Client & pets" : "Your pets"}>
            {owner && (
              <PagedSelect<ClientSummary>
                compact
                disabled={busy}
                label="Client"
                path="/owner/clients?status=active"
                collection="clients"
                selected={client}
                onSelect={(value) => {
                  setClient(value);
                  setSelectedPets([]);
                }}
                describe={(value) => `${value.firstName} ${value.lastName}`}
                revision={data.revision}
              />
            )}
            {!owner || clientId ? (
              <PetChooser
                key={clientId}
                path={
                  owner
                    ? `/owner/pets?clientId=${encodeURIComponent(clientId)}&activeOnly=true`
                    : "/pets?activeOnly=true"
                }
                selected={selectedPets}
                setSelected={setSelectedPets}
                revision={data.revision}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Choose a client to see their pets.
              </p>
            )}
          </FormSection>
          <FormSection title="Service & schedule">
            <PagedSelect<Service>
              compact
              disabled={busy}
              label="Service"
              path="/services?activeOnly=true"
              collection="services"
              selected={service}
              onSelect={setService}
              revision={data.revision}
              describe={(s) =>
                `${s.name} · ${s.durationMinutes === null ? "per day" : `${s.durationMinutes} minutes`} · from ${money(s.priceCents, data.regional.currency)}`
              }
            />
            <p className="text-sm text-muted-foreground">
              {timeZoneLabel(data.regional.timeZone)}
            </p>
            <div className="grid gap-5 sm:grid-cols-2">
              <Text
                label="Start date"
                type="date"
                required
                value={date}
                onChange={setDate}
              />
              {service?.durationMinutes === null && (
                <Text
                  label="Last day of care"
                  type="date"
                  required
                  value={endDate}
                  onChange={setEndDate}
                />
              )}
              {service && service.durationMinutes !== null && (
                <Field
                  label={directTime ? "Start time" : "Available start time"}
                >
                  {(id) =>
                    directTime ? (
                      <Input
                        id={id}
                        type="time"
                        className="min-h-11"
                        required
                        value={time}
                        onChange={(e) => setTime(e.target.value)}
                      />
                    ) : (
                      <Choice
                        id={id}
                        required
                        disabled={busy || availability.loading}
                        value={time}
                        onValueChange={setTime}
                        placeholder={
                          slots
                            ? "Choose a time"
                            : "Choose a service and date first"
                        }
                        options={(slots ?? []).map((slot) => ({
                          value: slot.startTime!,
                          label: bookingTime(slot.startTime),
                        }))}
                      />
                    )
                  }
                </Field>
              )}
            </div>
            {slotError && (
              <p role="alert" className="text-sm text-destructive">
                {slotError}
              </p>
            )}
            {availability.loading && (
              <p role="status" className="text-sm text-muted-foreground">
                Checking visit…
              </p>
            )}
            <BookingAvailabilityNotice
              historical={historical}
              overlaps={availability.overlaps}
            />
            {slots?.length === 0 && (
              <Hint>
                {owner
                  ? "No times available. Try another date or time."
                  : "No times available. Try another date or contact the sitter."}
              </Hint>
            )}
            {!historical &&
              service?.durationMinutes === null &&
              Boolean(slots?.length) && (
                <p className="text-sm">
                  <Check className="mr-2 inline size-4" aria-hidden="true" />
                  Dates available.
                </p>
              )}
          </FormSection>
          <FormSection title="Message">
            <Area
              label="Booking message (shared with client and sitter)"
              value={message}
              onChange={setMessage}
            />
          </FormSection>
        </div>
        <aside
          className="space-y-5 rounded-xl border bg-card p-5 sm:p-6 xl:sticky xl:top-6"
          aria-label="Booking summary"
        >
          <h3 className="text-lg font-semibold">Summary</h3>
          <dl className="space-y-4 text-sm">
            <div>
              <dt className="text-muted-foreground">Service</dt>
              <dd className="mt-1 break-words font-medium">
                {service?.name || "Choose a service"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Pets</dt>
              <dd className="mt-1 break-words font-medium">
                {selectedPets.map((p) => p.name).join(", ") || "Choose pets"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">When</dt>
              <dd className="mt-1 font-medium">
                {date
                  ? dateLabel(date, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : "Choose a date"}
                {service?.durationMinutes === null && endDate
                  ? ` – ${dateLabel(endDate)}`
                  : ""}
                {time ? ` · ${bookingTime(time)}` : ""}
              </dd>
            </div>
          </dl>
          {service && (
            <div className="border-t pt-4 text-sm">
              <p className="mb-1 font-medium">Rate</p>
              {service.additionalPetPriceCents > 0
                ? `First pet ${money(service.priceCents, data.regional.currency)}, then ${money(service.additionalPetPriceCents, data.regional.currency)} per additional pet`
                : `${money(service.priceCents, data.regional.currency)} per pet`}
              {service.durationMinutes === null
                ? ", per calendar day (inclusive dates)."
                : ", per visit."}
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            {historical ? (
              "Saved as completed. Payment is arranged separately."
            ) : (
              <>
                {owner || data.policy.approvalMode === "instant"
                  ? "Confirmed immediately."
                  : `Sitter approval required. The slot is held for ${data.policy.requestHoldHours} hours or until the visit starts, whichever comes first.`}{" "}
                Client cancellations require {data.policy.cancelHours} hours’
                notice. Payment is arranged separately.
              </>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {historical
              ? "Uses the service’s current rate. Record payment or adjust the charge after saving."
              : "Availability is checked when you submit."}
          </p>
          <Button
            className="min-h-11 w-full whitespace-normal"
            disabled={
              busy ||
              !petIds.length ||
              !hasSelectedSlot ||
              Boolean(service?.durationMinutes !== null && !time)
            }
          >
            {historical
              ? "Record past booking"
              : owner || data.policy.approvalMode === "instant"
                ? "Confirm booking"
                : "Send booking request"}
          </Button>
        </aside>
      </form>
    </div>
  );
}
function BookingDetails({
  id,
  data,
  owner,
  busy,
  run,
  close,
  onError,
}: FormProps & {
  id: string;
  owner: boolean;
  close: () => void;
  onError: (e: unknown) => Promise<void>;
}) {
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [update, setUpdate] = useState("");
  const notesLoaded = useRef(false);
  const section = useWorkspaceLocation().bookingTab;
  const setSection = (bookingTab: "overview" | "payments" | "history") =>
    updateWorkspaceLocation({ bookingTab });
  const [paymentsOpened, setPaymentsOpened] = useState(section === "payments");
  const reportLoadError = useEffectEvent(onError);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void api<{ booking: Booking }>(
      "/bookings/" + encodeURIComponent(id),
      "GET",
      undefined,
      controller.signal,
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setBooking(result.booking);
        // Payment and status updates must not replace an unfinished visit note.
        if (!notesLoaded.current) {
          setNotes(result.booking.privateNotes ?? "");
          setUpdate(result.booking.clientUpdate);
          notesLoaded.current = true;
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setError(error.message);
          void reportLoadError(error);
        }
      });
    return () => controller.abort();
  }, [id, data.revision, retry]);
  const b = booking;
  const zone = b?.policy?.timeZone ?? data.regional.timeZone;
  const transition = (action: string) => {
    if (!b) return;
    void run(
      () =>
        api("/bookings/" + encodeURIComponent(id) + "/transition", "POST", {
          action,
          version: b.version,
          reason,
        }),
      "Booking updated. No payment or refund was performed.",
    );
  };
  return (
    <div data-refresh-paused className="space-y-6">
      <Button
        className="-ml-3 min-h-11"
        variant="ghost"
        disabled={busy}
        onClick={close}
      >
        <ArrowLeft aria-hidden="true" /> Back to bookings
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}{" "}
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setRetry((n) => n + 1)}
          >
            Try again
          </Button>
        </p>
      )}
      {!b ? (
        <p role="status">Loading booking details…</p>
      ) : (
        <>
          <BookingDetailHeader
            booking={b}
            owner={owner}
            zone={zone}
            currency={b.price?.currency ?? data.regional.currency}
          />
          <nav
            aria-label="Booking sections"
            className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1 sm:inline-grid sm:min-w-96"
          >
            {(
              [
                ["overview", "Overview"],
                ["payments", "Payments"],
                ["history", "History"],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                className={
                  "min-h-11 px-3 " +
                  (section === value
                    ? "bg-card shadow-sm"
                    : "text-muted-foreground")
                }
                variant="ghost"
                disabled={busy}
                aria-current={section === value ? "page" : undefined}
                onClick={() => {
                  setSection(value);
                  if (value === "payments") setPaymentsOpened(true);
                }}
              >
                {label}
              </Button>
            ))}
          </nav>
          <div hidden={section !== "overview"}>
            <BookingOverview
              booking={b}
              owner={owner}
              busy={busy}
              zone={zone}
              notes={notes}
              update={update}
              reason={reason}
              setNotes={setNotes}
              setUpdate={setUpdate}
              setReason={setReason}
              onTransition={transition}
              onSave={() =>
                void run(
                  () =>
                    api(
                      "/bookings/" + encodeURIComponent(id) + "/notes",
                      "PUT",
                      {
                        version: b.version,
                        privateNotes: notes,
                        clientUpdate: update,
                      },
                    ),
                  "Visit notes saved.",
                )
              }
            />
          </div>
          {section === "history" && (
            <BookingHistory id={id} zone={zone} revision={data.revision} />
          )}
          {(paymentsOpened || section === "payments") && (
            <div hidden={section !== "payments"} className="min-w-0">
              <BookingPayments
                bookingId={id}
                owner={owner}
                run={run}
                busy={busy}
                onError={onError}
                timeZone={zone}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function Rules({ data, busy, run }: FormProps) {
  const [value, setValue] = useState(data.policy),
    [blocked, setBlocked] = useState(data.policy.blockedDates.join("\n"));
  const hoursId = useId();
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Portal &amp; rules</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {timeZoneLabel(data.regional.timeZone)}
        </p>
      </div>
      <form
        aria-label="Portal and booking rules"
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            () =>
              api("/owner/policy", "PUT", {
                ...value,
                blockedDates: [
                  ...new Set(blocked.split(/\s+/).filter(Boolean)),
                ],
              }),
            "Portal and booking rules saved.",
          );
        }}
      >
        <div className="grid items-start gap-6 xl:grid-cols-2">
          <div className="min-w-0 space-y-6">
            <FormSection title="Client portal">
              <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
                <input
                  type="checkbox"
                  className="size-4 shrink-0 accent-primary"
                  checked={value.portalEnabled}
                  onChange={(e) =>
                    setValue({ ...value, portalEnabled: e.target.checked })
                  }
                />
                Allow invited clients to sign in
              </label>
              <p className="text-sm leading-6 text-muted-foreground">
                Turning this off signs clients out. Revoke access on a client’s
                record to cancel their invitations.
              </p>
            </FormSection>
            <FormSection title="Booking rules">
              <p className="text-sm text-muted-foreground">
                Changes apply to new bookings.
              </p>
              <Field label="Booking approval">
                {(id) => (
                  <Choice
                    id={id}
                    disabled={busy}
                    value={value.approvalMode}
                    onValueChange={(approvalMode) =>
                      setValue({
                        ...value,
                        approvalMode: approvalMode as "request" | "instant",
                      })
                    }
                    options={[
                      { value: "request", label: "Review each request" },
                      { value: "instant", label: "Confirm automatically" },
                    ]}
                  />
                )}
              </Field>
              <div className="grid items-end gap-5 sm:grid-cols-2">
                {[
                  ["leadHours", "Minimum booking notice (hours)", 0, 720],
                  ["horizonDays", "Book ahead up to (days)", 1, 365],
                  ["cancelHours", "Cancellation notice (hours)", 0, 720],
                  [
                    "requestHoldHours",
                    "Time to approve a request (hours)",
                    1,
                    168,
                  ],
                ].map(([key, label, min, max]) => (
                  <Field key={key} label={String(label)}>
                    {(id) => (
                      <Input
                        id={id}
                        type="number"
                        required
                        min={Number(min)}
                        max={Number(max)}
                        value={Number(value[key as keyof Policy])}
                        onChange={(e) =>
                          setValue({ ...value, [key]: Number(e.target.value) })
                        }
                      />
                    )}
                  </Field>
                ))}
              </div>
              <p className="text-sm leading-6 text-muted-foreground">
                You can waive client notice and cancellation limits when
                managing a booking.
              </p>
            </FormSection>
          </div>
          <FormSection title="Availability">
            <p className="text-sm leading-6 text-muted-foreground">
              One booking or pending request at a time. Every day of a stay must
              be open (31 days maximum).
            </p>
            <div className="divide-y border-y">
              <div
                aria-hidden="true"
                className="hidden grid-cols-[minmax(100px,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 py-3 text-sm font-medium text-muted-foreground sm:grid"
              >
                <span>Day</span>
                <span>Opens</span>
                <span>Closes</span>
              </div>
              {days.map((day, index) => {
                const slot = value.weekly.find((s) => s.day === index);
                const change = (patch: { start?: string; end?: string }) =>
                  setValue({
                    ...value,
                    weekly: value.weekly.map((s) =>
                      s.day === index ? { ...s, ...patch } : s,
                    ),
                  });
                return (
                  <div
                    key={day}
                    className="grid grid-cols-2 items-center gap-x-3 gap-y-1 py-2 sm:grid-cols-[minmax(100px,1fr)_minmax(0,1fr)_minmax(0,1fr)]"
                  >
                    <label className="col-span-2 flex min-h-11 items-center gap-2 text-sm sm:col-span-1">
                      <input
                        type="checkbox"
                        className="size-4 shrink-0 accent-primary"
                        checked={Boolean(slot)}
                        onChange={(e) =>
                          setValue({
                            ...value,
                            weekly: e.target.checked
                              ? [
                                  ...value.weekly,
                                  { day: index, start: "09:00", end: "17:00" },
                                ]
                              : value.weekly.filter((s) => s.day !== index),
                          })
                        }
                      />
                      {day}
                    </label>
                    {(["start", "end"] as const).map((edge) => (
                      <div key={edge} className="min-w-0 space-y-1">
                        <label
                          htmlFor={`${hoursId}-${index}-${edge}`}
                          className="block text-sm text-muted-foreground sm:sr-only"
                        >
                          <span className="sr-only">{day} </span>
                          {edge === "start" ? "Opens" : "Closes"}
                        </label>
                        <Input
                          id={`${hoursId}-${index}-${edge}`}
                          type="time"
                          className="min-h-10 min-w-0"
                          disabled={!slot}
                          required={Boolean(slot)}
                          value={
                            slot?.[edge] ??
                            (edge === "start" ? "09:00" : "17:00")
                          }
                          onChange={(e) => change({ [edge]: e.target.value })}
                        />
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
            <Area
              label="Unavailable dates (YYYY-MM-DD, one per line)"
              value={blocked}
              onChange={setBlocked}
              maxLength={4500}
            />
            <p className="text-sm leading-6 text-muted-foreground">
              Closed hours, unavailable dates and booking conflicts can’t be
              overridden. Times skipped or repeated when clocks change can’t be
              booked.
            </p>
          </FormSection>
        </div>
        <div className="flex justify-end border-t pt-4">
          <Button className="min-h-11 w-full sm:w-auto" disabled={busy}>
            Save changes
          </Button>
        </div>
      </form>
    </div>
  );
}
function BookingHistory({
  id,
  zone,
  revision,
}: {
  id: string;
  zone: string;
  revision: number;
}) {
  const page = usePage<{ history: BookingEvent[] }>(
    `/bookings/${encodeURIComponent(id)}`,
    revision,
  );
  return (
    <section
      aria-label="Booking history"
      className="space-y-6 rounded-xl border bg-card p-5 sm:p-7"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold">Booking history</h3>
        <p className="text-sm text-muted-foreground">{timeZoneLabel(zone)}</p>
      </div>
      {page.data && <BookingTimeline events={page.data.history} zone={zone} />}
      {(page.error ||
        page.loading ||
        page.offset > 0 ||
        page.data?.pagination.hasMore) && (
        <PageControls
          label="booking history"
          {...page}
          pagination={page.data?.pagination}
        />
      )}
    </section>
  );
}
function PetChooser({
  path,
  revision,
  selected,
  setSelected,
}: {
  path: string;
  revision: number;
  selected: Pet[];
  setSelected: (pets: Pet[]) => void;
}) {
  const page = usePage<{ pets: Pet[] }>(path, revision);
  const rows = page.data?.pets ?? [];
  const offPage = selected.filter(
    (pet) => !rows.some((row) => row.id === pet.id),
  );
  return (
    <fieldset className="min-w-0 space-y-3">
      <legend className="mb-2 text-sm font-medium">Pets receiving care</legend>
      <SearchBox
        showWhen={Boolean(rows.length > 8 || page.term || page.offset > 0)}
        label="Find a pet for this booking"
        initialValue={page.term}
        onSearch={page.search}
      />
      {offPage.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Selected pets">
          {offPage.map((p) => (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              key={p.id}
              onClick={() =>
                setSelected(selected.filter((row) => row.id !== p.id))
              }
            >
              Remove {p.name}
            </Button>
          ))}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map((p) => (
          <label
            key={p.id}
            className={`flex min-h-14 min-w-0 cursor-pointer items-center gap-3 rounded-lg border p-4 text-sm ${selected.some((pet) => pet.id === p.id) ? "border-primary bg-secondary/40" : "bg-card"}`}
          >
            <input
              type="checkbox"
              className="size-4 shrink-0 accent-primary"
              checked={selected.some((row) => row.id === p.id)}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...selected, p]
                    : selected.filter((row) => row.id !== p.id),
                )
              }
            />
            <span className="min-w-0">
              <span className="block break-words font-medium">{p.name}</span>
              <span className="text-muted-foreground">
                {speciesLabel(p.species)}
              </span>
            </span>
          </label>
        ))}
      </div>
      {page.loading && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading pets…
        </p>
      )}
      {page.data && !page.data.pets.length && (
        <Hint>No active pets found.</Hint>
      )}
      {(page.error || page.offset > 0 || page.data?.pagination.hasMore) && (
        <PageControls
          label="booking pets"
          {...page}
          pagination={page.data?.pagination}
        />
      )}
    </fieldset>
  );
}
