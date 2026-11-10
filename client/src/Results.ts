// Results: view model shared by the "Résultats" pages of the administrator (#admin-results) and of the agent (#agent-results).
// Responsibilities: meeting state, filters, multi-level sorting (with priorities), grouping by month and the money split.
// No DOM rendering here: one single HTML block in index.html displays it for both roles.
//
// Money: the price of a meeting already contains the company's share, price = agent amount x (1 + societyRate / 100).
// Example with the default rate (28 %): price 32 EUR -> agent 25 EUR, company 7 EUR.
//  - "admin" mode shows the three amounts (paid, collected by the company, agent share);
//  - "agent" mode only shows the agent's own amount: the server does not even send him the price or the rate.

import type { Meeting } from "./types";

export type ResultsMode = "admin" | "agent";
/** pending = still to come · past = the time has passed but nobody validated it yet · done = marked as finished. */
export type MeetingState = "pending" | "past" | "done";
export type SortField = "date" | "agent" | "consumer" | "state" | "duration" | "rate" | "paid" | "society" | "share";
export type SortDir = "asc" | "desc";
export interface SortRule { field: SortField; dir: SortDir }

export interface ResultRow {
	id: number;
	agent: string;
	consumer: string;
	start: string;
	/** Duration counted: the actual one once validated with one, else the booked one. */
	minutes: number;
	/** Booked duration (differs from minutes when the meeting was validated with another duration). */
	plannedMinutes: number;
	hours: number;
	status: Meeting["status"];
	state: MeetingState;
	/** Hourly amount shown to the viewer: the price for the admin, the agent's own amount for the agent. */
	rate: number;
	/** Amount paid for the meeting (admin only). */
	paid: number;
	/** Amount kept by the company (admin only). */
	society: number;
	/** Amount received by the agent. */
	share: number;
	comment: string;
}

export interface ResultMonth {
	key: string;
	label: string;
	rows: ResultRow[];
	paid: number;
	society: number;
	share: number;
	hours: number;
}

export const STATE_LABEL: Record<MeetingState, string> = { pending: "En attente", past: "Fait", done: "Terminé" };
const STATE_RANK: Record<MeetingState, number> = { pending: 0, past: 1, done: 2 };
export const STATES: MeetingState[] = ["pending", "past", "done"];

const FIELD_LABEL: Record<SortField, string> = {
	date: "Date", agent: "Agent", consumer: "Consommateur", state: "État", duration: "Durée",
	rate: "Prix horaire", paid: "Payé", society: "Perçu (société)", share: "Part de l’agent"
};

const cents = (n: number) => Math.round(n * 100) / 100;
const person = (p: any): string => [p?.name, p?.surname].filter(Boolean).join(" ");
const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

/** State of a meeting at a given moment (cancelled meetings are not part of the results). */
export function meetingState(m: Pick<Meeting, "status" | "startAt" | "durationMinutes">, now = new Date()): MeetingState {
	if (m.status === "done") return "done";
	return Date.parse(m.startAt) + m.durationMinutes * 60000 <= now.getTime() ? "past" : "pending";
}

export class ResultsView {
	mode: ResultsMode = "admin";
	meetings: Meeting[] = [];
	assignations: any[] = [];

	/** The filter and sort menu can be hidden. */
	menuOpen = false;
	hiddenAgents: Record<number, boolean> = {};
	hiddenConsumers: Record<number, boolean> = {};
	hiddenStates: Record<string, boolean> = {};
	/** Sort rules by priority: the first one is the most important. Empty = by date inside each month. */
	sorts: SortRule[] = [];

	/** Loads the data of the page; the filters chosen by the user are kept. */
	setData(mode: ResultsMode, meetings: Meeting[], assignations: any[]): void {
		this.mode = mode;
		this.meetings = meetings;
		this.assignations = assignations;
		// A sort on a column the viewer cannot see (e.g. the agent's "paid" column) makes no sense.
		const allowed = new Set(this.fields().map((f) => f.value));
		this.sorts = this.sorts.filter((s) => allowed.has(s.field));
	}

	/** Forgets everything (logout). */
	clear(): void {
		this.meetings = []; this.assignations = [];
		this.hiddenAgents = {}; this.hiddenConsumers = {}; this.hiddenStates = {}; this.sorts = [];
	}

	// ---- Columns and options ---------------------------------------------------------
	get isAdmin(): boolean { return this.mode === "admin"; }

