// Calendar: view model for the schedule panel (no DOM rendering here, the HTML templates do that).
// Responsibilities: visible range, navigation, overlap layout, selection by mouse drag or tap, swipe, settings.

export type EventKind = "meeting" | "dispo" | "suggestion" | "slot";

export interface CalEvent {
	id: string;
	kind: EventKind;
	start: Date;
	end: Date;
	title: string;
	status?: string;
	love?: number;
	editable?: boolean;
	raw: any;
}

export interface CalSettings {
	mode: "week" | "days"; // week: aligned on firstDay; days: starts on the selected date
	daysCount: number;
	firstDay: number; // 0 = Sunday, 1 = Monday, 6 = Saturday
	startHour: number;
	endHour: number;
}

interface Placed { ev: CalEvent; s: number; e: number; min: number; len: number; lane: number; lanes: number }
interface Selection { day: Date; from: number; to: number } // minutes since midnight
interface Drag { day: Date; col: HTMLElement; y0: number; moved: boolean; mouse: boolean }

// ---- Date helpers (shared with DomHandler) ----------------------------------
export const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
export const toLocalInput = (d: Date) => {
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const STORAGE_KEY = "planning.calendar";
const STEP = 15; // snapping, in minutes
const DEFAULTS: CalSettings = { mode: "week", daysCount: 7, firstDay: 1, startHour: 7, endHour: 22 };

function loadSettings(): CalSettings {
	try {
		const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
		if (saved && typeof saved === "object") return { ...DEFAULTS, ...saved };
	} catch { /* corrupted or unavailable storage: fall back to defaults */ }
	return { ...DEFAULTS };
}

export class Calendar {
	settings: CalSettings = loadSettings();
	anchor = new Date();
	events: CalEvent[] = [];
	now = new Date();
	isMobile = false;
	selection: Selection | null = null;

	onRange: (() => void) | null = null; // the visible range changed: reload data
	onSelect: ((start: Date, end: Date) => void) | null = null; // an empty slot was picked

	private drag: Drag | null = null;
	private swipe: { x: number; y: number } | null = null;
	private attached = false;

	/** Wires media query + clock. Safe to call several times. */
	attach(onRange: () => void): void {
		this.onRange = onRange;
		if (this.attached) return;
		this.attached = true;
		const mq = window.matchMedia("(max-width: 720px)");
		this.isMobile = mq.matches;
		mq.addEventListener("change", (e) => { this.isMobile = e.matches; this.onRange?.(); });
		window.setInterval(() => { this.now = new Date(); }, 60_000);
	}

	// ---- Visible range -------------------------------------------------
	get count(): number { return this.isMobile ? 1 : this.settings.daysCount; }
	get step(): number { return this.settings.mode === "week" && !this.isMobile ? 7 : this.count; }

	get first(): Date {
		const a = startOfDay(this.anchor);
		if (this.settings.mode === "week" && !this.isMobile) {
			return addDays(a, -((a.getDay() - this.settings.firstDay + 7) % 7));
		}
		return a;
	}

	get days(): Date[] { return Array.from({ length: this.count }, (_, i) => addDays(this.first, i)); }
	get hours(): number[] { return Array.from({ length: this.settings.endHour - this.settings.startHour }, (_, i) => this.settings.startHour + i); }
	get range(): { from: string; to: string } {
		return { from: this.first.toISOString(), to: addDays(this.first, this.count).toISOString() };
	}

	get title(): string {
		const f = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString("fr-FR", o);
		const days = this.days;
		if (days.length === 1) return f(days[0], { weekday: "long", day: "numeric", month: "long", year: "numeric" });
		return `${f(days[0], { day: "numeric", month: "short" })} – ${f(days[days.length - 1], { day: "numeric", month: "short", year: "numeric" })}`;
	}

	// ---- Formatting helpers used by the templates ------------------------
	key(d: Date) { return startOfDay(d).getTime(); }
	isToday(d: Date) { return sameDay(d, this.now); }
	dayName(d: Date) { return d.toLocaleDateString("fr-FR", { weekday: "short" }); }
	dayNum(d: Date) { return d.getDate(); }
	longDay(d: Date) { return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }); }
	time(d: Date) { return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }); }

	// ---- Navigation ----------------------------------------------------
	private changed() { this.onRange?.(); }
	prev() { this.anchor = addDays(this.first, -this.step); this.changed(); }
	next() { this.anchor = addDays(this.first, this.step); this.changed(); }
	today() { this.anchor = new Date(); this.changed(); }
	goTo(value: string) { if (value) { this.anchor = new Date(`${value}T00:00`); this.changed(); } }
	focusDay(d: Date) { this.anchor = d; this.setView("day"); }

	setView(view: "day" | "week") {
		this.settings.mode = view === "day" ? "days" : "week";
		this.settings.daysCount = view === "day" ? 1 : 7;
		this.apply();
	}

	// ---- Settings --------------------------------------------------------
	apply() {
		const s = this.settings;
		s.daysCount = Math.min(7, Math.max(1, Math.round(Number(s.daysCount)) || 7));
		s.startHour = Math.min(22, Math.max(0, Math.round(Number(s.startHour)) || 0));
		s.endHour = Math.min(24, Math.max(s.startHour + 1, Math.round(Number(s.endHour)) || 24));
		try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
		this.changed();
	}
	reset() { this.settings = { ...DEFAULTS }; this.apply(); }

	// ---- Layout ----------------------------------------------------------
	/** Events of one day with lane assignment so overlapping events sit side by side. */
	layoutFor(day: Date): Placed[] {
		const lo = new Date(day).setHours(this.settings.startHour, 0, 0, 0);
		const hi = new Date(day).setHours(this.settings.endHour, 0, 0, 0);
		const items: Placed[] = this.events
			.filter((e) => e.end.getTime() > lo && e.start.getTime() < hi)
			.map((ev) => {
				const s = Math.max(ev.start.getTime(), lo);
				const e = Math.min(ev.end.getTime(), hi);
				return { ev, s, e, min: (s - lo) / 60000, len: (e - s) / 60000, lane: 0, lanes: 1 };
			})
			.sort((a, b) => a.s - b.s || b.e - a.e);

		let cluster: Placed[] = [];
		let clusterEnd = 0;
		const flush = () => {
			const n = Math.max(...cluster.map((c) => c.lane)) + 1;
			cluster.forEach((c) => { c.lanes = n; });
			cluster = [];
		};
		for (const it of items) {
			if (cluster.length && it.s >= clusterEnd) flush();
			const used = new Set(cluster.filter((c) => c.e > it.s).map((c) => c.lane));
			let lane = 0;
			while (used.has(lane)) lane++;
			it.lane = lane;
			cluster.push(it);
			clusterEnd = cluster.length === 1 ? it.e : Math.max(clusterEnd, it.e);
		}
		if (cluster.length) flush();
		return items;
	}

	/** CSS custom properties consumed by style.css (see the x-place directive). */
	place(p: Placed) { return { "--start": p.min, "--dur": p.len, "--lane": p.lane, "--lanes": p.lanes }; }

	selectionFor(day: Date) {
		const s = this.selection;
		if (!s || !sameDay(s.day, day)) return null;
		return { "--start": s.from - this.settings.startHour * 60, "--dur": s.to - s.from };
	}
	selectionLabel(): string {
		const s = this.selection;
		if (!s) return "";
		const t = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
		return `${t(s.from)} – ${t(s.to)}`;
	}

	/** Minutes since the start of the visible hours for the "now" line, or null. */
	nowMin(day: Date): number | null {
		if (!sameDay(day, this.now)) return null;
		const m = this.now.getHours() * 60 + this.now.getMinutes() - this.settings.startHour * 60;
		return m >= 0 && m <= this.hours.length * 60 ? m : null;
	}

	scrollToNow(el: HTMLElement | undefined): void {
		if (!el) return;
		const perHour = el.scrollHeight / Math.max(1, this.hours.length);
		const h = this.days.some((d) => this.isToday(d)) ? this.now.getHours() - 1 : 8;
		el.scrollTop = Math.max(0, h - this.settings.startHour) * perHour;
	}

	// ---- Pointer interaction (mouse drag, tap) ---------------------------
	private minutesAt(e: PointerEvent, col: HTMLElement): number {
		const r = col.getBoundingClientRect();
		const lo = this.settings.startHour * 60;
		const hi = this.settings.endHour * 60 - STEP;
		const raw = lo + ((e.clientY - r.top) / r.height) * (hi + STEP - lo);
		return Math.min(hi, Math.max(lo, Math.floor(raw / STEP) * STEP));
	}

	down(e: PointerEvent, day: Date) {
		const target = e.target as HTMLElement;
		if (target.closest("[data-event]")) return; // events handle their own click
		const mouse = e.pointerType === "mouse";
		if (mouse && e.button !== 0) return;
		const col = e.currentTarget as HTMLElement;
		this.drag = { day, col, y0: this.minutesAt(e, col), moved: false, mouse };
		this.selection = null;
		col.setPointerCapture(e.pointerId);
	}

	move(e: PointerEvent) {
		const d = this.drag;
		if (!d) return;
		const m = this.minutesAt(e, d.col);
		if (m !== d.y0) d.moved = true;
		if (d.moved) this.selection = { day: d.day, from: Math.min(d.y0, m), to: Math.max(d.y0, m) + STEP };
	}

	up(e: PointerEvent) {
		const d = this.drag;
		this.drag = null;
		if (!d) return;
		if (d.col.hasPointerCapture(e.pointerId)) d.col.releasePointerCapture(e.pointerId);
		// A click or a tap (no drag) selects one hour by default.
		const sel = this.selection && d.moved ? this.selection : { day: d.day, from: d.y0, to: d.y0 + 60 };
		this.selection = sel;
		const start = new Date(d.day); start.setHours(0, sel.from, 0, 0);
		const end = new Date(d.day); end.setHours(0, sel.to, 0, 0);
		this.onSelect?.(start, end);
	}

	cancel() { this.drag = null; }

	// ---- Swipe (an extra way to change day, never the only one) ---------
	swipeStart(e: TouchEvent) { const t = e.changedTouches[0]; this.swipe = { x: t.clientX, y: t.clientY }; }
	swipeEnd(e: TouchEvent) {
		const s = this.swipe;
		this.swipe = null;
		if (!s) return;
		const t = e.changedTouches[0];
		const dx = t.clientX - s.x;
		const dy = t.clientY - s.y;
		if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) { if (dx < 0) this.next(); else this.prev(); }
	}
}
