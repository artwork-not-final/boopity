import { useEffect, useState } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Hint } from "../../components/feedback/Hint";
import { workspaceApi as api } from "../../lib/http/workspace-api";
import {
  updateWorkspaceLocation,
  useWorkspaceLocation,
} from "../../lib/navigation/workspace-location";
import { compactPage, VISIBLE_PAGE_SIZE } from "../../lib/compact-page";
import { PageControls } from "../../components/navigation/PageControls";
import { SearchBox } from "../../components/forms/SearchBox";
import { usePage } from "../../hooks/usePage";
import type { RunWorkspaceAction } from "../../lib/types/workspace-types";
import type { Service } from "./types";
import { ServiceList } from "./ServiceList";
import { ServiceForm } from "./ServiceForm";
import { ServiceAvailability } from "./ServiceAvailability";

export function Services({
  revision,
  currency,
  busy,
  run,
}: {
  revision: number;
  currency: string;
  busy: boolean;
  run: RunWorkspaceAction;
}) {
  const page = usePage<{ services: Service[] }>("/services", revision);
  const serviceId = useWorkspaceLocation().service;
  const editing = serviceId !== null;
  const [detail, setDetail] = useState<{
    id: string;
    service?: Service;
    error?: string;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const selected = detail?.id === serviceId ? (detail.service ?? null) : null;
  const detailError = detail?.id === serviceId ? detail.error : undefined;
  useEffect(() => {
    if (!serviceId || serviceId === "new") return;
    const controller = new AbortController();
    void api<{ service: Service }>(
      `/owner/services/${encodeURIComponent(serviceId)}`,
      "GET",
      undefined,
      controller.signal,
    )
      .then(({ service }) => {
        if (!controller.signal.aborted)
          setDetail({
            id: serviceId,
            service: { ...service, isActive: Number(service.isActive) },
          });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setDetail({ id: serviceId, error: error.message });
      });
    return () => controller.abort();
  }, [serviceId, retry]);
  const close = () => updateWorkspaceLocation({ service: null });
  const services = page.data?.services ?? [];
  const pagination = compactPage(page.data?.pagination, services.length);
  function choose(service: Service | null) {
    // Load the detail resource before mounting the editor, including on refresh.
    setDetail(null);
    updateWorkspaceLocation({ service: service?.id ?? "new" });
  }
  if (editing)
    return (
      <div className="space-y-6">
        <Button
          type="button"
          variant="ghost"
          className="min-h-11"
          disabled={busy}
          onClick={close}
        >
          <ArrowLeft aria-hidden="true" /> Back to services
        </Button>
        <h2 className="text-2xl font-semibold">
          {serviceId === "new" ? "New service" : "Edit service"}
        </h2>
        {detailError ? (
          <p role="alert" className="text-sm text-destructive">
            {detailError}{" "}
            <Button
              variant="outline"
              onClick={() => {
                setDetail(null);
                setRetry((n) => n + 1);
              }}
            >
              Try again
            </Button>
          </p>
        ) : serviceId !== "new" && !selected ? (
          <p role="status">Loading service…</p>
        ) : (
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
            <ServiceForm
              key={selected?.id ?? "new"}
              service={selected}
              currency={currency}
              busy={busy}
              run={run}
              close={close}
            />
            {selected && (
              <ServiceAvailability
                service={selected}
                busy={busy}
                run={run}
                onChange={(service) => setDetail({ id: service.id, service })}
              />
            )}
          </div>
        )}
      </div>
    );
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold">Services &amp; rates</h2>
        <Button
          className="min-h-11"
          disabled={busy}
          onClick={() => choose(null)}
        >
          <Plus aria-hidden="true" /> New service
        </Button>
      </div>
      <SearchBox
        label="Search services by name"
        onSearch={page.search}
        initialValue={page.term}
        className="sm:max-w-md"
      />
      <ServiceList
        services={services.slice(0, VISIBLE_PAGE_SIZE)}
        currency={currency}
        busy={busy}
        onSelect={choose}
      />
      {page.data && !services.length && (
        <Hint>{page.term ? "No matching services." : "No services yet."}</Hint>
      )}
      {(page.error ||
        page.loading ||
        page.offset > 0 ||
        pagination?.hasMore) && (
        <PageControls label="services" {...page} pagination={pagination} />
      )}
    </div>
  );
}
