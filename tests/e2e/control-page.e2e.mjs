// Browser end-to-end test: the daemon's own control page (sg_local/static)
// as it runs on a cloud server — network-bound, reached by a host name, no
// embedded code, so the page asks for the access code first.
//
//   node --test tests/e2e/control-page.e2e.mjs
//
// Needs Python 3.11+ with `websockets` (set PYTHON to pick the interpreter)
// and Playwright's Chromium. The host name stillgreen.test is mapped to
// 127.0.0.1 inside Chromium, so the page is same-origin but not loopback.

import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PYTHON = process.env.PYTHON || "python3";
const HOST = "stillgreen.test";
// Must match tests/e2e/fake_slack.py.
const GOOD_XOXC = "xoxc-e2e-good-token";
const GOOD_XOXD = "xoxd-e2e-good-cookie";

// Start the stack the way `sg-local cloud` runs: the daemon serves the page on
// all interfaces and only answers its own host name.
const STACK = `
import json, sys
sys.path.insert(0, "tests/e2e")
from harness import Stack, CODE
stack = Stack().start(
    daemon_serves_page=True,
    extra_env={"SG_LOCAL_DAEMON_WEB_HOST": "0.0.0.0", "SG_LOCAL_WEB_HOSTS": "${HOST}"},
)
print(json.dumps({"base": stack.base, "port": stack.port, "code": CODE}), flush=True)
try:
    sys.stdin.read()
finally:
    stack.stop()
`;

let harness;
let daemon;
let pageUrl;
let browser;
let zone;
let localHour;

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

async function daemonState() {
  const { status, body } = await api("GET", "/api/state");
  assert.equal(status, 200);
  return body;
}

// A browser timezone where it is daytime now, so "until HH:MM today" has room.
function daytimeZone() {
  const zones = ["America/New_York", "America/Los_Angeles", "Pacific/Honolulu", "Europe/London", "Asia/Kolkata", "Asia/Tokyo", "Australia/Sydney"];
  for (const candidate of zones) {
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone: candidate, hour: "2-digit", hourCycle: "h23" }).format(new Date()),
    );
    if (hour >= 6 && hour <= 19) return [candidate, hour];
  }
  throw new Error("no daytime timezone found");
}

