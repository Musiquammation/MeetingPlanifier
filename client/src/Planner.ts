// Planner: proposes meetings for the agent agenda, client side only (nothing is saved here).
//
// The problem is a weighted "job interval scheduling" problem (NP-hard in general): every consumer has
// windows (his availabilities ∩ the agent's hours), the agent can only be in one place at a time and needs
// the intercourse between two meetings. The goal is first to serve as many consumers as possible, then
// to use the slots both sides like most.
//
// Method: GRASP (Greedy Randomized Adaptive Search Procedure).
//  - one meeting per consumer, lasting min(maximum length, hours the consumer still asks for);
//  - candidates: every start (each quarter hour) where that meeting fits;
//  - one construction = each consumer, the most constrained first, takes his best slot still
//    compatible with what is already placed;
//  - the order and the scores are slightly randomised at each construction, and the best plan is kept.

import type { Proposal } from "./types";

const STEP_MS = 15 * 60000;
const ITERATIONS = 120;
/** Serving one more consumer always beats any amount of preference. */
const NEW_CONSUMER_BONUS = 1000;

interface Span { s: number; e: number }
interface Row extends Span { love: number }

export interface PlannerInput {
	from: number; to: number; now: number;
	/** Longest meeting proposed; a consumer asking for less gets what he asks for. */
	maxMinutes: number;
	/** Availabilities of the consumers taken into account (already filtered). */
	dispos: Array<{ assignationId: number; requestId: number; startAt: string; durationMinutes: number; love?: number }>;
	/** Agent's hours, with their contract. */
	suggestions: Array<{ contractId: number; startAt: string; durationMinutes: number; love?: number }>;
	contracts: Array<{ id: number; companyId: number }>;
	assignations: Array<{ id: number; companyId: number }>;
	/** Minutes still to schedule per request (missing request = no limit). */
	remaining: Map<number, number>;
	/** Meetings already fixed (not cancelled). */
	meetings: Array<{ assignationId: number; startAt: string; durationMinutes: number }>;
	/** Minutes required between meetings of two consumers. */
	gap: (a: number, b: number) => number;
}

interface Candidate { assignationId: number; s: number; e: number; score: number }
interface Placed { assignationId: number; s: number; e: number }

const span = (x: { startAt: string; durationMinutes: number }): Span => {
	const s = Date.parse(x.startAt);
	return { s, e: s + x.durationMinutes * 60000 };
};

/** Lowest love of the rows when they cover [s, e) without a hole, else null. Rows are sorted by start. */
function coverLove(rows: Row[], s: number, e: number): number | null {
	let at = s;
	let love = 1;
	for (const r of rows) {
		if (r.e <= at) continue;
		if (r.s > at) return null;
		love = Math.min(love, r.love);
		at = r.e;
		if (at >= e) return love;
	}
	return null;
}

