// k6 Load Test — AC7: p95 latency SLO verification
//
// Usage:
//   k6 run tests/k6/auth-latency.js \
//     -e BASE_URL=https://immi.trackit.today \
//     -e AUTH_TOKEN=<valid_access_jwt>
//
// Pass criteria (AC7):
//   anon  GET /api/v1/cases        → p95 < 15ms
//   authed GET /api/v1/auth/me   → p95 < 1000ms

import http from "k6/http";
import { check, fail, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "https://immi.trackit.today";
const AUTH_TOKEN = __ENV.AUTH_TOKEN || "";

// Pre-flight: verify token is valid and warm the Worker before load scenarios start.
// A 401 here aborts the run immediately rather than silently passing with wrong latency.
export function setup() {
  const res = http.get(`${BASE_URL}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
  });
  if (res.status !== 200) {
    fail(
      `setup: authed pre-flight returned ${res.status} — check AUTH_TOKEN is valid. ` +
        `Body: ${res.body.slice(0, 200)}`
    );
  }
  // Warm anon path too
  http.get(`${BASE_URL}/api/v1/cases?limit=1`);
  sleep(2);
}

export const options = {
  scenarios: {
    anon_cases: {
      executor: "constant-arrival-rate",
      rate: 100,
      timeUnit: "1s",
      duration: "30s",
      preAllocatedVUs: 20,
      maxVUs: 50,
      tags: { scenario: "anon_cases" },
      exec: "anonCases",
    },
    authed_auth_me: {
      executor: "constant-arrival-rate",
      rate: 100,
      timeUnit: "1s",
      duration: "30s",
      preAllocatedVUs: 20,
      maxVUs: 50,
      tags: { scenario: "authed_auth_me" },
      exec: "authedAuthMe",
      startTime: "32s",
    },
  },
  thresholds: {
    "http_req_duration{scenario:anon_cases}": ["p(95)<15"],
    "http_req_duration{scenario:authed_auth_me}": ["p(95)<1000"],
    "http_req_failed{scenario:anon_cases}": ["rate<0.01"],
    "http_req_failed{scenario:authed_auth_me}": ["rate<0.01"],
  },
};

export function anonCases() {
  const res = http.get(`${BASE_URL}/api/v1/cases?limit=20`, {
    tags: { scenario: "anon_cases" },
  });
  check(res, { "anon cases 200": (r) => r.status === 200 });
}

export function authedAuthMe() {
  const res = http.get(`${BASE_URL}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    tags: { scenario: "authed_auth_me" },
  });
  check(res, { "authed auth me 200": (r) => r.status === 200 });
}
