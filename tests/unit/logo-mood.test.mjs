// The logo switch's mood: on (laughing) only while Stillgreen is keeping you
// green. Checks brandMood() in lib/dashboard.ts and the copy of the same rule
// in the extension's worker (extension/background.js), case by case, so the
// two cannot drift. The control page's copy is covered by
// tests/e2e/control-page.e2e.mjs.
//
//   node --test tests/unit/logo-mood.test.mjs
//
// Needs Node 22.18+ (it loads lib/dashboard.ts with built-in type stripping).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { brandMood } = await import(path.join(ROOT, "lib/dashboard.ts"));

// Load the worker with a stub chrome object and take its keepingGreen().
function workerRule() {
  const context = vm.createContext({
    chrome: { runtime: { onMessage: { addListener() {} } } },
    URL,
    fetch: () => Promise.reject(new Error("no network in tests")),
  });
  vm.runInContext(readFileSync(path.join(ROOT, "extension/background.js"), "utf8"), context);
  return vm.runInContext("keepingGreen", context);
}
const keepingGreen = workerRule();

const NOW = Date.parse("2026-11-20T12:00:00Z");
const FRESH = new Date(NOW - 60000).toISOString();

function workspace(overrides = {}) {
  return {
    team_id: "T1",
    name: "Team",
    user_id: "U1",
    paused: false,
    status: "active",
    connected: true,
    reason: "",
    last_presence: null,
    last_error: null,
    stats: {},
    auth: "ok",
    presence: "active",
    presence_verified_at: FRESH,
    ...overrides,
  };
}

function state(overrides = {}) {
  return {
    ok: true,
    app: "stillgreen",
    version: "test",
    server_time: new Date(NOW).toISOString(),
    daemon: { running: true, pid: 1, started_at: null, updated_at: null, stopped_at: null },
    schedule: {
      mode: "always",
      active_days: [],
      start_time: "09:00",
      end_time: "17:00",
      timezone: "UTC",
      summary: "",
      active: true,
      next_change: null,
    },
    paused: false,
    pause_until: null,
    stay_active: false,
    stay_until: null,
    workspaces: [workspace()],
    connected_count: 1,
    activity: [],
    config_error: null,
    ...overrides,
  };
}

const waiting = workspace({ status: "connected", presence: "unknown", presence_verified_at: null });
const rejected = workspace({ status: "invalid_token", connected: false, auth: "rejected", presence: "unknown", presence_verified_at: null });
const offSchedule = { mode: "scheduled", active_days: ["mon"], start_time: "09:00", end_time: "17:00", timezone: "UTC", summary: "", active: false, next_change: null };

const CASES = [
  ["Active, always on", state(), "on"],
  ["Active, on schedule", state({ schedule: { ...offSchedule, active: true } }), "on"],
  ["Connected, waiting for Slack", state({ workspaces: [waiting] }), "on"],
  ["Keep me online, confirmed", state({ stay_active: true }), "on"],
  ["Keep me online, waiting for Slack", state({ stay_active: true, workspaces: [waiting] }), "on"],
  ["Keep me online while paused, confirmed", state({ stay_active: true, paused: true }), "on"],
  ["Keep me online, nothing connected yet", state({ stay_active: true, workspaces: [rejected] }), "off"],
  ["Paused", state({ paused: true }), "off"],
  ["Every workspace paused", state({ workspaces: [workspace({ paused: true })] }), "off"],
  ["Off schedule", state({ schedule: offSchedule }), "off"],
  ["Off schedule, waiting for Slack", state({ schedule: offSchedule, workspaces: [waiting] }), "off"],
  ["Stopped", state({ daemon: { running: false, pid: null, started_at: null, updated_at: null, stopped_at: null } }), "off"],
  ["No workspace", state({ workspaces: [] }), "off"],
  ["Every Slack login rejected", state({ workspaces: [rejected] }), "off"],
  ["Slack says away", state({ workspaces: [workspace({ connected: false, presence: "away" })] }), "off"],
  ["Settings file problem", state({ config_error: "bad json", workspaces: [] }), "off"],
];

describe("logo mood", () => {
  for (const [name, input, expected] of CASES) {
    test(`${name}: ${expected}`, () => {
      assert.equal(brandMood(input, false, NOW), expected, "dashboard brandMood()");
      // The worker reads the time from server_time, like the control page.
      assert.equal(keepingGreen(input) ? "on" : "off", expected, "extension keepingGreen()");
    });
  }

  test("can't reach Stillgreen: off", () => {
    assert.equal(brandMood(state(), true, NOW), "off");
  });

  test("the worker treats a missing or odd answer as off", () => {
    assert.equal(keepingGreen(null), false);
    assert.equal(keepingGreen({}), false);
    assert.equal(keepingGreen({ daemon: { running: true }, workspaces: "nope" }), false);
  });
});