export function plan(input: PlannerInput): Proposal[] {
	const earliest = Math.max(input.from, Math.ceil((input.now + 60000) / STEP_MS) * STEP_MS);

	// Agent's hours per company, sorted
	const hours = new Map<number, Row[]>();
	for (const x of input.suggestions) {
		const companyId = input.contracts.find((c) => c.id === x.contractId)?.companyId;
		if (companyId === undefined) continue;
		const list = hours.get(companyId) ?? [];
		list.push({ ...span(x), love: x.love ?? 0.5 });
		hours.set(companyId, list);
	}
	for (const list of hours.values()) list.sort((a, b) => a.s - b.s);

	const fixed: Placed[] = input.meetings.map((m) => ({ assignationId: m.assignationId, ...span(m) }));

	// Candidates: each quarter hour of each availability window where the whole meeting fits
	const byRequest = new Map<string, Row[]>();
	for (const d of input.dispos) {
		const k = `${d.assignationId}/${d.requestId}`;
		const list = byRequest.get(k) ?? [];
		list.push({ ...span(d), love: d.love ?? 0.5 });
		byRequest.set(k, list);
	}
	const candidates: Candidate[] = [];
	const seen = new Set<string>();
	for (const d of input.dispos) {
		// min(maximum length, remaining hours of the request), in whole quarter hours
		const minutes = Math.floor(Math.min(input.maxMinutes, input.remaining.get(d.requestId) ?? Infinity) / 15) * 15;
		if (minutes < 15) continue;
		const dur = minutes * 60000;
		const companyId = input.assignations.find((a) => a.id === d.assignationId)?.companyId;
		const agentRows = companyId === undefined ? undefined : hours.get(companyId);
		if (!agentRows) continue;
		const rows = byRequest.get(`${d.assignationId}/${d.requestId}`)!.sort((a, b) => a.s - b.s);
		const w = span(d);
		for (let s = Math.max(earliest, Math.ceil(w.s / STEP_MS) * STEP_MS); s < w.e && s + dur <= input.to; s += STEP_MS) {
			const key = `${d.assignationId}/${d.requestId}/${s}`;
			if (seen.has(key)) continue;
			seen.add(key);
			const e = s + dur;
			const dl = coverLove(rows, s, e);
			const al = dl === null ? null : coverLove(agentRows, s, e);
			if (dl === null || al === null) continue;
			const c: Candidate = { assignationId: d.assignationId, s, e, score: 1 + dl + al };
			if (fits(c, fixed, input.gap)) candidates.push(c);
		}
	}
	if (!candidates.length) return [];

	const byConsumer = new Map<number, Candidate[]>();
	for (const c of candidates) {
		const list = byConsumer.get(c.assignationId) ?? [];
		list.push(c);
		byConsumer.set(c.assignationId, list);
	}

	let best: { value: number; chosen: Candidate[] } = { value: -1, chosen: [] };
	for (let it = 0; it < ITERATIONS; it++) {
		const noise = it === 0 ? 0 : 0.6; // the first construction is the plain greedy one
		const chosen = construct(byConsumer, fixed, input.gap, noise);
		const value = evaluate(chosen);
		if (value > best.value) best = { value, chosen };
	}

	return best.chosen
		.sort((a, b) => a.s - b.s)
		.map((c) => ({ id: `proposal-${c.assignationId}-${c.s}`, assignationId: c.assignationId, start: new Date(c.s), end: new Date(c.e), score: c.score }));
}

/** True when the candidate overlaps nothing and keeps the intercourse with every placed meeting. */
function fits(c: Span & { assignationId: number }, placed: Placed[], gap: (a: number, b: number) => number): boolean {
	for (const p of placed) {
		const g = gap(c.assignationId, p.assignationId) * 60000;
		if (p.s < c.e + g && p.e + g > c.s) return false;
	}
	return true;
}

function construct(byConsumer: Map<number, Candidate[]>, fixed: Placed[], gap: PlannerInput["gap"], noise: number): Candidate[] {
	const placed: Placed[] = [...fixed];
	const chosen: Candidate[] = [];
	// Most constrained consumers first: the fewer slots still possible, the sooner they choose.
	const order = [...byConsumer.entries()]
		.map(([id, options]) => ({ id, options, key: options.length * (1 + noise * Math.random()) }))
		.sort((a, b) => a.key - b.key);
	for (const { options } of order) {
		let pick: Candidate | null = null;
		let pickScore = -Infinity;
		for (const c of options) {
			if (!fits(c, placed, gap)) continue;
			const sc = c.score + noise * Math.random();
			if (sc > pickScore) { pickScore = sc; pick = c; }
		}
		if (!pick) continue;
		chosen.push(pick);
		placed.push(pick);
	}
	return chosen;
}

function evaluate(chosen: Candidate[]): number {
	const consumers = new Set(chosen.map((c) => c.assignationId));
	return consumers.size * NEW_CONSUMER_BONUS + chosen.reduce((sum, c) => sum + c.score, 0);
}
