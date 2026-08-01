/**
 * 빡겜/즐겜 매칭 하드 조건 스모크 테스트
 * 실행: node --experimental-strip-types 또는 npx tsx scripts/check-duo-goal-match.mjs
 *
 * matcher.ts 를 직접 import 하려면 tsx 사용.
 */

import {
  isDuoGoalCompatible,
  findBestMatch,
} from "../lib/matching/matcher.ts";

function base(partial) {
  return {
    tier: 10,
    aggressionScore: 0.5,
    rolePreference: "duelist",
    secondsSinceLastSeen: 5,
    plan: "free",
    playstyleTags: [],
    matchPrefs: null,
    ...partial,
  };
}

const cases = [
  ["빡겜↔빡겜", "rank_up", "rank_up", true],
  ["즐겜↔즐겜", "casual_duo", "casual_duo", true],
  ["상관없음↔빡겜", "any", "rank_up", true],
  ["상관없음↔즐겜", "any", "casual_duo", true],
  ["빡겜↔즐겜", "rank_up", "casual_duo", false],
  ["즐겜↔빡겜", "casual_duo", "rank_up", false],
  ["null↔빡겜 (예전유저)", null, "rank_up", true],
  ["null↔즐겜", null, "casual_duo", true],
];

let failed = 0;

console.log("=== isDuoGoalCompatible ===");
for (const [name, a, b, expect] of cases) {
  const got = isDuoGoalCompatible(a, b);
  const ok = got === expect;
  if (!ok) failed += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"} | ${name} => ${got} (expect ${expect})`,
  );
}

console.log("");
console.log("=== findBestMatch (하드 필터) ===");

const me = base({ id: "me", duoGoal: "rank_up" });
const casualOnly = [base({ id: "c1", duoGoal: "casual_duo" })];
const mixed = [
  base({ id: "c1", duoGoal: "casual_duo" }),
  base({ id: "r1", duoGoal: "rank_up" }),
];
const anyPartner = [base({ id: "a1", duoGoal: "any" })];

const r1 = findBestMatch(me, casualOnly, 0);
const r2 = findBestMatch(me, mixed, 0);
const r3 = findBestMatch(me, anyPartner, 0);

const checks = [
  ["빡겜 큐에 즐겜만 → 매칭 없음", r1 === null, true],
  ["빡겜 큐에 즐겜+빡겜 → 빡겜 선택", r2?.user.id === "r1", true],
  ["빡겜 큐에 상관없음 → 매칭됨", r3?.user.id === "a1", true],
];

for (const [name, got, expect] of checks) {
  const ok = got === expect;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} | ${name}`);
}

console.log("");
if (failed === 0) {
  console.log(`ALL PASSED (${cases.length + checks.length} checks)`);
  process.exit(0);
}

console.log(`FAILED: ${failed}`);
process.exit(1);
