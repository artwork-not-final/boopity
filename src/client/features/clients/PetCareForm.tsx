import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Text, Area } from "../../components/forms/TextFields";
import { FormSection } from "../../components/forms/FormSection";
import { workspaceApi as api } from "../../lib/http/workspace-api";
import type { RunWorkspaceAction } from "../../lib/types/workspace-types";
import type { PetDetails, PetCareField } from "./types";
import { speciesLabel } from "./species-label";

export function PetCareForm({
  initialPet,
  run,
  busy,
  close,
}: {
  initialPet: PetDetails;
  run: RunWorkspaceAction;
  busy: boolean;
  close: () => void;
}) {
  const [pet, setPet] = useState(initialPet);
  const id = pet.id;
  const careField = (key: PetCareField, label: string) => (
    <Area
      key={key}
      label={label}
      value={String(pet[key] ?? "")}
      onChange={(value) => setPet({ ...pet, [key]: value })}
      maxLength={
        key === "sitterNotes"
          ? 4000
          : ["medications", "allergies"].includes(key)
            ? 1000
            : 2000
      }
    />
  );
  return (
    <form
      aria-label={`Care details for ${initialPet.name}`}
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await api(`/owner/pets/${id}`, "PUT", pet);
          await api(`/owner/pets/${id}/notes`, "PUT", {
            notes: pet.sitterNotes ?? "",
          });
          close();
        }, "Pet care details saved.");
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="min-w-0 break-words text-xl font-semibold">
          {initialPet.name}
        </h3>
        <Badge variant="outline">
          {pet.isActive ? speciesLabel(pet.species) : "Archived"}
        </Badge>
      </div>
      <FormSection title="About">
        <div className="grid gap-5 sm:grid-cols-2">
          <Text
            label="Pet name"
            value={pet.name}
            required
            onChange={(name) => setPet({ ...pet, name })}
            maxLength={100}
          />
          <Text
            label="Breed"
            value={pet.breed ?? ""}
            onChange={(breed) => setPet({ ...pet, breed })}
            maxLength={100}
          />
        </div>
      </FormSection>
      <FormSection title="Health">
        {careField("medicalConditions", "Medical conditions")}
        <div className="grid gap-5 sm:grid-cols-2">
          {careField("medications", "Medications")}
          {careField("allergies", "Allergies")}
        </div>
      </FormSection>
      <FormSection title="Daily care">
        <div className="grid gap-5 sm:grid-cols-2">
          {careField("feedingInstructions", "Feeding instructions")}
          {careField("specialInstructions", "Special instructions")}
        </div>
      </FormSection>
      <FormSection title="Private notes">
        {careField("sitterNotes", "Private sitter notes")}
      </FormSection>
      <p className="text-xs leading-5 text-muted-foreground">
        Care details and notes are only visible to you.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button className="min-h-11" disabled={busy}>
          Save care details
        </Button>
        <Button
          className="min-h-11"
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={close}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="min-h-11 text-muted-foreground sm:ml-auto"
          disabled={busy}
          onClick={() =>
            void run(
              async () => {
                await api(
                  `/owner/pets/${id}/${pet.isActive ? "archive" : "reactivate"}`,
                  "POST",
                  {},
                );
                close();
              },
              pet.isActive ? "Pet archived." : "Pet reactivated.",
            )
          }
        >
          {pet.isActive ? "Archive pet" : "Reactivate pet"}
        </Button>
      </div>
    </form>
  );
}