	/** Sortable columns of the viewer. */
	fields(): Array<{ value: SortField; label: string }> {
		const all: SortField[] = this.isAdmin
			? ["date", "agent", "consumer", "state", "duration", "rate", "paid", "society", "share"]
			: ["date", "consumer", "state", "duration", "rate", "share"];
		return all.map((value) => ({ value, label: value === "rate" && !this.isAdmin ? "Gain horaire" : value === "share" && !this.isAdmin ? "Mon gain" : FIELD_LABEL[value] }));
	}
	fieldLabel(f: SortField): string { return this.fields().find((x) => x.value === f)?.label ?? FIELD_LABEL[f]; }
	stateLabel(s: MeetingState): string { return STATE_LABEL[s]; }
	states(): MeetingState[] { return STATES; }

	agentOptions(): Array<{ id: number; label: string }> {
		const seen = new Map<number, string>();
		for (const a of this.assignations) if (a.agent && !seen.has(a.agent.id)) seen.set(a.agent.id, person(a.agent) || "Agent");
		return [...seen].map(([id, label]) => ({ id, label })).sort((x, y) => collator.compare(x.label, y.label));
	}
	consumerOptions(): Array<{ id: number; label: string }> {
		const seen = new Map<number, string>();
		for (const a of this.assignations) if (a.consumer && !seen.has(a.consumer.id)) seen.set(a.consumer.id, person(a.consumer) || "Consommateur");
		return [...seen].map(([id, label]) => ({ id, label })).sort((x, y) => collator.compare(x.label, y.label));
	}

	// ---- Filters ---------------------------------------------------------------------
	isAgentShown(id: number): boolean { return this.hiddenAgents[id] !== true; }
	isConsumerShown(id: number): boolean { return this.hiddenConsumers[id] !== true; }
	isStateShown(s: MeetingState): boolean { return this.hiddenStates[s] !== true; }
	toggleAgent(id: number): void { this.hiddenAgents = { ...this.hiddenAgents, [id]: this.isAgentShown(id) }; }
	toggleConsumer(id: number): void { this.hiddenConsumers = { ...this.hiddenConsumers, [id]: this.isConsumerShown(id) }; }
	toggleState(s: MeetingState): void { this.hiddenStates = { ...this.hiddenStates, [s]: this.isStateShown(s) }; }
	setAllAgents(on: boolean): void { this.hiddenAgents = Object.fromEntries(this.agentOptions().map((a) => [a.id, !on])); }
	setAllConsumers(on: boolean): void { this.hiddenConsumers = Object.fromEntries(this.consumerOptions().map((c) => [c.id, !on])); }
	setAllStates(on: boolean): void { this.hiddenStates = Object.fromEntries(STATES.map((s) => [s, !on])); }
	allAgentsShown(): boolean { return this.agentOptions().every((a) => this.isAgentShown(a.id)); }
	allConsumersShown(): boolean { return this.consumerOptions().every((c) => this.isConsumerShown(c.id)); }
	allStatesShown(): boolean { return STATES.every((s) => this.isStateShown(s)); }
	/** Number of hidden entries, shown on the menu button. */
	hiddenCount(): number {
		const n = (o: Record<string | number, boolean>) => Object.values(o).filter(Boolean).length;
		return n(this.hiddenAgents) + n(this.hiddenConsumers) + n(this.hiddenStates);
	}
	resetFilters(): void { this.hiddenAgents = {}; this.hiddenConsumers = {}; this.hiddenStates = {}; }

	// ---- Sorting (several rules, ordered by priority) ----------------------------------
	/** A field can only be used by one rule: the other fields stay available for the other rules. */
	isFieldTaken(field: SortField, ruleIndex: number): boolean { return this.sorts.some((s, i) => i !== ruleIndex && s.field === field); }
	canAddSort(): boolean { return this.fields().some((f) => !this.sorts.some((s) => s.field === f.value)); }
	addSort(): void {
		const free = this.fields().find((f) => !this.sorts.some((s) => s.field === f.value));
		if (free) this.sorts = [...this.sorts, { field: free.value, dir: "asc" }];
	}
	removeSort(i: number): void { this.sorts = this.sorts.filter((_, k) => k !== i); }
	setSortField(i: number, field: SortField): void { this.sorts = this.sorts.map((s, k) => (k === i ? { ...s, field } : s)); }
	toggleSortDir(i: number): void { this.sorts = this.sorts.map((s, k) => (k === i ? { ...s, dir: s.dir === "asc" ? "desc" : "asc" } : s)); }
	/** Moves a rule up (delta -1) or down (+1): its priority changes. */
	moveSort(i: number, delta: number): void {
		const j = i + delta;
		if (j < 0 || j >= this.sorts.length) return;
		const list = [...this.sorts];
		[list[i], list[j]] = [list[j], list[i]];
		this.sorts = list;
	}
	resetSorts(): void { this.sorts = []; }