before(async () => {
  harness = spawn(PYTHON, ["-c", STACK], { cwd: ROOT, stdio: ["pipe", "pipe", "inherit"] });
  const lines = createInterface({ input: harness.stdout });
  const [first] = await Promise.race([
    once(lines, "line"),
    once(harness, "exit").then(([code]) => {
      throw new Error(`harness exited early with ${code}`);
    }),
  ]);
  daemon = JSON.parse(first);
  pageUrl = `http://${HOST}:${daemon.port}/`;
  [zone, localHour] = daytimeZone();
  browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`] });
});

after(async () => {
  await browser?.close();
  if (harness) {
    harness.stdin.end();
    await Promise.race([once(harness, "exit"), new Promise((r) => setTimeout(r, 10000))]);
    harness.kill();
  }
});

// Opens the page in a fresh context. Any window.alert/confirm/prompt fails
// the test: the page must use its own in-page dialogs.
async function openPage() {
  const context = await browser.newContext({ timezoneId: zone });
  const page = await context.newPage();
  const problems = [];
  page.on("dialog", (dialog) => {
    problems.push(`native ${dialog.type()} dialog: ${dialog.message()}`);
    dialog.dismiss().catch(() => {});
  });
  page.on("pageerror", (error) => problems.push(error.message));
  await page.goto(pageUrl);
  return { context, page, problems };
}

async function unlock(page, code = daemon.code) {
  await page.getByRole("textbox", { name: "Access code" }).fill(code);
  await page.getByRole("button", { name: "Unlock" }).click();
}

async function ensureWorkspace() {
  const state = await daemonState();
  if (!state.workspaces.length) {
    const added = await api("POST", "/api/workspaces", { xoxc: GOOD_XOXC, xoxd: GOOD_XOXD });
    assert.equal(added.status, 200, JSON.stringify(added.body));
  }
}

describe("daemon control page (cloud mode)", () => {
  test("asks for the access code and rejects a wrong one", async () => {
    const { context, page, problems } = await openPage();
    await page.getByRole("heading", { name: "Enter the access code" }).waitFor();
    await unlock(page, "SG-WRNG-WRNG-WRNG");
    await page.getByText("That code wasn't accepted").waitFor();

    // Typed in lower case with a Unicode dash, as when copied from chat.
    await unlock(page, `  ${daemon.code.toLowerCase().replace(/-/g, "\u2013")} `);
    await page.locator("#overviewTitle", { hasText: /\w/ }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem("stillgreen.bridge")), daemon.code);

    // Locking forgets the code.
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("menuitem", { name: "Lock this page" }).click();
    await page.getByRole("heading", { name: "Enter the access code" }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem("stillgreen.bridge")), null);

    assert.deepEqual(problems, []);
    await context.close();
  });

  test("adds a workspace in a dialog, then pauses and resumes it", async () => {
    const existing = await daemonState();
    for (const workspace of existing.workspaces) await api("DELETE", `/api/workspaces/${workspace.team_id}`);

    const { context, page, problems } = await openPage();
    await unlock(page);
    await page.getByRole("heading", { name: "No workspaces yet" }).waitFor();

    await page.locator("#workspacesCard").getByRole("button", { name: "Add workspace" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add a Slack workspace" });
    await dialog.waitFor();
    await dialog.getByLabel("xoxc token").fill(GOOD_XOXC);
    await dialog.getByLabel("xoxd cookie").fill(GOOD_XOXD);
    await dialog.getByRole("button", { name: "Verify & add" }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.locator("#workspaceList").getByText("E2E Workspace").waitFor();
    assert.equal((await daemonState()).workspaces.length, 1);

    await page.getByRole("button", { name: "Pause E2E Workspace" }).click();
    await page.getByRole("button", { name: "Resume E2E Workspace" }).waitFor();
    await waitFor(async () => (await daemonState()).workspaces[0].paused, "workspace paused");
    await page.getByRole("button", { name: "Resume E2E Workspace" }).click();
    await page.getByRole("button", { name: "Pause E2E Workspace" }).waitFor();
    await waitFor(async () => !(await daemonState()).workspaces[0].paused, "workspace resumed");

    // Pause everything for an hour, then resume.
    const overview = page.locator("#overview");
    await overview.getByRole("button", { name: "Pause 1 h" }).click();
    await overview.getByRole("heading", { name: /^Paused · Until \d{1,2}:\d\d/ }).waitFor();
    assert.equal((await daemonState()).paused, true);
    await overview.getByRole("button", { name: "Resume all", exact: true }).click();
    await overview.getByRole("button", { name: "Pause 1 h" }).waitFor();
    assert.equal((await daemonState()).paused, false);

    // Pause with no end time, then resume.
    await overview.getByRole("button", { name: "Pause until I resume" }).click();
    await overview.getByRole("heading", { name: "Paused · Until you resume" }).waitFor();
    assert.equal((await daemonState()).pause_until ?? null, null);
    await overview.getByRole("button", { name: "Resume all", exact: true }).click();
    await overview.getByRole("button", { name: "Pause until I resume" }).waitFor();
    assert.equal((await daemonState()).paused, false);

    assert.deepEqual(problems, []);
    await context.close();
  });

  test("keeps me online until a time today, then cancels", async () => {
    const { context, page, problems } = await openPage();
    await unlock(page);
    const card = page.locator("#stayCard");
    await card.getByRole("button", { name: "30 min", exact: true }).waitFor();

    // A time that has passed is refused in the page, without a request.
    await card.getByLabel("Until").fill(`${String(Math.max(localHour - 1, 0)).padStart(2, "0")}:00`);
    await card.getByRole("button", { name: "Keep on" }).click();
    await card.getByText("has already passed today").waitFor();
    assert.equal((await daemonState()).stay_active, false);

    const target = `${String(localHour + 2).padStart(2, "0")}:30`;
    // The page shows times in the browser's own format, e.g. "11:30 AM".
    const shown = await page.evaluate((value) => {
      const [hours, minutes] = value.split(":").map(Number);
      const date = new Date();
      date.setHours(hours, minutes, 0, 0);
      return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
    }, target);
    await card.getByLabel("Until").fill(target);
    await card.getByRole("button", { name: "Keep on" }).click();
    await card.getByText(`staying online until ${shown}`).waitFor();
    const state = await daemonState();
    assert.equal(state.stay_active, true);
    const local = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(new Date(state.stay_until));
    assert.equal(local, target);

    await card.getByRole("button", { name: "Cancel" }).click();
    await card.getByText(/staying online until/).waitFor({ state: "hidden" });
    await waitFor(async () => !(await daemonState()).stay_active, "override cleared");

    // A duration chip only picks; "Keep on" applies it.
    await card.getByRole("button", { name: "2 h", exact: true }).click();
    assert.equal(await card.getByRole("button", { name: "2 h", exact: true }).getAttribute("aria-pressed"), "true");
    assert.equal((await daemonState()).stay_active, false);
    await card.getByRole("button", { name: "Keep on for 2 h" }).click();
    await card.getByText(/staying online until/).waitFor();
    const minutes = (new Date((await daemonState()).stay_until) - Date.now()) / 60000;
    assert.ok(minutes > 115 && minutes <= 121, `stay lasts about 2 hours, got ${minutes} min`);
    await card.getByRole("button", { name: "Cancel" }).click();
    await waitFor(async () => !(await daemonState()).stay_active, "override cleared again");

    assert.deepEqual(problems, []);
    await context.close();
  });

  test("removes a workspace only after the in-page confirmation", async () => {
    await ensureWorkspace();
    const { context, page, problems } = await openPage();
    await unlock(page);
    await page.locator("#workspaceList").getByText("E2E Workspace").waitFor();

    const remove = page.getByRole("button", { name: "Remove E2E Workspace" });
    const confirm = page.getByRole("dialog", { name: "Remove E2E Workspace?" });

    // Escape cancels.
    await remove.click();
    await confirm.waitFor();
    await page.keyboard.press("Escape");
    await confirm.waitFor({ state: "hidden" });
    assert.equal((await daemonState()).workspaces.length, 1);

    // Cancel button cancels.
    await remove.click();
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await confirm.waitFor({ state: "hidden" });
    assert.equal((await daemonState()).workspaces.length, 1);

    await remove.click();
    await confirm.getByRole("button", { name: "Remove workspace" }).click();
    await confirm.waitFor({ state: "hidden" });
    await page.getByRole("heading", { name: "No workspaces yet" }).waitFor();
    assert.equal((await daemonState()).workspaces.length, 0);

    assert.deepEqual(problems, []);
    await context.close();
  });

  test("rotates the access code only after the in-page confirmation", async () => {
    const { context, page, problems } = await openPage();
    await unlock(page);
    const card = page.locator("#codeCard");
    await card.getByText("SG-••••-••••-••••").waitFor();
    await card.getByRole("button", { name: "Show access code" }).click();
    await card.getByText(daemon.code).waitFor();
    await card.getByRole("button", { name: "Hide access code" }).click();

    const confirm = page.getByRole("dialog", { name: "Change the access code?" });
    await card.getByRole("button", { name: "Change code" }).click();
    await confirm.waitFor();
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await confirm.waitFor({ state: "hidden" });

    // The harness pins the code with SG_LOCAL_BRIDGE_CODE, so the daemon
    // refuses; the reason shows inside the dialog and nothing changes.
    await card.getByRole("button", { name: "Change code" }).click();
    await confirm.getByRole("button", { name: "Change code" }).click();
    await confirm.getByRole("alert").getByText("fixed by the SG_LOCAL_BRIDGE_CODE setting").waitFor();
    await page.keyboard.press("Escape");
    await confirm.waitFor({ state: "hidden" });
    assert.equal((await api("GET", "/api/state")).status, 200);
    assert.equal(await page.evaluate(() => localStorage.getItem("stillgreen.bridge")), daemon.code);

    // When the daemon does rotate, the page shows the new code and a reminder.
    const fresh = "SG-NEW2-CODE-ABCD";
    await page.route("**/api/code/rotate", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, code: fresh }) }));
    await card.getByRole("button", { name: "Change code" }).click();
    await confirm.getByRole("button", { name: "Change code" }).click();
    await confirm.waitFor({ state: "hidden" });
    await card.getByText("The new code is active").waitFor();
    await card.getByText(fresh).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem("stillgreen.bridge")), fresh);

    assert.deepEqual(problems, []);
    await context.close();
  });
});
