import { z } from "zod";

// Run before the app's schema imports. Even Zod's caught capability probe
// reports a CSP violation; browser validation must not attempt code generation.
z.config({ jitless: true });
