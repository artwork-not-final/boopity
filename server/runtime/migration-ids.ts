// Permanent IDs already recorded in published installations. Keep these mappings
// and SQL bytes unchanged; filenames can be descriptive without replaying history.
// New migrations use their filename as their ID and need no entry here.
const historicalIds: Readonly<Record<string, string>> = {
  "0000_scheduled_jobs.sql": "0000_goofy_annihilus.sql",
  "0001_authentication_profiles_and_uploads.sql": "0001_lush_silverclaw.sql",
  "0002_rate_limit_keys.sql": "0002_hard_ben_urich.sql",
  "0003_clients_and_pets.sql": "0003_robust_doctor_spectrum.sql",
  "0004_bookings_and_services.sql": "0004_amused_chimera.sql",
  "0005_legacy_billing_and_payments.sql": "0005_boring_hitman.sql",
  "0006_notifications_and_documents.sql": "0006_medical_arclight.sql",
  "0007_session_and_job_cleanup_indexes.sql": "0007_condemned_maggott.sql",
  "0008_installation_and_memberships.sql": "0001_installation.sql",
  "0009_setup_and_recovery.sql": "0002_setup.sql",
  "0010_operator_token_history.sql": "0003_operator_token_history.sql",
  "0011_client_portal_and_booking_rules.sql": "0004_client_portal.sql",
  "0012_payment_integrations_and_ledger.sql": "0005_payments.sql",
  "0013_list_indexes.sql": "0006_list_indexes.sql",
  "0014_guided_installation.sql": "0007_guided_installation.sql",
  "0015_setup_password.sql": "0008_setup_password.sql",
};

export function migrationId(filename: string) {
  return historicalIds[filename] ?? filename;
}
