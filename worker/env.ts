import type {
  AssetServer,
  MailTransport,
  ObjectStore,
  RequestLimiter,
  SqlDatabase,
} from "../platform/contracts";
import type { AuthIdentity, SessionHeaders } from "./auth-service";

export type Bindings = {
  DB: SqlDatabase;
  UPLOADS: ObjectStore;
  ASSETS?: AssetServer;
  SELF_HOSTED?: boolean;
  SELF_HOSTED_AUTH_EMAIL?: string;
  SELF_HOSTED_CLIENT_ACCESS?: boolean;
  BRAND_NAME?: string;
  SETUP_MAIL_FINGERPRINT?: string;
  RUNTIME?: string;
  MAIL_TRANSPORT?: MailTransport;
  APP_URL: string;
  EMAIL_FROM: string;
  AUTH_MODE: string;
  AUTH_RUNTIME?: string;
  AUTH_SERVICE?: {
    getByName(name: string): {
      fetch(request: Request): Promise<Response>;
      readSession(input: SessionHeaders): Promise<AuthIdentity | null>;
    };
  };
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string;
  EMAIL_DELIVERY_MODE?: string;
  EMAIL_TEST_RECIPIENT?: string;
  NOTIFICATIONS_ENABLED?: string;
  CONTACT_ENABLED?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  CONTACT_RATE_LIMITER?: RequestLimiter;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRO_PRICE_ID?: string;
  BILLING_MODE?: string;
  API_RATE_LIMITER?: RequestLimiter;
  AUTH_RATE_LIMITER?: RequestLimiter;
  WRITE_RATE_LIMITER?: RequestLimiter;
  UPLOAD_RATE_LIMITER?: RequestLimiter;
};

export type AppVariables = {
  businessRole: "owner" | "client";
  clientId: string | null;
  userId: string;
  sitterId: string;
  requestId: string;
  userName: string;
  userEmail: string;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: AppVariables;
};
