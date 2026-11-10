// Weekly recurrence ("générateurs") shared by the server (which materializes the occurrences of the next two weeks
// into real availabilities / suggestions) and by the client (which draws the later occurrences on the fly).
//
// A generator repeats one interval every `intervalWeeks` weeks, on `weekday`, at `startMinute` (wall-clock time in
// `timeZone`, so 9:00 stays 9:00 across daylight saving changes). An occurrence is identified by its local date
// ("YYYY-MM-DD"): a cancellation ("cancelator") stores that date.

export interface Recurrence {
	/** 0 = Sunday … 6 = Saturday, in timeZone. */
	weekday: number;
	/** Minutes after local midnight. */
	startMinute: number;
	durationMinutes: number;
	/** 1 = every week, 2 = every other week… */
	intervalWeeks: number;
	/** IANA time zone, e.g. "Europe/Paris". */
	timeZone: string;
	/** First local date that may hold an occurrence (YYYY-MM-DD); it also fixes which weeks are used. */
	startsOn: string;
	/** Last local date that may hold an occurrence (inclusive), or null for no end. */
	endsOn: string | null;
}

export interface Occurrence {
	/** Local date of the occurrence, its identifier. */
	date: string;
	start: number;
	end: number;
}

const DAY_MS = 86_400_000;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const WEEKDAYS_FR = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
	let f = formatters.get(timeZone);
	if (!f) {
		f = new Intl.DateTimeFormat("en-US", {
			timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
		});
		formatters.set(timeZone, f);
	}
	return f;
}

export function isValidTimeZone(timeZone: unknown): timeZone is string {
	if (typeof timeZone !== "string" || !timeZone || timeZone.length > 64) return false;
	try { formatter(timeZone); return true; } catch { return false; }
}

/** Wall-clock parts of an instant in a time zone. */
function parts(ms: number, timeZone: string) {
	const p: Record<string, number> = {};
	for (const x of formatter(timeZone).formatToParts(new Date(ms))) if (x.type !== "literal") p[x.type] = Number(x.value);
	return { y: p.year, m: p.month, d: p.day, h: p.hour % 24, min: p.minute, s: p.second };
}

/** Offset (ms) of the time zone at an instant: local wall clock - UTC. */
function offset(ms: number, timeZone: string): number {
	const p = parts(ms, timeZone);
	return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(ms / 1000) * 1000;
}

/** Local date (YYYY-MM-DD) of an instant in a time zone. */
export function localDate(ms: number, timeZone: string): string {
	const p = parts(ms, timeZone);
	return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** Instant of a wall-clock time (date + minutes after midnight) in a time zone. */
export function zonedTime(date: string, minutes: number, timeZone: string): number {
	const [y, m, d] = date.split("-").map(Number);
	const guess = Date.UTC(y, m - 1, d, 0, minutes);
	const first = guess - offset(guess, timeZone);
	return guess - offset(first, timeZone);
}

/** Days since 1970-01-01 of a YYYY-MM-DD date. */
const dayNumber = (date: string) => { const [y, m, d] = date.split("-").map(Number); return Math.round(Date.UTC(y, m - 1, d) / DAY_MS); };
const fromDayNumber = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);

/**
 * Occurrences whose start is in [from, to), in chronological order.
 * Cancellations are not applied here (the caller knows them).
 */
export function occurrences(r: Recurrence, from: number, to: number): Occurrence[] {
	if (!(to > from) || !isValidTimeZone(r.timeZone) || !DATE_RE.test(r.startsOn)) return [];
	const startsOn = dayNumber(r.startsOn);
	// First date >= startsOn falling on the weekday: the weeks are counted from it.
	const anchor = startsOn + ((r.weekday - new Date(startsOn * DAY_MS).getUTCDay() + 7) % 7);
	const step = Math.max(1, r.intervalWeeks) * 7;
	const last = r.endsOn && DATE_RE.test(r.endsOn) ? dayNumber(r.endsOn) : Infinity;
	// One day of margin on each side: the local date can differ from the UTC date.
	let day = Math.max(anchor, dayNumber(localDate(from, r.timeZone)) - 1);
	day = anchor + Math.ceil((day - anchor) / step) * step;
	const out: Occurrence[] = [];
	const lastDay = Math.min(last, dayNumber(localDate(to, r.timeZone)) + 1);
	for (; day <= lastDay; day += step) {
		const date = fromDayNumber(day);
		const start = zonedTime(date, r.startMinute, r.timeZone);
		if (start < from) continue;
		if (start >= to) break;
		out.push({ date, start, end: start + r.durationMinutes * 60_000 });
	}
	return out;
}

/** "Chaque lundi" / "Toutes les 2 semaines, le lundi" + time range. */
export function describe(r: Pick<Recurrence, "weekday" | "startMinute" | "durationMinutes" | "intervalWeeks">): string {
	const t = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
	const day = WEEKDAYS_FR[r.weekday] ?? "?";
	const when = r.intervalWeeks > 1 ? `Toutes les ${r.intervalWeeks} semaines, le ${day}` : `Chaque ${day}`;
	return `${when}, ${t(r.startMinute)} – ${t(r.startMinute + r.durationMinutes)}`;
}
