import { useState, useMemo, useRef, useId } from "react";
import { PawPrint } from "lucide-react";
import { Choice } from "../../components/forms/Choice";
import {
  brandingSchema,
  contrastRatio,
  defaultBranding,
  themePresets,
  themeColors,
  type Branding,
} from "../../../shared/branding";
import { saveAppearanceDraft } from "../../lib/navigation/setup-flow";
import { timeZoneLabel } from "../../lib/format/time-zone-label";
import { api } from "../../lib/http/installation-api";
import { Field } from "../../components/forms/Field";
import { Notice } from "../../components/feedback/Notice";
import {
  SavedStatus,
  useSaveFeedback,
} from "../../components/feedback/ActionFeedback";
import type { InstallationFormProps as FormProps } from "../../lib/types/installation-types";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";

export function Appearance({
  state,
  busy,
  run,
  preview,
  onContinue,
}: FormProps & { preview: (value: Branding | null) => void }) {
  const [brand, setBrand] = useState(state.branding),
    [timeZone, setTimeZone] = useState(state.timeZone),
    [currency, setCurrency] = useState(state.currency);
  const [pendingLogo, setPendingLogo] = useState<File | "remove" | null>(null);
  const revision = useRef(state.version);
  const formId = useId();
  const saveFeedback = useSaveFeedback("appearance-settings", [
    brand,
    timeZone,
    currency,
    pendingLogo,
  ]);
  const timeZones = useMemo(
    () =>
      [...new Set([timeZone, "UTC", ...Intl.supportedValuesOf("timeZone")])]
        .map((value) => ({ value, label: timeZoneLabel(value) }))
        .sort(
          (a, b) =>
            a.label.localeCompare(b.label, "en") ||
            a.value.localeCompare(b.value, "en"),
        ),
    [timeZone],
  );
  function change(next: Branding) {
    setBrand(next);
    preview(brandingSchema.safeParse(next).success ? next : null);
  }
  const valid = brandingSchema.safeParse(brand).success;
  const lowContrast =
    valid && contrastRatio(brand.primaryColor, themeColors.background) < 4.5;
  return (
    <>
      <form
        id={formId}
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            async () => {
              const { logoUrl: _logo, ...input } = brand;
              if (
                pendingLogo &&
                pendingLogo !== "remove" &&
                pendingLogo.size > 2 * 1024 * 1024
              )
                throw new Error("Logo must be at most 2 MB.");
              await saveAppearanceDraft(
                revision,
                (version) =>
                  api("/api/setup/appearance", "PUT", {
                    ...input,
                    version,
                    timeZone,
                    currency,
                  }),
                pendingLogo === "remove"
                  ? (version) => api("/api/setup/logo", "DELETE", { version })
                  : pendingLogo
                    ? (version) =>
                        api("/api/setup/logo", "POST", pendingLogo, {
                          "content-type": pendingLogo.type,
                          "x-installation-version": String(version),
                        })
                    : undefined,
              );
              setPendingLogo(null);
              preview(null);
            },
            saveFeedback,
            onContinue,
          );
        }}
      >
        <fieldset disabled={busy} className="space-y-5">
          <Field appearance="emphasized" label="Business name">
            <Input
              required
              maxLength={100}
              value={brand.businessName}
              onChange={(e) =>
                change({ ...brand, businessName: e.target.value })
              }
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              appearance="emphasized"
              label="Time zone"
              hint="Used for booking times."
            >
              <Choice
                required
                disabled={busy}
                searchable
                searchLabel="Search time zones"
                value={timeZone}
                onValueChange={setTimeZone}
                options={timeZones}
              />
            </Field>
            <Field appearance="emphasized" label="Currency">
              <Choice
                disabled={busy}
                value={currency}
                onValueChange={setCurrency}
                options={[
                  ["USD", "US dollar"],
                  ["CAD", "Canadian dollar"],
                  ["GBP", "British pound"],
                  ["EUR", "Euro"],
                  ["AUD", "Australian dollar"],
                  ["NZD", "New Zealand dollar"],
                ].map(([code, name]) => ({
                  value: code,
                  label: `${name} (${code})`,
                }))}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field appearance="emphasized" label="Primary color">
              <Input
                type="color"
                className="h-11 p-1"
                value={brand.primaryColor}
                onChange={(e) =>
                  change({ ...brand, primaryColor: e.target.value })
                }
              />
            </Field>
            <Field appearance="emphasized" label="Accent color">
              <Input
                type="color"
                className="h-11 p-1"
                value={brand.accentColor}
                onChange={(e) =>
                  change({ ...brand, accentColor: e.target.value })
                }
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Theme presets">
            {themePresets.map((theme) => (
              <Button
                key={theme.name}
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  change({
                    ...brand,
                    primaryColor: theme.primaryColor,
                    accentColor: theme.accentColor,
                  })
                }
              >
                {theme.name}
              </Button>
            ))}
          </div>
          {lowContrast && (
            <Notice>Choose a darker primary color for clearer accents.</Notice>
          )}
          <div className="rounded-xl bg-accent p-5 text-sm text-accent-foreground">
            <PawPrint className="mb-2 size-6" aria-hidden="true" />
            Preview
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setBrand(state.branding);
                setTimeZone(state.timeZone);
                setCurrency(state.currency);
                setPendingLogo(null);
                preview(null);
              }}
            >
              Discard preview
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                change({
                  ...brand,
                  primaryColor: defaultBranding.primaryColor,
                  accentColor: defaultBranding.accentColor,
                })
              }
            >
              Reset colors
            </Button>
          </div>
        </fieldset>
      </form>
      <div className="space-y-4 border-t pt-5">
        <Field
          label="Business logo"
          hint={
            onContinue
              ? "Optional. PNG, JPEG or WebP. Max 2 MB / 4 megapixels."
              : "PNG, JPEG or WebP. Max 2 MB / 4 megapixels. Save changes before uploading."
          }
        >
          <Input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (onContinue) {
                if (file) setPendingLogo(file);
                return;
              }
              if (file)
                void run(
                  async () => {
                    if (file.size > 2 * 1024 * 1024)
                      throw new Error("Logo must be at most 2 MB.");
                    await api("/api/setup/logo", "POST", file, {
                      "content-type": file.type,
                      "x-installation-version": String(state.version),
                    });
                    preview(null);
                  },
                  { announcement: "Logo saved." },
                );
            }}
          />
        </Field>
        {pendingLogo && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>
              {pendingLogo === "remove"
                ? "Logo will be removed."
                : `Selected: ${pendingLogo.name}`}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setPendingLogo(null)}
            >
              Undo
            </Button>
          </div>
        )}
        {state.branding.logoUrl && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              if (onContinue) {
                setPendingLogo("remove");
                return;
              }
              void run(
                () =>
                  api("/api/setup/logo", "DELETE", { version: state.version }),
                { announcement: "Logo removed." },
              );
            }}
          >
            Remove logo
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" form={formId} disabled={busy || !valid}>
          {onContinue ? "Save and continue" : "Save changes"}
        </Button>
        {!onContinue && <SavedStatus feedback={saveFeedback} />}
      </div>
    </>
  );
}