	private sortValue(r: ResultRow, field: SortField): string | number {
		switch (field) {
			case "date": return Date.parse(r.start);
			case "agent": return r.agent;
			case "consumer": return r.consumer;
			case "state": return STATE_RANK[r.state];
			case "duration": return r.minutes;
			case "rate": return r.rate;
			case "paid": return r.paid;
			case "society": return r.society;
			case "share": return r.share;
		}
	}
	private compare(a: ResultRow, b: ResultRow): number {
		for (const rule of this.sorts) {
			const x = this.sortValue(a, rule.field), y = this.sortValue(b, rule.field);
			const c = typeof x === "string" ? collator.compare(x, String(y)) : x - (y as number);
			if (c !== 0) return rule.dir === "asc" ? c : -c;
		}
		return Date.parse(a.start) - Date.parse(b.start) || a.id - b.id; // stable fallback: oldest first
	}

	// ---- Rows and months -----------------------------------------------------------------
	private row(m: Meeting, a: any, now: Date): ResultRow {
		const minutes = m.actualDurationMinutes ?? m.durationMinutes;
		const hours = minutes / 60;
		let rate: number, paid = 0, society = 0, share: number;
		if (this.isAdmin) {
			const price = (m.hourlyRate ?? 0) * hours;
			const divider = 1 + (m.societyRate ?? 0) / 100; // price = agent amount x divider
			rate = m.hourlyRate ?? 0;
			paid = cents(price);
			share = cents(price / divider);
			society = cents(paid - share);
		} else {
			rate = m.agentHourlyRate ?? 0;
			share = cents(rate * hours);
		}
		return {
			id: m.id, agent: person(a.agent) || "Agent", consumer: person(a.consumer) || "Consommateur",
			start: m.startAt, minutes, plannedMinutes: m.durationMinutes, hours, status: m.status, state: meetingState(m, now),
			rate, paid, society, share, comment: m.comment ?? ""
		};
	}

	/** Meetings (not cancelled) after the filters, grouped by month, rows sorted by the rules. */
	months(): ResultMonth[] {
		const now = new Date();
		const months = new Map<string, ResultMonth>();
		for (const m of this.meetings) {
			if (m.status === "canceledBy") continue;
			const a = this.assignations.find((x) => x.id === m.assignationId);
			if (!a) continue;
			if (this.isAdmin && a.agent && !this.isAgentShown(a.agent.id)) continue;
			if (a.consumer && !this.isConsumerShown(a.consumer.id)) continue;
			const row = this.row(m, a, now);
			if (!this.isStateShown(row.state)) continue;
			const d = new Date(m.startAt);
			const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
			if (!months.has(key)) months.set(key, { key, label: d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }), rows: [], paid: 0, society: 0, share: 0, hours: 0 });
			const month = months.get(key)!;
			month.rows.push(row);
			month.paid = cents(month.paid + row.paid);
			month.society = cents(month.society + row.society);
			month.share = cents(month.share + row.share);
			month.hours += row.hours;
		}
		for (const month of months.values()) month.rows.sort((x, y) => this.compare(x, y));
		// Months follow the direction of the date rule when there is one (newest first otherwise).
		const asc = this.sorts.find((s) => s.field === "date")?.dir === "asc";
		return [...months.values()].sort((x, y) => (x.key < y.key ? 1 : -1) * (asc ? -1 : 1));
	}

	/** Totals of everything displayed. */
	totals(): { paid: number; society: number; share: number; hours: number; count: number } {
		const t = { paid: 0, society: 0, share: 0, hours: 0, count: 0 };
		for (const month of this.months()) {
			t.paid = cents(t.paid + month.paid); t.society = cents(t.society + month.society); t.share = cents(t.share + month.share);
			t.hours += month.hours; t.count += month.rows.length;
		}
		return t;
	}
}
