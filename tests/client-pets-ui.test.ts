import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClientForm } from "../src/client/features/clients/ClientForm";
import { NewPetForm } from "../src/client/features/clients/NewPetForm";
import { PetCards } from "../src/client/features/clients/PetCards";
import { PetCareForm } from "../src/client/features/clients/PetCareForm";
import { speciesLabel } from "../src/client/features/clients/species-label";

const actions = { busy: false, run: async () => {}, close: () => {} };
const client = {
  id: "client-test",
  firstName: "Alex",
  lastName: "River",
  email: "alex@example.test",
  phone: "2025550123",
  address: "12 Example Lane",
  emergencyContactName: "Sam River",
  emergencyContactPhone: "2025550124",
  notes: "Test client note",
  status: "active",
};
const pet = {
  id: "pet-test",
  name: "Clover",
  species: "rabbit",
  breed: "Lop",
  isActive: true,
};

describe("client and pet forms", () => {
  it("groups contact, emergency details and private notes without losing existing values", () => {
    const html = renderToStaticMarkup(
      createElement(ClientForm, { ...actions, client, done: () => {} }),
    );
    expect(html.match(/<fieldset\b/g)).toHaveLength(3);
    for (const title of [
      "Contact details",
      "Emergency contact",
      "Private notes",
    ])
      expect(html).toMatch(new RegExp(`<legend[^>]*>${title}</legend>`));
    for (const value of [
      client.firstName,
      client.email,
      client.phone,
      client.address,
      client.notes,
    ])
      expect(html).toContain(value);
    expect(html.match(/type="tel"/g)).toHaveLength(2);
    expect(html).toContain("sm:grid-cols-2");
    expect(html).toContain("Save client");
    expect(html).toContain("Archive client");
  });
  it("does not offer archive for a new client, and allows archived clients to be reactivated", () => {
    const fresh = renderToStaticMarkup(
      createElement(ClientForm, { ...actions, done: () => {} }),
    );
    expect(fresh).not.toContain("Archive client");
    expect(fresh).toContain('aria-label="New client"');
    const archived = renderToStaticMarkup(
      createElement(ClientForm, {
        ...actions,
        client: { ...client, status: "archived" },
        done: () => {},
      }),
    );
    expect(archived).toContain("Reactivate client");
  });
  it("shows capitalized species labels while preserving lowercase submitted values", () => {
    const html = renderToStaticMarkup(
      createElement(NewPetForm, { ...actions, clientId: client.id }),
    );
    for (const value of [
      "dog",
      "cat",
      "bird",
      "rabbit",
      "reptile",
      "fish",
      "other",
    ])
      expect(html).toMatch(
        new RegExp(
          `<option value="${value}"[^>]*>${speciesLabel(value)}</option>`,
        ),
      );
    expect(html.match(/<input\b/g)).toHaveLength(1);
    expect(html).not.toContain("Medical conditions");
    expect(html).toContain("Cancel");
  });
  it("presents each pet as one accessible card, with no inline care or add form", () => {
    const html = renderToStaticMarkup(
      createElement(PetCards, {
        pets: [
          pet,
          { ...pet, id: "archived-pet", name: "Juniper", isActive: false },
        ],
        busy: false,
        onSelect: () => {},
      }),
    );
    expect(html.match(/<button\b/g)).toHaveLength(2);
    expect(html.match(/<li\b/g)).toHaveLength(2);
    expect(html).toContain("Rabbit");
    expect(html).toContain("Lop");
    expect(html).toContain("Archived");
    expect(html).toContain("Care details");
    expect(html).not.toMatch(/<form|<input|Archive pet|Add pet/);
  });
  it("retains all six care fields and their limits in four focused sections", () => {
    const html = renderToStaticMarkup(
      createElement(PetCareForm, {
        ...actions,
        initialPet: {
          ...pet,
          medications: "Test medication",
          sitterNotes: "Sitter-only test note",
        },
      }),
    );
    expect(html.match(/<fieldset\b/g)).toHaveLength(4);
    expect(html.match(/<textarea\b/g)).toHaveLength(6);
    for (const title of ["About", "Health", "Daily care", "Private notes"])
      expect(html).toMatch(new RegExp(`<legend[^>]*>${title}</legend>`));
    for (const label of [
      "Pet name",
      "Breed",
      "Medical conditions",
      "Medications",
      "Allergies",
      "Feeding instructions",
      "Special instructions",
      "Private sitter notes",
    ])
      expect(html).toContain(label);
    expect(html.match(/maxLength="1000"/g)).toHaveLength(2);
    expect(html.match(/maxLength="2000"/g)).toHaveLength(3);
    expect(html).toContain('maxLength="4000"');
    expect(html).toContain("Test medication");
    expect(html).toContain("Sitter-only test note");
    expect(html).toContain("only visible to you");
  });
  it("keeps archiving a secondary explicit action in care details", () => {
    const active = renderToStaticMarkup(
      createElement(PetCareForm, { ...actions, initialPet: pet }),
    );
    const archive = active.match(/<button\b[^>]*>Archive pet<\/button>/)?.[0];
    expect(archive).toContain('type="button"');
    expect(archive).toContain('data-variant="ghost"');
    const archived = renderToStaticMarkup(
      createElement(PetCareForm, {
        ...actions,
        initialPet: { ...pet, isActive: false },
      }),
    );
    expect(archived).toContain("Reactivate pet");
  });
  it("disables save, cancel and archive while a care request is running", () => {
    const html = renderToStaticMarkup(
      createElement(PetCareForm, { ...actions, busy: true, initialPet: pet }),
    );
    expect(html.match(/<button\b[^>]*\sdisabled=""/g)).toHaveLength(3);
    const cards = renderToStaticMarkup(
      createElement(PetCards, { pets: [pet], busy: true, onSelect: () => {} }),
    );
    expect(cards).toMatch(/<button\b[^>]*\sdisabled=""/);
  });
});
