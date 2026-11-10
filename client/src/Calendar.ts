// Calendar: view model for the schedule panel (no DOM rendering here, the HTML templates do that).
// Responsibilities: visible range, navigation, overlap layout, selection (click, mouse drag, long press), swipe, settings.

export type EventKind = "meeting" | "dispo" | "suggestion" | "slot" | "proposal";

export interface CalEvent {
	id: string;
	kind: EventKind;
	start: Date;
	end: Date;
	title: string;
	status?: string;
	love?: number;
	editable?: boolean;
	/** Drawn from a generator, not stored yet (after the generated period, or while the period loads). */
	virtual?: boolean;
	/** Change sent to the server, answer not received yet (optimistic display). */
	pending?: boolean;
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
interface Drag {
	day: Date; col: HTMLElement; captureEl: HTMLElement; y0: number; y0Raw: number; x0: number; yPx0: number;
	moved: boolean; pressed: boolean; onEvent: boolean; mouse: boolean; pointerId: number; timer: number;
	/** Event under the pointer when the gesture started (see onSelect). */
	origin: CalEvent | null;
}

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
const TAP_MINUTES = 60; // a simple click on an empty space creates a slot of this length
const LONG_PRESS_MS = 450; // holding still this long opens a slot that can be stretched
const TAP_SLOP_PX = 8; // a finger moving more than this before the long press is a scroll
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
	/** Greyed bands drawn behind the events (intercourse between two meetings); never clickable. */
	gaps: CalEvent[] = [];
	now = new Date();
	isMobile = false;
	selection: Selection | null = null;
	/** Quarter hour under the last pointer down (lets a click on an event know where it happened). */
	lastPoint: Date | null = null;

	onRange: (() => void) | null = null; // the visible range changed: reload data
	/** A slot was picked; origin is the event under the pointer when the drag or long press started. */
	onSelect: ((start: Date, end: Date, origin: CalEvent | null) => void) | null = null;

	private drag: Drag | null = null;
	private swipe: { x: number; y: number } | null = null;
	private attached = false;
	private suppressEventClickUntil = 0;

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
	layoutFor(day: Date): Placed[] { return this.layout(this.events, day); }
	gapsFor(day: Date): Placed[] { return this.layout(this.gaps, day); }

