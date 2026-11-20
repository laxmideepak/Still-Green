// Browser end-to-end test: the unpacked Chrome extension in extension/
// capturing a (fake) Slack session and sending it to the real daemon.
//
//   node --test tests/e2e/extension.e2e.mjs
//
// No real Slack account is used. app.slack.com is answered by a routed page
// that holds the fake tokens from tests/e2e/fake_slack.py, and the daemon
// checks them against fake Slack. Needs Python 3.9+ with `websockets` (set
// PYTHON to pick the interpreter) and Playwright's Chromium. Extensions need
// the full Chromium build, not the headless shell, so the browser is launched
// with channel "chromium" (new headless mode).

import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EXTENSION = path.join(ROOT, "extension");
const PYTHON = process.env.PYTHON || "python3";

// Must match tests/e2e/fake_slack.py.
const GOOD_XOXC = "xoxc-e2e-good-token";
const GOOD_XOXD = "xoxd-e2e-good-cookie";
const TEAM_ID = "T0E2E0001";
const SECOND_XOXC = "xoxc-e2e-second-token";
const SECOND_TEAM_ID = "T0E2E0002";

const SLACK_PAGE = `<!doctype html>
<html><head><title>Slack</title></head><body>fake Slack client</body></html>`;

let harness;
let daemon;
let profile;
let context;
let extensionId;

