import { emptyProviders } from "../../../shared/setup";
import type { SetupState } from "../../../shared/api-responses";

export function providersPayload(
  state: SetupState,
  email = state.providers.email,
  google = state.providers.google,
) {
  return {
    version: state.providers.version,
    email: Object.fromEntries(
      Object.keys(emptyProviders.email).map((key) => [
        key,
        email[key as keyof typeof email],
      ]),
    ),
    google: {
      enabled: google.enabled,
      clientId: google.clientId,
      clientSecret: google.clientSecret,
    },
  };
}
