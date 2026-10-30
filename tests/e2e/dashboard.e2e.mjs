// Browser end-to-end test: the built Next.js dashboard driving the real
// daemon (with a fake Slack) through Chromium.
//
//   npm run test:e2e
//
// Needs a production build (`next build`), Python 3.11+ with `websockets`
// (set PYTHON to pick the interpreter), and Playwright's Chromium.

import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { createServer } from "node:net";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PYTHON = process.env.PYTHON || "python3";
const GOOD_XOXC = "xoxc-e2e-good-token";
const GOOD_XOXD = "xoxd-e2e-good-cookie";

let harness;
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
  const lines = createInterface({ input: harness.stdout });
  const [first] = await Promise.race([
    once(lines, "line"),
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
  await page.getByRole("button", { name: "Connect daemon" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Daemon URL").fill(daemon.base);
  await dialog.getByLabel("Access code").fill(code);
  await dialog.getByRole("button", { name: "Connect" }).click();
}

describe("dashboard", () => {
  test("shows sample data until paired", async () => {
    const { context, page, problems } = await openDashboard();
    await page.getByText("Preview mode · sample data").waitFor();
    assert.deepEqual(problems, []);
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
    await page.getByRole("heading", { name: "Connected Slack accounts" }).waitFor();
    await page.getByText("E2E Workspace").first().waitFor();
    await page.getByText("WebSocket connected").waitFor();

    // Pause and resume one workspace.
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.getByRole("button", { name: "Resume", exact: true }).waitFor();
    await waitFor(async () => (await daemonState()).workspaces[0].paused, "workspace paused");
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await page.getByRole("button", { name: "Pause", exact: true }).waitFor();
    await waitFor(async () => !(await daemonState()).workspaces[0].paused, "workspace resumed");

    // Pause everything for an hour, then resume.
    await page.getByRole("button", { name: "Pause all 1h" }).click();
    await waitFor(async () => (await daemonState()).paused, "global pause");
    await page.getByRole("button", { name: "Resume all" }).click();
    await waitFor(async () => !(await daemonState()).paused, "global resume");

    // Stay-online override.
    await page.getByRole("button", { name: "30m", exact: true }).click();
    await page.getByRole("button", { name: "Cancel override" }).waitFor();
    assert.equal((await daemonState()).stay_active, true);
    await page.getByRole("button", { name: "Cancel override" }).click();
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

    // Disconnect (after the confirm prompt) goes back to the preview.
    page.once("dialog", (prompt) => prompt.accept());
    await page.getByRole("button", { name: "Disconnect" }).click();
    await page.getByText("Preview mode · sample data").waitFor();

    assert.deepEqual(problems, []);
    await context.close();
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

