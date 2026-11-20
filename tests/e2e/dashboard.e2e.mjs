// Browser end-to-end test: the built Next.js dashboard driving the real
// daemon (with a fake Slack) through Chromium.
//
//   npm run test:e2e
//
// Needs a production build (`next build`), Python 3.9+ with `websockets`
// (set PYTHON to pick the interpreter), and Playwright's Chromium.

import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { createServer } from "node:net";
import { readFile } from "node:fs/promises";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PYTHON = process.env.PYTHON || "python3";
const GOOD_XOXC = "xoxc-e2e-good-token";
const GOOD_XOXD = "xoxd-e2e-good-cookie";
// A second workspace on the same cookie (see tests/e2e/fake_slack.py).
const SECOND_XOXC = "xoxc-e2e-second-token";
// The check ids in the shared /api/diagnostics contract.
const CHECK_IDS = ["python", "daemon", "config", "permissions", "dns", "tls", "proxy", "clock", "workspaces", "presence"];

let harness;
let harnessLines;
let site;
let daemon;
let siteUrl;
let browser;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

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

// Send one command to the harness (see handle_command in harness.py) and
// wait for its answer, e.g. slackSet({ presence: "away" }).
async function slackSet(changes) {
  const answer = once(harnessLines, "line");
  harness.stdin.write(`${JSON.stringify({ slack: changes })}\n`);
  const [line] = await answer;
  const result = JSON.parse(line);
  assert.equal(result.ok, true, line);
}