async function waitFor(check, what, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await check();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for ${what} (last: ${last})`);
}

async function api(method, route, body) {
  const response = await fetch(`${daemon.base}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${daemon.code}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

async function teamIds() {
  const { status, body } = await api("GET", "/api/state");
  assert.equal(status, 200);
  return body.workspaces.map((workspace) => workspace.team_id).sort();
}

before(async () => {
  harness = spawn(PYTHON, [path.join(ROOT, "tests/e2e/harness.py")], {
    cwd: ROOT,
    stdio: ["pipe", "pipe", "inherit"],
  });
  const lines = createInterface({ input: harness.stdout });
  const [first] = await Promise.race([
    once(lines, "line"),
    once(harness, "exit").then(([code]) => {
      throw new Error(`harness exited early with ${code}`);
    }),
  ]);
  daemon = JSON.parse(first);

  profile = await mkdtemp(path.join(tmpdir(), "sg-ext-e2e-"));
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
  });

  // Every request to Slack gets the fake client page; nothing leaves the machine.
  await context.route(/^https:\/\/([a-z0-9-]+\.)*slack\.com\//, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: SLACK_PAGE }),
  );
  await context.addCookies([
    {
      name: "d",
      value: GOOD_XOXD,
      domain: ".slack.com",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  const worker = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
  extensionId = new URL(worker.url()).host;
});

after(async () => {
  await context?.close();
  if (profile) await rm(profile, { recursive: true, force: true });
  if (harness) {
    harness.stdin.end();
    await Promise.race([once(harness, "exit"), new Promise((r) => setTimeout(r, 10000))]);
    harness.kill();
  }
});

beforeEach(async () => {
  for (const page of context.pages()) {
    if (page.url().includes("slack.com")) await page.close();
  }
  for (const id of await teamIds()) {
    const removed = await api("DELETE", `/api/workspaces/${id}`);
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
  }
});

// Open a Slack tab whose localStorage holds the given teams.
async function openSlack(teams) {
  const page = await context.newPage();
  await page.goto(`https://app.slack.com/client/${TEAM_ID}`);
  await page.evaluate((value) => {
    window.localStorage.setItem("localConfig_v2", JSON.stringify(value));
  }, { teams });
  return page;
}

async function openPopup() {
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (error) => problems.push(error.message));
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  return { page, problems };
}

async function storedConsent(popup) {
  return (await popup.evaluate(() => chrome.storage.local.get({ consent: null }))).consent;
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

// Fill the popup and click Capture. The first capture (and the first one to
// a new Stillgreen address) shows the consent notice; accept it unless told
// not to.
async function capture(popup, daemonUrl, code = daemon.code, { accept = true } = {}) {
  const saved = await storedConsent(popup);
  const asked = !saved || saved.origin !== originOf(daemonUrl);
  await popup.getByLabel("Stillgreen address").fill(daemonUrl);
  await popup.getByLabel("Access code").fill(code);
  await popup.getByRole("button", { name: "Capture from Slack" }).click();
  if (asked && accept) {
    const consent = popup.getByRole("region", { name: "Before you capture" });
    // A bad address is refused before the notice; only accept if it shows.
    if (await consent.isVisible().catch(() => false) || (await consent.waitFor({ timeout: 1500 }).then(() => true, () => false))) {
      await consent.getByRole("button", { name: "I understand, continue" }).click();
    }
  }
}

function team(id, name, token) {
  return { id, name, domain: name.toLowerCase().replace(/\s+/g, "-"), token };
}

describe("capture extension", () => {
  test("capture is blocked until consent is given", async () => {
    await openSlack({ [TEAM_ID]: team(TEAM_ID, "E2E Workspace", GOOD_XOXC) });
    const { page, problems } = await openPopup();
    await page.evaluate(() => chrome.storage.local.remove("consent"));

    // The worker refuses on its own, even if the popup is skipped.
    const direct = await page.evaluate(async ({ daemonUrl, code }) => {
      await chrome.storage.local.set({ daemonUrl, bridgeCode: code });
      return chrome.runtime.sendMessage({ type: "capture" });
    }, { daemonUrl: daemon.base, code: daemon.code });
    assert.equal(direct.ok, false);
    assert.equal(direct.code, "consent_required");
    assert.deepEqual(await teamIds(), []);

    // The popup shows the notice first; Cancel reads nothing.
    await capture(page, daemon.base, daemon.code, { accept: false });
    const consent = page.getByRole("region", { name: "Before you capture" });
    await consent.waitFor();
    const text = await consent.innerText();
    assert.match(text, /session token and the .d. cookie/);
    assert.match(text, /act as you in Slack/);
    assert.match(text, /Only to the Stillgreen address you set/);
    assert.match(text, /file only your user can read/);
    assert.match(text, /Sign out of all other sessions/);
    assert.match(text, /does not officially support/);
    await consent.getByRole("button", { name: "Cancel" }).click();
    await consent.waitFor({ state: "hidden" });
    const message = page.locator(".message.bad");
    await message.waitFor();
    assert.match(await message.innerText(), /Nothing was captured/);
    assert.equal(await storedConsent(page), null);
    assert.deepEqual(await teamIds(), []);

    // "I understand, continue" saves the answer and captures.
    await page.getByRole("button", { name: "Capture from Slack" }).click();
    await consent.waitFor();
    await consent.getByRole("button", { name: "I understand, continue" }).click();
    await page.locator(".result.ok", { hasText: "E2E Workspace" }).waitFor();
    const saved = await storedConsent(page);
    assert.equal(saved.version, 1);
    assert.equal(saved.origin, new URL(daemon.base).origin);
    assert.ok(!Number.isNaN(Date.parse(saved.acceptedAt)));
    assert.deepEqual(await teamIds(), [TEAM_ID]);
    assert.deepEqual(problems, []);
    await page.close();
  });

  test("asks again when the consent notice changes", async () => {
    await openSlack({ [TEAM_ID]: team(TEAM_ID, "E2E Workspace", GOOD_XOXC) });
    const { page } = await openPopup();
    await page.evaluate(() => chrome.storage.local.set({ consent: { version: 0, acceptedAt: "2020-01-01T00:00:00Z" } }));

    await page.getByLabel("Stillgreen address").fill(daemon.base);
    await page.getByLabel("Access code").fill(daemon.code);
    await page.getByRole("button", { name: "Capture from Slack" }).click();
    const consent = page.getByRole("region", { name: "Before you capture" });
    await consent.waitFor();
    await consent.getByRole("button", { name: "I understand, continue" }).click();
    await page.locator(".result.ok", { hasText: "E2E Workspace" }).waitFor();
    assert.equal((await storedConsent(page)).version, 1);
    await page.close();
  });

  test("asks again when the Stillgreen address changes", async () => {
    await openSlack({ [TEAM_ID]: team(TEAM_ID, "E2E Workspace", GOOD_XOXC) });
    const { page, problems } = await openPopup();
    const local = new URL(daemon.base);
    // Agreed for this computer's address ...
    await page.evaluate((origin) => chrome.storage.local.set({
      consent: { version: 1, origin, acceptedAt: "2026-01-01T00:00:00Z" },
    }), local.origin);
    // ... then the address is changed to another host: the worker refuses on
    // its own, without reading Slack, even if the popup is skipped.
    const other = `http://localhost:${local.port}`;
    const remote = "https://stillgreen.example.com";
    for (const address of [other, remote]) {
      const direct = await page.evaluate(async ({ daemonUrl, code }) => {
        await chrome.storage.local.set({ daemonUrl, bridgeCode: code });
        return chrome.runtime.sendMessage({ type: "capture" });
      }, { daemonUrl: address, code: daemon.code });
      assert.equal(direct.ok, false);
      assert.equal(direct.code, "consent_required");
      assert.match(direct.error, /address changed/);
    }
    assert.deepEqual(await teamIds(), []);

    // The popup shows the notice again, names the new address and says it changed.
    await page.reload();
    await page.getByLabel("Stillgreen address").fill(remote);
    await page.getByLabel("Access code").fill(daemon.code);
    await page.getByRole("button", { name: "Capture from Slack" }).click();
    const consent = page.getByRole("region", { name: "Before you capture" });
    await consent.waitFor();
    const text = await consent.innerText();
    assert.match(text, /stillgreen\.example\.com/);
    assert.match(text, new RegExp(`changed the Stillgreen address from ${local.host.replace(/\./g, "\\.")} to stillgreen\\.example\\.com`));
    assert.match(text, /not this computer/);
    await consent.getByRole("button", { name: "Cancel" }).click();
    await consent.waitFor({ state: "hidden" });
    assert.equal((await storedConsent(page)).origin, local.origin);

    // Agreeing for another local address stores that address.
    await capture(page, other);
    await page.locator(".result.ok", { hasText: "E2E Workspace" }).waitFor();
    assert.equal((await storedConsent(page)).origin, other);
    assert.deepEqual(await teamIds(), [TEAM_ID]);
    assert.deepEqual(problems, []);
    await page.close();
  });

  test("captures the Slack session into the daemon", async () => {
    await openSlack({ [TEAM_ID]: team(TEAM_ID, "E2E Workspace", GOOD_XOXC) });
    const { page, problems } = await openPopup();

    await capture(page, daemon.base);

    await page.locator(".result.ok", { hasText: "E2E Workspace" }).waitFor();
    // After a capture the popup checks the daemon at the saved URL.
    await page.locator("#status", { hasText: "Stillgreen running" }).waitFor();
    assert.deepEqual(await teamIds(), [TEAM_ID]);
    assert.deepEqual(problems, []);
    await page.close();

    // The logo switch follows the daemon: on once the workspace is
    // connected, off while Stillgreen is paused.
    await waitFor(async () => (await api("GET", "/api/state")).body.workspaces.some((w) => w.connected), "workspace connected");
    const mood = async () => {
      const { page: popup } = await openPopup();
      await popup.locator("#status", { hasText: "Stillgreen running" }).waitFor();
      const value = await popup.locator("#logoMark").getAttribute("data-mood");
      const words = await popup.locator("#statusMood").textContent();
      await popup.close();
      return { value, words };
    };
    assert.deepEqual(await mood(), { value: "on", words: ", keeping you active" });
    assert.equal((await api("POST", "/api/pause", {})).status, 200);
    try {
      assert.deepEqual(await mood(), { value: "off", words: ", not keeping you active right now" });
    } finally {
      assert.equal((await api("POST", "/api/resume", {})).status, 200);
    }
  });

  test("saves every team in localConfig_v2", async () => {
    await openSlack({
      [TEAM_ID]: team(TEAM_ID, "E2E Workspace", GOOD_XOXC),
      [SECOND_TEAM_ID]: team(SECOND_TEAM_ID, "E2E Second Workspace", SECOND_XOXC),
    });
    const { page } = await openPopup();

    await capture(page, daemon.base);

    await page.locator(".result.ok", { hasText: "E2E Second Workspace" }).waitFor();
    assert.equal(await page.locator(".result.ok").count(), 2);
    assert.deepEqual(await teamIds(), [TEAM_ID, SECOND_TEAM_ID]);
    await page.close();
  });

  test("shows an error when Slack refuses the token", async () => {
    await openSlack({ [TEAM_ID]: team(TEAM_ID, "E2E Workspace", "xoxc-e2e-wrong-token") });
    const { page } = await openPopup();

    await capture(page, daemon.base);

    const row = page.locator(".result.bad", { hasText: "E2E Workspace" });
    await row.waitFor();
    // Plain words and a next step, not the raw daemon error.
    // Older daemons send only text; newer ones send the error catalogue's words.
    assert.match(await row.innerText(), /Slack didn't accept this login|Slack signed you out/);
    assert.match(await row.innerText(), /signed in|Sign in at app\.slack\.com/);
    assert.doesNotMatch(await row.innerText(), /invalid_auth|rejected these tokens/);
    assert.deepEqual(await teamIds(), []);
    await page.close();
  });

  test("refuses plain http to another machine", async () => {
    await openSlack({ [TEAM_ID]: team(TEAM_ID, "E2E Workspace", GOOD_XOXC) });
    const { page } = await openPopup();

    await capture(page, "http://192.168.1.20:8765");

    const message = page.locator(".message.bad");
    await message.waitFor();
    assert.match(await message.innerText(), /Plain http is only allowed to this machine/);
    assert.deepEqual(await teamIds(), []);
    await page.close();
  });

  test("refuses a URL with a username and password", async () => {
    await openSlack({ [TEAM_ID]: team(TEAM_ID, "E2E Workspace", GOOD_XOXC) });
    const { page } = await openPopup();
    const withLogin = daemon.base.replace("http://", "http://user:pass@");

    await capture(page, withLogin);

    const message = page.locator(".message.bad");
    await message.waitFor();
    assert.match(await message.innerText(), /must not contain a username or password/);
    assert.deepEqual(await teamIds(), []);
    await page.close();
  });

  test("explains a wrong access code and an address where nothing runs", async () => {
    await openSlack({ [TEAM_ID]: team(TEAM_ID, "E2E Workspace", GOOD_XOXC) });
    const { page } = await openPopup();

    await capture(page, daemon.base, "SG-WRNG-WRNG-WRNG");
    const message = page.locator(".message.bad");
    await message.waitFor();
    assert.match(await message.innerText(), /access code (was )?not accepted/i);
    assert.match(await message.innerText(), /sg-local web --show-code/);
    assert.equal(await page.getByLabel("Access code").getAttribute("aria-invalid"), "true");

    // Port 9 (discard) on this machine: nothing answers.
    await capture(page, "http://127.0.0.1:9");
    await page.locator(".message.bad", { hasText: "Stillgreen is not running at 127.0.0.1:9" }).waitFor();
    assert.deepEqual(await teamIds(), []);
    await page.close();
  });

  test("the worker refuses a bad URL even if the popup check is skipped", async () => {
    // background.js is the real trust boundary: store a bad URL directly and
    // ask the worker to capture, as a tampered popup could.
    await openSlack({ [TEAM_ID]: team(TEAM_ID, "E2E Workspace", GOOD_XOXC) });
    const { page } = await openPopup();

    for (const [daemonUrl, expected] of [
      ["http://192.168.1.20:8765", /Refusing to send your Slack session over plain http/],
      [daemon.base.replace("http://", "http://user:pass@"), /must not contain a username/],
    ]) {
      const result = await page.evaluate(async ({ daemonUrl, code }) => {
        await chrome.storage.local.set({ daemonUrl, bridgeCode: code });
        return chrome.runtime.sendMessage({ type: "capture" });
      }, { daemonUrl, code: daemon.code });
      assert.equal(result.ok, false);
      assert.match(result.error, expected);
    }
    assert.deepEqual(await teamIds(), []);
    await page.close();
  });
});