	/** Same layout for an arbitrary list of events (the room calendar draws one column per room). */
	layout(events: CalEvent[], day: Date): Placed[] {
		const lo = new Date(day).setHours(this.settings.startHour, 0, 0, 0);
		const hi = new Date(day).setHours(this.settings.endHour, 0, 0, 0);
		const items: Placed[] = events
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
	private rawMinutesAt(e: PointerEvent, col: HTMLElement): number {
		const r = col.getBoundingClientRect();
		const lo = this.settings.startHour * 60;
		const hi = this.settings.endHour * 60;
		return Math.min(hi, Math.max(lo, lo + ((e.clientY - r.top) / r.height) * (hi - lo)));
	}

	/**
	 * Mouse: a click on an empty space creates a 1 h slot, a drag draws the slot.
	 * Touch (and mouse): holding still on the same quarter hour opens a slot that the drag then stretches.
	 * A finger that moves before the long press scrolls the page as usual.
	 * A click on an event opens it (handled by the template); a drag or long press over it draws a new slot
	 * and reports that event as the origin (the agent agenda books a meeting when it is an availability).
	 */
	down(e: PointerEvent, day: Date) {
		const mouse = e.pointerType === "mouse";
		if (mouse && e.button !== 0) return;
		this.clearTimer();
		const eventEl = (e.target as HTMLElement).closest<HTMLElement>("[data-event]");
		const col = e.currentTarget as HTMLElement;
		const captureEl = eventEl ?? col;
		const y0 = this.minutesAt(e, col);
		const d: Drag = {
			day, col, captureEl, y0, y0Raw: this.rawMinutesAt(e, col), x0: e.clientX, yPx0: e.clientY,
			moved: false, pressed: false, onEvent: !!eventEl, mouse, pointerId: e.pointerId, timer: 0,
			origin: this.events.find((x) => x.id === eventEl?.dataset.eventId) ?? null
		};
		d.timer = window.setTimeout(() => this.longPress(), LONG_PRESS_MS);
		this.drag = d;
		this.selection = null;
		this.lastPoint = this.dateAt(day, y0);
		// The mouse is captured at once; a finger only after the long press, so it can still scroll.
		if (mouse) this.capture(d);
	}

	private longPress() {
		const d = this.drag;
		if (!d || d.moved) return;
		d.pressed = true;
		d.timer = 0;
		this.capture(d);
		this.selection = { day: d.day, from: d.y0, to: d.y0 + STEP };
		navigator.vibrate?.(15);
	}

	move(e: PointerEvent) {
		const d = this.drag;
		if (!d || d.pointerId !== e.pointerId) return;
		if (!d.mouse && !d.pressed) {
			// Before the long press a moving finger is a scroll: forget the gesture.
			if (Math.hypot(e.clientX - d.x0, e.clientY - d.yPx0) > TAP_SLOP_PX) this.cancel();
			return;
		}
		// The mouse starts drawing once it leaves the first quarter hour.
		if (!d.pressed && !d.moved && Math.abs(this.rawMinutesAt(e, d.col) - d.y0Raw) > STEP) {
			d.moved = true;
			this.clearTimer();
		}
		if (d.moved || d.pressed) {
			const m = this.minutesAt(e, d.col);
			this.selection = { day: d.day, from: Math.min(d.y0, m), to: Math.max(d.y0, m) + STEP };
			e.preventDefault();
		}
	}

	/** Touch: once the slot is open, the finger stretches it instead of scrolling the page. */
	touchMove(e: TouchEvent) {
		if (this.drag?.pressed && e.cancelable) e.preventDefault();
	}

	up(e: PointerEvent) {
		const d = this.drag;
		if (!d || d.pointerId !== e.pointerId) return;
		this.clearTimer();
		this.drag = null;
		if (d.captureEl.hasPointerCapture(e.pointerId)) d.captureEl.releasePointerCapture(e.pointerId);
		const sel = this.selection;
		if ((d.moved || d.pressed) && sel) {
			this.suppressEventClickUntil = Date.now() + 500; // the click that follows must not open the event below
			this.onSelect?.(this.dateAt(d.day, sel.from), this.dateAt(d.day, sel.to), d.origin);
			return;
		}
		this.selection = null;
		// Simple click: on an event the template opens it, on an empty space it creates a 1 h slot.
		if (!d.onEvent) {
			const to = Math.min(d.y0 + TAP_MINUTES, this.settings.endHour * 60);
			this.selection = { day: d.day, from: d.y0, to };
			this.onSelect?.(this.dateAt(d.day, d.y0), this.dateAt(d.day, to), null);
		}
	}

	private capture(d: Drag) {
		try { d.captureEl.setPointerCapture(d.pointerId); } catch { /* pointer already released */ }
	}
	private clearTimer() {
		if (this.drag?.timer) window.clearTimeout(this.drag.timer);
	}
	private dateAt(day: Date, minutes: number): Date {
		const x = new Date(day); x.setHours(0, minutes, 0, 0); return x;
	}

	shouldSuppressEventClick(): boolean { return Date.now() < this.suppressEventClickUntil; }

	cancel() { this.clearTimer(); this.drag = null; this.selection = null; }

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

/** A Monday (local time): the "Habitudes" page draws this week, whatever the real date. */
const HABIT_WEEK = new Date(2001, 0, 1);

/**
 * Week template of the "Habitudes" page: one fixed reference week, days shown by name only (no dates).
 * Navigation (one day at a time on a phone) wraps inside that week; the weekday of a column is all that matters.
 */
export class HabitCalendar extends Calendar {
	constructor() {
		super();
		this.anchor = new Date(HABIT_WEEK);
	}

	get count(): number { return this.isMobile ? 1 : 7; }
	get step(): number { return this.isMobile ? 1 : 7; }
	get first(): Date {
		if (this.isMobile) return startOfDay(this.anchor);
		const a = startOfDay(HABIT_WEEK);
		return addDays(a, -((a.getDay() - this.settings.firstDay + 7) % 7));
	}
	get title(): string {
		if (!this.isMobile) return "Semaine type";
		const day = this.longDay(this.first);
		return day.charAt(0).toUpperCase() + day.slice(1);
	}

	/** Same weekday, inside the reference week. */
	private wrap(d: Date): Date {
		const base = startOfDay(HABIT_WEEK);
		const diff = Math.round((startOfDay(d).getTime() - base.getTime()) / 86_400_000);
		return addDays(base, ((diff % 7) + 7) % 7);
	}
	prev() { this.anchor = this.wrap(addDays(this.anchor, -1)); this.onRange?.(); }
	next() { this.anchor = this.wrap(addDays(this.anchor, 1)); this.onRange?.(); }
	today() { this.anchor = this.wrap(new Date()); this.onRange?.(); }

	/** The column of today's weekday is highlighted, with the "now" line. */
	isToday(d: Date): boolean { return d.getDay() === this.now.getDay(); }
	longDay(d: Date): string { return d.toLocaleDateString("fr-FR", { weekday: "long" }); }
	nowMin(day: Date): number | null {
		if (!this.isToday(day)) return null;
		const m = this.now.getHours() * 60 + this.now.getMinutes() - this.settings.startHour * 60;
		return m >= 0 && m <= this.hours.length * 60 ? m : null;
	}
}