async function api(method, route, body, code = daemon.code) {
  const response = await fetch(`${daemon.base}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${code}`,
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

before(async () => {
  harness = spawn(PYTHON, [path.join(ROOT, "tests/e2e/harness.py")], {
    cwd: ROOT,
    stdio: ["pipe", "pipe", "inherit"],
  });
  harnessLines = createInterface({ input: harness.stdout });
  const [first] = await Promise.race([
    once(harnessLines, "line"),
    once(harness, "exit").then(([code]) => {
      throw new Error(`harness exited early with ${code}`);
    }),
  ]);
  daemon = JSON.parse(first);

  const port = await freePort();
  siteUrl = `http://localhost:${port}`;
  site = spawn(
    process.execPath,
    [path.join(ROOT, "node_modules/next/dist/bin/next"), "start", "-p", String(port)],
    { cwd: ROOT, stdio: "ignore" },
  );
  await waitFor(async () => (await fetch(siteUrl)).ok, "Next.js server");

  const added = await api("POST", "/api/workspaces", { xoxc: GOOD_XOXC, xoxd: GOOD_XOXD });
  assert.equal(added.status, 200, JSON.stringify(added.body));
  await waitFor(
    async () => (await daemonState()).workspaces[0]?.status === "active",
    "workspace to go active",
  );

  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  site?.kill();
  if (harness) {
    harness.stdin.end();
    await Promise.race([once(harness, "exit"), new Promise((r) => setTimeout(r, 10000))]);
    harness.kill();
  }
});

async function openDashboard() {
  const context = await browser.newContext();
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  await page.goto(`${siteUrl}/dashboard`);
  return { context, page, problems };
}

async function connect(page, code = daemon.code) {
  await page.getByRole("button", { name: "Connect Stillgreen" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Stillgreen address").fill(daemon.base);
  await dialog.getByLabel("Access code").fill(code);
  await dialog.getByRole("button", { name: "Connect" }).click();
}

describe("dashboard", () => {
  test("shows sample data until paired", async () => {
    const { context, page, problems } = await openDashboard();
    await page.getByText("Preview mode · sample data").waitFor();
    // The sample is labelled as a demo right on the status card.
    await page.getByText("Sample data, not your real Slack status.").waitFor();
    await page.getByText("Demo · sample data").waitFor();
    assert.deepEqual(problems, []);
    await context.close();
  });

  test("explains an address where nothing runs in plain words", async () => {
    const { context, page } = await openDashboard();
    await page.getByRole("button", { name: "Connect Stillgreen" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Stillgreen address").fill("http://127.0.0.1:9");
    await dialog.getByLabel("Access code").fill(daemon.code);
    await dialog.getByRole("button", { name: "Connect" }).click();
    const banner = dialog.getByRole("alert").filter({ hasText: "Stillgreen is not running" });
    await banner.waitFor();
    assert.match(await banner.innerText(), /What to do:.*\.\/sg-local start/s);
    await context.close();
  });

  test("rejects a wrong access code", async () => {
    const { context, page } = await openDashboard();
    await connect(page, "SG-WRNG-WRNG-WRNG");
    await page.getByRole("dialog").getByRole("alert").waitFor();
    const text = await page.getByRole("dialog").getByRole("alert").innerText();
    assert.match(text, /access code was not accepted/i);
    await context.close();
  });

  test("pairs with the daemon and controls presence", async () => {
    const { context, page, problems } = await openDashboard();
    await connect(page);

    // Live dashboard with the workspace from the daemon.
    await page.getByRole("heading", { name: "Workspaces", exact: true }).waitFor();
    await page.getByText("E2E Workspace").first().waitFor();
    await page.getByText("Live connection to Slack", { exact: true }).waitFor();

    // Pause and resume one workspace.
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.getByRole("button", { name: "Resume", exact: true }).waitFor();
    await waitFor(async () => (await daemonState()).workspaces[0].paused, "workspace paused");
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await page.getByRole("button", { name: "Pause", exact: true }).waitFor();
    await waitFor(async () => !(await daemonState()).workspaces[0].paused, "workspace resumed");

    // Pause everything for an hour, then resume.
    await page.getByRole("button", { name: "Pause 1 h" }).click();
    await waitFor(async () => (await daemonState()).paused, "global pause");
    await page.getByRole("button", { name: "Resume all" }).click();
    await waitFor(async () => !(await daemonState()).paused, "global resume");

    // Keep me online for 30 minutes, then cancel it.
    const keep = page.getByRole("region", { name: "Keep me online" });
    await keep.getByRole("button", { name: "30 minutes", exact: true }).click();
    await keep.getByRole("button", { name: /^Keep on for 30 min/ }).click();
    await keep.getByRole("button", { name: "Cancel", exact: true }).waitFor();
    assert.equal((await daemonState()).stay_active, true);
    await keep.getByRole("button", { name: "Cancel", exact: true }).click();
    await waitFor(async () => !(await daemonState()).stay_active, "override cleared");

    // Switch to a schedule and save it.
    await page.getByRole("group", { name: "Schedule mode" }).getByRole("button", { name: /Scheduled/ }).click();
    await page.getByRole("button", { name: "Save schedule" }).click();
    await waitFor(
      async () => (await daemonState()).schedule.mode === "scheduled",
      "schedule saved",
    );
    await api("POST", "/api/schedule", { mode: "always" });

    // The pairing survives a reload.
    await page.reload();
    await page.getByText("E2E Workspace").first().waitFor();

    // Disconnect (after the confirm dialog) goes back to the preview.
    await page.getByRole("button", { name: "Disconnect" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Disconnect" }).click();
    await page.getByText("Preview mode · sample data").waitFor();

    assert.deepEqual(problems, []);
    await context.close();
  });
});

describe("dashboard health", () => {
  test("shows three separate status signals", async () => {
    const { context, page, problems } = await openDashboard();
    await connect(page);
    const signals = page.getByRole("list", { name: "Status checks" });
    await signals.waitFor();
    assert.equal(await signals.getByRole("listitem").count(), 3);
    const running = signals.locator('[data-signal="running"]');
    const login = signals.locator('[data-signal="login"]');
    const presence = signals.locator('[data-signal="presence"]');
    assert.match(await running.innerText(), /Stillgreen running[\s\S]*Running/);
    await waitFor(async () => /Valid/.test(await login.innerText()), "login signal");
    assert.match(await presence.innerText(), /Presence confirmed/);
    assert.deepEqual(problems, []);
    await context.close();
  });

  test("turns the presence signal green only after Slack confirms it", async () => {
    // Start from a workspace Slack has never confirmed, while fake Slack's
    // own status check (users.getPresence) answers "away".
    for (const workspace of (await daemonState()).workspaces) {
      await api("DELETE", `/api/workspaces/${workspace.team_id}`);
    }
    await slackSet({ presence: "away" });
    try {
      const added = await api("POST", "/api/workspaces", { xoxc: SECOND_XOXC, xoxd: GOOD_XOXD });
      assert.equal(added.status, 200, JSON.stringify(added.body));
      const { context, page, problems } = await openDashboard();
      await connect(page);
      const signals = page.getByRole("list", { name: "Status checks" });
      const running = signals.locator('[data-signal="running"]');
      const login = signals.locator('[data-signal="login"]');
      const presence = signals.locator('[data-signal="presence"]');
      const title = page.locator("#status-title");
      await page.getByText("E2E Second Workspace").first().waitFor();

      // Running and logged in, but Slack has not said "active": not green.
      await waitFor(async () => (await running.getAttribute("data-tone")) === "pass", "running signal");
      await waitFor(async () => (await login.getAttribute("data-tone")) === "pass", "login signal", 30000);
      const before = await daemonState();
      assert.equal(before.health.daemon, true);
      assert.equal(before.workspaces[0].auth, "ok");
      assert.equal(before.workspaces[0].presence_verified_at, null);
      assert.notEqual(await presence.getAttribute("data-tone"), "pass");
      assert.doesNotMatch((await title.innerText()).trim(), /^Active/);

      // Slack now confirms: the third signal and the headline turn green.
      await slackSet({ presence: "active" });
      await waitFor(
        async () => (await daemonState()).workspaces[0].presence_verified_at,
        "Slack to confirm presence",
        30000,
      );
      await waitFor(async () => (await presence.getAttribute("data-tone")) === "pass", "presence signal", 30000);
      assert.match(await presence.innerText(), /Confirmed/);
      await title.filter({ hasText: /^Active/ }).waitFor({ timeout: 30000 });
      for (const signal of [running, login, presence]) {
        assert.equal(await signal.getAttribute("data-tone"), "pass");
      }
      assert.deepEqual(problems, []);
      await context.close();
    } finally {
      await slackSet({ presence: "active" });
      for (const workspace of (await daemonState()).workspaces) {
        await api("DELETE", `/api/workspaces/${workspace.team_id}`);
      }
      const added = await api("POST", "/api/workspaces", { xoxc: GOOD_XOXC, xoxd: GOOD_XOXD });
      assert.equal(added.status, 200, JSON.stringify(added.body));
    }
  });

  test("checks the setup and downloads a report without secrets", async () => {
    const { context, page, problems } = await openDashboard();
    await connect(page);
    const card = page.getByRole("region", { name: "Check my setup" });
    await card.getByText("no passwords, Slack tokens, cookies or access code").waitFor();
    await card.getByRole("button", { name: "Check my setup" }).click();
    await card.locator("[data-check]").first().waitFor({ timeout: 40000 });
    const ids = await card.locator("[data-check]").evaluateAll((items) => items.map((item) => item.dataset.check));
    assert.deepEqual([...ids].sort(), [...CHECK_IDS].sort());
    for (const id of ids) {
      const status = await card.locator(`[data-check="${id}"]`).getAttribute("data-status");
      assert.ok(["pass", "warn", "fail", "skip"].includes(status), `${id}: ${status}`);
    }

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      card.getByRole("button", { name: "Download report" }).click(),
    ]);
    assert.equal(download.suggestedFilename(), "stillgreen-diagnostics.txt");
    const report = await readFile(await download.path(), "utf8");
    assert.match(report, /Stillgreen diagnostics report/);
    assert.match(report, /E2E Workspace/);
    assert.match(report, /^Checks$/m);
    // No access code (in any spelling), Slack token, cookie or auth header.
    const compactCode = daemon.code.replace(/-/g, "");
    for (const secret of [daemon.code, daemon.code.toLowerCase(), compactCode, GOOD_XOXC, GOOD_XOXD, SECOND_XOXC]) {
      assert.ok(!report.includes(secret), "report must not contain a secret");
    }
    assert.doesNotMatch(report, /xox[cdp]-[A-Za-z0-9-]+/, "no Slack token or cookie shape");
    assert.doesNotMatch(report, /SG-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/, "no access code shape");
    assert.doesNotMatch(report, /Bearer\s+\S/, "no Authorization header");

    // The report needs the access code too.
    const refused = await fetch(`${daemon.base}/api/diagnostics/report`, {
      headers: { Authorization: "Bearer SG-WRNG-WRNG-WRNG" },
    });
    assert.equal(refused.status, 401);
    assert.equal((await refused.json()).error_code, "access_code_wrong");
    assert.deepEqual(problems, []);
    await context.close();
  });

  test("shows warn, skip and fail checks with the next step", async () => {
    const { context, page, problems } = await openDashboard();
    // A network where Slack can't be found: DNS fails, so TLS and the clock
    // check are skipped, and the proxy check only warns.
    await page.route((url) => url.href.startsWith(`${daemon.base}/api/diagnostics`) && !url.pathname.endsWith("/report"), (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": siteUrl },
        body: JSON.stringify({
          generated_at: new Date().toISOString(),
          checks: CHECK_IDS.map((id) => {
            const status = { dns: "fail", tls: "skip", clock: "skip", proxy: "warn" }[id] || "pass";
            return {
              id,
              label: `Check ${id}`,
              status,
              detail: `Detail for ${id}.`,
              action: status === "pass" || status === "skip" ? "" : `Fix ${id} like this.`,
              ...(status === "fail" ? { code: "dns_failed" } : {}),
            };
          }),
        }),
      }),
    );
    await connect(page);
    const card = page.getByRole("region", { name: "Check my setup" });
    await card.getByRole("button", { name: "Check my setup" }).click();
    await card.locator('[data-check="dns"]').waitFor();
    await card.getByText("1 problem", { exact: true }).waitFor();

    const row = (id) => card.locator(`[data-check="${id}"]`);
    assert.equal(await row("dns").getAttribute("data-status"), "fail");
    assert.match(await row("dns").innerText(), /Problem[\s\S]*Detail for dns\.[\s\S]*What to do:\s*Fix dns like this\./);
    assert.equal(await row("proxy").getAttribute("data-status"), "warn");
    assert.match(await row("proxy").innerText(), /Check[\s\S]*What to do:\s*Fix proxy like this\./);
    for (const id of ["tls", "clock"]) {
      assert.equal(await row(id).getAttribute("data-status"), "skip");
      assert.match(await row(id).innerText(), /Skipped[\s\S]*Detail for/);
      assert.doesNotMatch(await row(id).innerText(), /What to do/);
    }
    // A passed check shows no next step.
    assert.doesNotMatch(await row("python").innerText(), /What to do/);
    assert.deepEqual(problems, []);
    await context.close();
  });

  test("shows the daemon's own words when a change fails", async () => {
    const { context, page } = await openDashboard();
    await connect(page);
    await page.getByText("E2E Workspace").first().waitFor();
    const info = {
      code: "config_unreadable",
      title: "Settings file cannot be read",
      message: "Stillgreen could not read its settings file.",
      action: "Run ./sg-local doctor to see the problem.",
    };
    await page.route(`${daemon.base}/api/pause`, (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 500,
            contentType: "application/json",
            headers: { "Access-Control-Allow-Origin": siteUrl },
            body: JSON.stringify({ ok: false, error: "internal error", error_code: info.code, error_info: info }),
          })
        : route.continue(),
    );
    await page.getByRole("button", { name: "Pause 1 h" }).click();
    await page.getByText(info.title).first().waitFor();
    await page.getByText(info.action, { exact: false }).first().waitFor();
    assert.equal(await page.getByText("internal error").count(), 0);
    assert.equal((await daemonState()).paused, false);
    await context.close();
  });

  test("shows the setup checklist while no workspace is added", async () => {
    for (const workspace of (await daemonState()).workspaces) {
      await api("DELETE", `/api/workspaces/${workspace.team_id}`);
    }
    try {
      const { context, page, problems } = await openDashboard();
      await connect(page);
      const checklist = page.getByRole("region", { name: "Finish setting up" });
      await checklist.waitFor();
      const running = checklist.locator('[data-step="running"]');
      const slack = checklist.locator('[data-step="slack"]');
      assert.equal(await running.getAttribute("data-status"), "done");
      assert.equal(await slack.getAttribute("data-status"), "todo");
      assert.equal(await checklist.locator("[data-step]").count(), 5);
      await slack.getByRole("button", { name: "Add workspace" }).click();
      await page.getByRole("dialog", { name: "Add a Slack workspace" }).waitFor();
      assert.deepEqual(problems, []);
      await context.close();
    } finally {
      const added = await api("POST", "/api/workspaces", { xoxc: GOOD_XOXC, xoxd: GOOD_XOXD });
      assert.equal(added.status, 200, JSON.stringify(added.body));
    }
  });
});

describe("daemon control page", () => {
  test("loads and lists the workspace", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(daemon.base);
    await page.getByText("E2E Workspace").first().waitFor();
    await context.close();
  });
});

