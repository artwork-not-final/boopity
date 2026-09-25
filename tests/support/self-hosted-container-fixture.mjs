// Local disposable Docker QA only. Never run against business or existing preview storage.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

assert.equal(process.env.BOOPITY_CONTAINER_QA, "phase1-disposable");
assert.equal(process.env.DATA_DIR, "/data");
assert.notEqual(process.getuid(), 0, "Container must run as a non-root user");
const mode = process.argv[2];
assert(["seed", "verify"].includes(mode));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const file = `/data/uploads/${digest("phase1-private-fixture")}`;
const marker = "/data/phase1-qa-digests.json";
const db = new DatabaseSync("/data/boopity.sqlite");
assert.equal(
  db.prepare("SELECT COUNT(*) AS n FROM user").get().n,
  0,
  "Use a clean test installation",
);
if (mode === "seed") {
  assert(!existsSync(marker), "Do not overwrite a previous fixture");
  db.prepare(
    "UPDATE installation SET business_name = ?, primary_color = ?, version = version + 1 WHERE id = 1",
  ).run("Maple & Paws", "#285c49");
  writeFileSync(file, "Private test bytes, not a real client upload.", {
    mode: 0o600,
    flag: "wx",
  });
  writeFileSync(
    marker,
    JSON.stringify({
      secret: digest(readFileSync("/data/auth-secret")),
      upload: digest(readFileSync(file)),
    }),
    { mode: 0o600, flag: "wx" },
  );
} else {
  const saved = JSON.parse(readFileSync(marker, "utf8"));
  assert.equal(digest(readFileSync("/data/auth-secret")), saved.secret);
  assert.equal(digest(readFileSync(file)), saved.upload);
  assert.equal(
    db.prepare("SELECT business_name FROM installation WHERE id = 1").get()
      .business_name,
    "Maple & Paws",
  );
  assert.equal(
    db.prepare("SELECT primary_color FROM installation WHERE id = 1").get()
      .primary_color,
    "#285c49",
  );
}
for (const path of ["/data/auth-secret", "/data/boopity.sqlite", file])
  assert.equal(statSync(path).mode & 0o777, 0o600);
db.close();
console.log(
  `Disposable-container ${mode} passed: private storage, branding, stable auth secret, non-root process.`,
);
