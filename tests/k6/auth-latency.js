// k6 Load Test — AC7: p95 latency SLO verification
//
// Usage:
//   k6 run tests/k6/auth-latency.js \
//     -e BASE_URL=https://immi.trackit.today \
//     -e AUTH_TOKEN=<valid_access_jwt>
//
// Pass criteria (AC7):
//   anon  GET /api/v1/cases        → p95 < 15ms
//   authed GET /api/v1/collections → p95 < 40ms

import http from "k6/http";
import { check } from "k6";

const BASE_URL = __ENV.BASE_URL || "https://immi.trackit.today";
const AUTH_TOKEN = __ENV.AUTH_TOKEN || "";

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
    authed_collections: {
      executor: "constant-arrival-rate",
      rate: 100,
      timeUnit: "1s",
      duration: "30s",
      preAllocatedVUs: 20,
      maxVUs: 50,
      tags: { scenario: "authed_collections" },
      exec: "authedCollections",
      startTime: "32s",
    },
  },
  thresholds: {
    "http_req_duration{scenario:anon_cases}": ["p(95)<15"],
    "http_req_duration{scenario:authed_collections}": ["p(95)<40"],
    "http_req_failed{scenario:anon_cases}": ["rate<0.01"],
    "http_req_failed{scenario:authed_collections}": ["rate<0.01"],
  },
};

export function anonCases() {
  const res = http.get(`${BASE_URL}/api/v1/cases?limit=20`, {
    tags: { scenario: "anon_cases" },
  });
  check(res, { "anon cases 200": (r) => r.status === 200 });
}

export function authedCollections() {
  const res = http.get(`${BASE_URL}/api/v1/collections`, {
    headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    tags: { scenario: "authed_collections" },
  });
  check(res, {
    "authed collections 200 or 401": (r) => r.status === 200 || r.status === 401,
  });
}
