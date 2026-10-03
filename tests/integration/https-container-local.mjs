// Real TLS against the shipped image, entirely inside a network-isolated container.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

assert.equal(process.env.BOOPITY_CONTAINER_QA, "https-disposable");
assert.equal(process.argv.length, 3, "Supply a locally available image");
const tag = process.argv[2];
assert(/^[A-Za-z0-9][A-Za-z0-9:._/-]+$/.test(tag));
const docker = (args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60000,
    maxBuffer: 4 * 1024 * 1024,
  });
const inspect = (kind, name) => JSON.parse(docker([kind, "inspect", name]))[0];
const image = inspect("image", tag);
assert.equal(image.Config.User, "node");
const id = randomUUID(),
  labelKey = "org.boopity.https-qa",
  name = `boopity-https-qa-${id}`;
const directory = mkdtempSync(join(tmpdir(), name + "-"));
const certificateDirectory = join(directory, "certs");
// The parent stays private on the host; only this synthetic child is mounted.
mkdirSync(certificateDirectory);
chmodSync(certificateDirectory, 0o755);
let volumeCreated = false,
  containerCreated = false,
  stage = "certificate";
const env = ["--env", "BOOPITY_CONTAINER_QA=https-disposable"];
function start() {
  docker([
    "run",
    "--detach",
    "--pull=never",
    "--platform",
    `linux/${image.Architecture}`,
    "--name",
    name,
    "--label",
    `${labelKey}=${id}`,
    "--network",
    "none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=64m",
    "--mount",
    `source=${name},target=/data`,
    "--mount",
    `type=bind,source=${certificateDirectory},target=/qa,readonly`,
    "--env",
    "APP_URL=https://pets.example.test:3443",
    "--env",
    "BOOPITY_SETUP_LINK=manual",
    "--env",
    "TRUSTED_PROXY_IPS=127.0.0.1",
    "--env",
    "NODE_EXTRA_CA_CERTS=/qa/cert.pem",
    ...env,
    image.Id,
  ]);
  containerCreated = true;
  docker(["exec", "--detach", ...env, name, "node", "/qa/proxy.mjs"]);
}
function stop() {
  assert.equal(inspect("container", name).Config.Labels[labelKey], id);
  docker(["stop", "--timeout", "15", name]);
  docker(["rm", name]);
  containerCreated = false;
}
try {
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=pets.example.test",
      "-addext",
      "subjectAltName=DNS:pets.example.test,DNS:localhost,IP:127.0.0.1",
      "-keyout",
      join(certificateDirectory, "key.pem"),
      "-out",
      join(certificateDirectory, "cert.pem"),
    ],
    { stdio: "pipe", timeout: 30000 },
  );
  for (const file of ["cert.pem", "key.pem"])
    chmodSync(join(certificateDirectory, file), 0o644);
  for (const [from, to] of [
    ["https-proxy-fixture.mjs", "proxy.mjs"],
    ["https-probe-fixture.mjs", "probe.mjs"],
  ]) {
    copyFileSync(
      new URL("../support/" + from, import.meta.url),
      join(certificateDirectory, to),
    );
    chmodSync(join(certificateDirectory, to), 0o644);
  }
  docker(["volume", "create", "--label", `${labelKey}=${id}`, name]);
  volumeCreated = true;
  stage = "HTTPS setup and sign-in";
  start();
  console.log(
    docker(["exec", ...env, name, "node", "/qa/probe.mjs", "setup"]).trim(),
  );
  stage = "HTTPS session after container replacement";
  stop();
  start();
  console.log(
    docker(["exec", ...env, name, "node", "/qa/probe.mjs", "resume"]).trim(),
  );
  console.log(
    JSON.stringify({
      passed: true,
      architecture: image.Architecture,
      image: image.Id,
      realTls: true,
      verifiedCertificate: true,
      secureSetupAndSignInCookies: true,
      smtpOverTls: true,
      canonicalGoogleRedirect: true,
      replacementSessionPreserved: true,
      externalNetwork: false,
      publicHostingTested: false,
      systemTrustChanged: false,
    }),
  );
} catch (error) {
  console.error(`Local HTTPS check failed during ${stage}.`);
  console.error(
    String(error.stderr ?? error.code ?? "Assertion failed")
      .replace(/[A-Za-z0-9+_/-]{24,}={0,2}/g, "[redacted]")
      .slice(-1800),
  );
  process.exitCode = 1;
} finally {
  if (containerCreated) stop();
  if (volumeCreated) {
    assert.equal(inspect("volume", name).Labels[labelKey], id);
    docker(["volume", "rm", name]);
  }
  rmSync(directory, { recursive: true, force: true });
}
