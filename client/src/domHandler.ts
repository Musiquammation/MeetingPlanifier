// DomHandler: single Alpine component of the app.
// It owns the hash router, the session, the data of every page and the agenda actions.
// `dom` is a reactive singleton: Alpine.data("app", () => dom) then Alpine.start().

import Alpine from "alpinejs";
import { Calendar, HabitCalendar, addDays, toLocalInput, type CalEvent, type EventKind } from "./Calendar";
import { ResultsView } from "./Results";
import { fetcher } from "./fetcher";
import { plan } from "./Planner";
import type { AgentScript, AvailabilityRequest, Company, Generator, GeneratorBody, IntercoursePair, Meeting, Package, Page, Proposal, Role, Room, ScriptRun } from "./types";
import { describe, localDate, occurrences, WEEKDAYS_FR } from "../../shared/recurrence";

/** Required role per page (null = public page). */
const PAGES: Record<Page, Role | null> = {
	main: null,
	"admin-welcome": null, "admin-login": null, "admin-signup": null,
	"admin-dashboard": "admin", "admin-companies": "admin", "admin-consumers": "admin", "admin-agents": "admin", "admin-rooms": "admin",
	"admin-packages": "admin", "admin-results": "admin",
	"agent-welcome": null, "agent-login": null, "agent-signup": null,
	"agent-dashboard": "agent", "agent-companies": "agent", "agent-consumers": "agent", "agent-agenda": "agent", "agent-habits": "agent", "agent-results": "agent", "agent-script": "agent",
	"consumer-welcome": null, "consumer-access": null,
	"consumer-dashboard": "consumer", "consumer-agenda": "consumer", "consumer-habits": "consumer"
};
/** Period wide enough to get every meeting, whatever its date (results pages). */
const ALL_FROM = "2000-01-01T00:00:00.000Z";
const ALL_TO = "2100-01-01T00:00:00.000Z";
/** Default percentage the company takes on the agent (same value as the server). */
const DEFAULT_SOCIETY_RATE = 28;
const HOME: Record<Role, Page> = { admin: "admin-dashboard", agent: "agent-dashboard", consumer: "consumer-dashboard" };
const STATUS: Record<string, string> = { pending: "En attente", done: "Terminé", canceledBy: "Annulé" };
const KIND: Record<EventKind, string> = { meeting: "Rendez-vous", dispo: "Disponibilité", suggestion: "Suggestion", slot: "Créneau de l’agent", proposal: "Proposition" };

/** The server reports minutes; the UI works in hours. */
const normRequest = (r: any): AvailabilityRequest => ({
	...r,
	requestedHours: r.requestedHours ?? Math.round((r.requestedMinutes ?? 0) / 6) / 10,
	scheduledHours: r.scheduledHours ?? Math.round((r.scheduledMinutes ?? 0) / 6) / 10,
	remainingHours: r.remainingHours ?? (r.remainingMinutes != null ? Math.round(r.remainingMinutes / 6) / 10 : undefined)
});
/** Hours a request still asks for (meetings already booked are not counted). */
const remainingOf = (r: AvailabilityRequest): number =>
	r.remainingHours ?? Math.max(0, Math.round((r.requestedHours - (r.scheduledHours ?? 0)) * 10) / 10);

/** Starting point of the script editor (see USERSCRIPT_API.md). */
const SCRIPT_TEMPLATE = `// Called on every meeting event of your agenda: "new-meeting", "update-meeting", "cancel-meeting" or "valid-meeting".
// Documentation: USERSCRIPT_API.md. Only env and args exist here (no require, fetch, process...).
async function userscript(env, args) {
	const { event, consumers, pricings, societyCommission } = args;
	const meeting = event.meeting;
	const consumer = consumers[meeting.consumer];
	env.log(event.type, meeting.startAt, consumer.name, consumer.surname, meeting.agentAmount + " EUR");

	// Example: send the event to your own service, with a key stored in the secrets.
	// const res = await env.post("https://example.com/webhook", { type: event.type, meeting }, {
	// 	headers: { Authorization: "Bearer " + env.secrets.API_KEY },
	// });
	// env.log(res.status, res.body);
}
`;
const SCRIPT_EVENTS: Record<string, string> = { "new-meeting": "Nouveau rendez-vous", "update-meeting": "Rendez-vous modifié (salle, commentaire)", "cancel-meeting": "Rendez-vous annulé", "valid-meeting": "Rendez-vous validé (terminé)" };
const RUN_STATUS: Record<string, string> = { ok: "Réussi", error: "Erreur", timeout: "Temps dépassé", skipped: "Ignoré" };

/** Temporary id of a row created on screen before the server answered (real ids are positive). */
const tempId = () => -1 - Math.floor(Math.random() * 1e9);
/** Time zone of the browser: the repetitions keep their wall-clock time in it. */
const browserTimeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } };
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
/** Form of the "Répétition automatique" section. */
const newGenForm = () => {
	const today = new Date();
	return { id: null as number | null, weekday: today.getDay(), start: "09:00", duration: 120, love: 0.5, intervalWeeks: 1,
		startsOn: localDate(today.getTime(), browserTimeZone()), endsOn: "", contractId: null as number | null };
};

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const horizon = (days: number) => ({ from: new Date().toISOString(), to: addDays(new Date(), days).toISOString() });

export class DomHandler {
	ready = false;
	page: Page = "main";
	role: Role | null = null;
	user: any = null;
	company: Company | null = null;

	busy = false; // a submit is running (blocks double clicks)
	loading = false; // data is being loaded
	/** Changes already shown on screen and still being sent to the server (optimistic updates). */
	syncing = 0
	error = "";
	notice = "";
	flash = ""; // message to show after the next navigation
	form: Record<string, any> = {};
	created: any = null; // last created/enrolled consumer (shows the access key once)

	companies: Company[] = [];
	consumers: any[] = [];
	agents: any[] = [];
	rooms: Room[] = [];
	results: any[] = [];
	meetings: Meeting[] = [];
	contracts: any[] = [];
	assignations: any[] = [];
	suggestions: any[] = [];
	dispos: any[] = [];
	requests: AvailabilityRequest[] = [];
	slots: any[] = [];
	agentsList: any[] = []; // agents assigned to the connected consumer
	selAssign: number | null = null;
	panel: any = null;
	showDispo: Record<number, boolean> = {}; // agent agenda: assignation id -> consumer availabilities displayed (default: all)
	agentResults: any[] = [];
	searched = false; // an agent search has been run
	openAgent: number | null = null; // agent whose assignations are displayed
	packages: Package[] = []; // hourly-rate formulas of the company
	// Room page: drag and drop ordering, day calendar of the rooms and the manual assignment dialog
	dragRoom: number | null = null;
	overRoom: number | null = null;
	roomCal = new Calendar(); // one day, one column per room (never persisted: see applyRoomHours)
	roomMeetings: Meeting[] = [];
	assignDialog: { agent: any; q: string; fidelityId: string; error: string } = { agent: null, q: "", fidelityId: "", error: "" };
	// Results pages (admin and agent share the same view model: filters, sorting, months, money split)
	res = new ResultsView();
	// Agent agenda: only show the consumers who still ask for hours
	onlyRequesters = false;
	// Intercourse ("intercours"): pair values of the agent, and the consumer whose pair values are displayed
	intercoursePairs: IntercoursePair[] = [];
	openIntercourse: number | null = null;
	// Agent agenda: meetings proposed by the optimizer, kept in memory until validated or erased
	proposals: Proposal[] = [];
	planForm = { maxMinutes: 120 }; // longest proposed meeting (default 2 h)
	// Script page: the code being edited (saved on demand), secrets (names only), test runner and history
	script: AgentScript | null = null;
	scriptCode = "";
	scriptRuns: ScriptRun[] = [];
	scriptTest: { type: string; meetingId: string; last: ScriptRun | null } = { type: "new-meeting", meetingId: "", last: null };
	secretForm = { name: "", value: "" };
	openRun: number | null = null;

	// Weekly repetitions ("générateurs"): mine, and the other side's (the consumers' for the agent, the agents' for the consumer)
	generators: Generator[] = [];
	otherGenerators: Generator[] = [];
	/** "Habitudes" page: the week template, and the habit to open once the page is loaded. */
	habitCal = new HabitCalendar();
	private habitToEdit: number | null = null;
	/** The rows of the visible period came from the server (until then the agenda shows what the generators give). */
	rangeLoaded = false;
	/** Occurrences drawn from the generators for the visible period (also used by the booking check and the planner). */
	virtualDispos: any[] = [];
	virtualSuggestions: any[] = [];
	// Results page: meeting being validated, with the duration really spent
	doneEdit: { id: number; minutes: number } | null = null;

	cal = new Calendar();

	private agendaSeq = 0;
	private loadedRange = "";
	private syncChain: Promise<unknown> = Promise.resolve();
	private resyncWanted = false;
	private lastButton: { el: HTMLButtonElement; at: number } | null = null;

	/** Alpine looks methods up on own properties: bind them to the reactive proxy. */
	bindAll(self: this): void {
		for (const k of Object.getOwnPropertyNames(DomHandler.prototype)) {
			const f = (this as any)[k];
			if (k !== "constructor" && k !== "bindAll" && typeof f === "function") (this as any)[k] = f.bind(self);
		}
	}

	// ---- Bootstrap -------------------------------------------------------
	async start(): Promise<void> {
		fetcher.onUnauthorized = () => {
			this.clearSession();
			this.flash = "Votre session a expiré. Reconnectez-vous.";
			this.go("main");
		};
		window.addEventListener("hashchange", () => void this.route());
		// Remembers the button that started an action, so it can show a spinner while the action runs (see run()).
		document.addEventListener("click", (e) => {
			const el = (e.target as Element | null)?.closest?.("button");
			this.lastButton = el ? { el, at: Date.now() } : null;
		}, true);

		// x-place copies { "--name": value } onto the element as CSS custom properties,
		// so positions live in style.css rules and never in the HTML.
		Alpine.directive("place", (el, { expression }, { evaluate, effect }) => {
			effect(() => {
				const vars = evaluate(expression) as Record<string, string | number> | null;
				if (vars) for (const [k, v] of Object.entries(vars)) (el as HTMLElement).style.setProperty(k, String(v));
			});
		});
		Alpine.data("app", () => dom);
		Alpine.start();

		await this.restore();
		await this.route();
	}

	// ---- Session ---------------------------------------------------------
	private async restore(): Promise<void> {
		if (!fetcher.token) return;
		try {
			const me = await fetcher.me();
			this.role = me.role;
			this.user = me.user;
			if (me.role === "admin") this.company = (await fetcher.companies())[0] ?? null;
		} catch { this.clearSession(); }
	}

	private startSession(role: Role, r: any): void {
		fetcher.setToken(r.token);
		this.role = role;
		this.user = r.user;
		this.company = r.company ?? null;
	}

	private clearSession(): void {
		fetcher.setToken(null);
		this.role = null; this.user = null; this.company = null;
		this.meetings = []; this.consumers = []; this.agents = []; this.rooms = []; this.dispos = [];
		this.suggestions = []; this.slots = []; this.requests = []; this.agentsList = []; this.selAssign = null; this.assignations = []; this.showDispo = {};
		this.cal.events = [];
		this.packages = []; this.roomMeetings = []; this.res.clear(); this.roomCal.events = [];
		this.onlyRequesters = false;
		this.intercoursePairs = []; this.openIntercourse = null; this.proposals = []; this.cal.gaps = [];
		this.script = null; this.scriptCode = ""; this.scriptRuns = []; this.scriptTest = { type: "new-meeting", meetingId: "", last: null };
		this.generators = []; this.otherGenerators = []; this.habitCal.events = []; this.habitToEdit = null; this.virtualDispos = []; this.virtualSuggestions = [];
		this.rangeLoaded = false; this.loadedRange = ""; this.doneEdit = null;
	}

	async logout(): Promise<void> {
		try { await fetcher.logout(); } catch { /* the token is dropped locally anyway */ }
		this.clearSession();
		this.go("main");
	}

	// ---- Router ----------------------------------------------------------
	go(page: Page): void {
		if (location.hash === `#${page}`) void this.route();
		else location.hash = page;
	}

	async route(): Promise<void> {
		const [raw, query = ""] = location.hash.replace(/^#\/?/, "").split("?", 2);
		// Access link sent by the admin: #consumer-welcome?key=ABCDEF logs the consumer in directly.
		const accessKey = raw === "consumer-welcome" ? (new URLSearchParams(query).get("key") ?? "").trim() : "";
		if (accessKey) return this.accessWithKey(accessKey);
		let page = (Object.prototype.hasOwnProperty.call(PAGES, raw) ? raw : "main") as Page;
		const need = PAGES[page];
		if (need && this.role !== need) page = `${need}-welcome` as Page; // private page without matching session
		else if (!need && this.role && page.startsWith(`${this.role}-`)) page = HOME[this.role]; // already logged in
		if (location.hash !== `#${page}`) history.replaceState(null, "", `#${page}`);

		this.page = page;
		this.form = {}; this.created = null; this.panel = null; this.results = []; this.doneEdit = null;
		this.notice = ""; this.error = this.flash; this.flash = "";
		this.ready = true;
		window.scrollTo(0, 0);
		await this.loadPage();
	}

	/** Opens the consumer space with the key of an access link; on failure the access form is shown, prefilled. */
	private async accessWithKey(key: string): Promise<void> {
		history.replaceState(null, "", "#consumer-access"); // the key does not stay in the address bar
		if (this.role) { // the link wins over the session already open in this browser
			try { await fetcher.logout(); } catch { /* the token is dropped locally anyway */ }
			this.clearSession();
		}
		try {
			this.startSession("consumer", await fetcher.consumerAccess(key));
			this.go(HOME.consumer);
		} catch (e: any) {
			this.flash = e?.message ?? "Clé d’accès invalide.";
			await this.route();
			this.form.key = key;
		}
	}

	// ---- Helpers for submits and loads -----------------------------------
	private async run(fn: () => Promise<void>, ok = ""): Promise<void> {
		if (this.busy) return;
		this.busy = true; this.error = ""; this.notice = "";
		if (this.panel) this.panel.error = "";
		// The button that was just clicked shows a spinner until the server answers.
		const button = this.lastButton && Date.now() - this.lastButton.at < 1000 ? this.lastButton.el : null;
		button?.setAttribute("aria-busy", "true");
		try {
			await fn();
			if (ok) this.notice = ok;
		} catch (e: any) {
			const msg = e?.message ?? "Une erreur est survenue.";
			if (this.panel) this.panel.error = msg; else this.error = msg;
		} finally {
			this.busy = false;
			button?.removeAttribute("aria-busy");
		}
	}

	/**
	 * Optimistic change, for what the browser can guess without the server: `apply` changes the screen at once and
	 * returns how to undo it, `send` talks to the server in the background. Sends run one after the other, in order.
	 * If the server refuses, the change is undone and the error shown. Once nothing is left to send, the page data is
	 * reloaded quietly (no spinner) so the screen matches the server (remaining hours, generated rows…).
	 */
	private optimistic(apply: () => (() => void) | void, send: () => Promise<void>, ok = ""): Promise<void> {
		this.error = ""; this.notice = "";
		const page = this.page;
		const undo = apply();
		this.redraw();
		this.syncing += 1;
		const task = this.syncChain.then(send).then(
			() => { if (ok && this.page === page) this.notice = ok; },
			(e: any) => {
				undo?.();
				if (this.page === page) this.error = e?.message ?? "Une erreur est survenue : la modification a été annulée.";
			},
		).finally(() => {
			this.syncing -= 1;
			this.resyncWanted = true;
			this.redraw();
			if (!this.syncing && this.resyncWanted && this.page === page) {
				this.resyncWanted = false;
				void this.quietReload();
			}
		});
		this.syncChain = task;
		return task;
	}

	/** Rebuilds what is drawn from the data (the calendar is not reactive to the arrays it is built from). */
	private redraw(): void {
		if (this.page === "agent-agenda" || this.page === "consumer-agenda") this.cal.events = this.buildEvents();
		if (this.page === "agent-habits" || this.page === "consumer-habits") this.habitCal.events = this.buildHabitEvents();
	}

	/** Reloads the data of the page without any spinner (after optimistic changes). */
	private async quietReload(): Promise<void> {
		try {
			if (this.page === "agent-agenda" || this.page === "consumer-agenda") await this.refreshAgenda(true);
			else if (this.page === "agent-habits" || this.page === "consumer-habits") await this.loadHabits();
			else if (this.page === "admin-results" || this.page === "agent-results") await this.reloadResults();
			else if (this.page === "admin-dashboard") { const { from, to } = horizon(14); this.meetings = (await fetcher.agenda(from, to)).meetings ?? []; }
		} catch { /* the next navigation reloads anyway */ }
	}

	/** Runs synchronous checks of a form; the message goes to the panel (or the page) and false is returned. */
	private check(fn: () => void): boolean {
		this.error = "";
		if (this.panel) this.panel.error = "";
		try { fn(); return true; } catch (e: any) {
			const msg = e?.message ?? "Valeur invalide.";
			if (this.panel) this.panel.error = msg; else this.error = msg;
			return false;
		}
	}

	private async load(fn: () => Promise<void>): Promise<void> {
		this.loading = true; this.error = "";
		try { await fn(); } catch (e: any) { this.error = e?.message ?? "Chargement impossible."; } finally { this.loading = false; }
	}

	private async loadPage(): Promise<void> {
		const { from, to } = horizon(14);
		switch (this.page) {
			case "admin-dashboard":
				return this.load(async () => {
					// The assignations give the agent and the consumer of each meeting; the rooms feed the room selector.
					const [a, c, ag, asg, rooms] = await Promise.all([fetcher.agenda(from, to), fetcher.consumers(), fetcher.agents(), fetcher.assignations(), fetcher.rooms()]);
					this.meetings = a.meetings ?? []; this.consumers = c; this.agents = ag; this.assignations = asg; this.rooms = rooms;
				});
			case "admin-companies": case "agent-companies":
				return this.load(async () => {
					this.companies = await fetcher.companies();
					if (this.role === "admin") this.form.societyRate = this.companies[0]?.societyRate ?? DEFAULT_SOCIETY_RATE;
				});
			case "admin-consumers":
				return this.load(async () => { [this.consumers, this.agents, this.packages] = await Promise.all([fetcher.consumers(), fetcher.agents(), fetcher.packages()]); });
			case "admin-agents":
				this.agentResults = []; this.searched = false; this.openAgent = null;
				return this.load(async () => { [this.consumers, this.agents, this.assignations, this.packages] = await Promise.all([fetcher.consumers(), fetcher.agents(), fetcher.assignations(), fetcher.packages()]); });
			case "admin-rooms":
				// The room calendar shows one day; its settings are local to the page and never saved.
				this.roomCal.settings = { ...this.roomCal.settings, mode: "days", daysCount: 1 };
				this.roomCal.onRange = () => void this.load(() => this.loadRoomCalendar());
				this.form = { ...this.form, ...this.roomPeriodDefaults() }; // period to plan: today, 7:00 to 22:00
				return this.load(async () => {
					this.assignations = await fetcher.assignations();
					await this.loadRooms();
					await this.loadRoomCalendar();
				});
			case "admin-packages":
				return this.load(async () => { this.packages = await fetcher.packages(); });
			case "admin-results":
				return this.load(async () => {
					// Every meeting of the company, whatever its date; the assignations give the agent and the consumer of each one.
					const [a, asg] = await Promise.all([fetcher.agenda(ALL_FROM, ALL_TO), fetcher.assignations()]);
					this.res.setData("admin", a.meetings ?? [], asg);
				});
			case "agent-results":
				return this.load(async () => {
					// The server only sends the agent his own meetings, and only his own share of the money.
					const a = await fetcher.agenda(ALL_FROM, ALL_TO);
					this.res.setData("agent", a.meetings ?? [], a.assignations ?? []);
				});
			case "agent-consumers":
				this.openIntercourse = null;
				return this.load(async () => { [this.assignations, this.intercoursePairs] = await Promise.all([fetcher.myConsumers(), fetcher.intercoursePairs()]); });
			case "agent-dashboard":
				return this.load(async () => {
					const a = await fetcher.agenda(from, to);
					this.meetings = a.meetings ?? []; this.contracts = a.contracts ?? []; this.assignations = a.assignations ?? [];
					this.dispos = await fetcher.disponibilities({ from, to });
				});
			case "consumer-dashboard":
				return this.load(async () => {
					const a = await fetcher.agenda(from, to);
					this.meetings = a.meetings ?? []; this.agentsList = a.agents ?? []; this.requests = (a.requests ?? []).map(normRequest);
				});
			case "agent-script":
				this.secretForm = { name: "", value: "" }; this.openRun = null;
				this.scriptTest = { ...this.scriptTest, last: null };
				return this.load(async () => {
					const [script, runs, agenda] = await Promise.all([fetcher.script(), fetcher.scriptRuns(), fetcher.agenda(ALL_FROM, ALL_TO)]);
					this.script = script;
					this.scriptCode = script.code || SCRIPT_TEMPLATE;
					this.scriptRuns = runs;
					// Meetings the test can be run on (most recent first)
					this.meetings = (agenda.meetings ?? []).slice().sort((a: Meeting, b: Meeting) => Date.parse(b.startAt) - Date.parse(a.startAt));
					this.assignations = agenda.assignations ?? [];
				});
			case "agent-habits": case "consumer-habits":
				return this.openHabits();
			case "agent-agenda": case "consumer-agenda":
				return this.openAgenda();
		}
	}

	// ---- Display helpers (used by the templates) ---------------------------
	fmt(iso: string): string {
		return new Date(iso).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
	}
	statusLabel(s: string) { return STATUS[s] ?? s; }
	kindLabel(k: EventKind) { return KIND[k]; }
	roomOf(m: any): string { return m.roomName ?? m.room ?? "Sans salle"; }
	agentLabel(a: any): string { return [a.name ?? a.agent?.name, a.surname ?? a.agent?.surname].filter(Boolean).join(" ") || "Agent"; }
	assignId(a: any): number { return a.assignationId ?? a.id; }
	/** listConsumersForCompany returns { consumer, fidelity }; search results are flat. */
	consumerOf(c: any): any { return c.consumer ?? c; }
	/** Stable list key: wrapped records ({ consumer, fidelity }) have no top-level id. */
	consumerKey(c: any): number { return this.consumerOf(c).id; }
	consumerLabel(c: any): string { const x = this.consumerOf(c); return [x.name, x.surname].filter(Boolean).join(" ") || "Consommateur"; }
	assignationsOf(a: any): any[] { return this.assignations.filter((x) => (x.agentId ?? x.agent?.id) === a.id); }
	isShown(assignationId: number): boolean { return this.showDispo[assignationId] !== false; }
	/**
	 * A consumer is "requesting" when one of his requests is still open with hours left to schedule
	 * (a request without limit counts: he wants meetings and nothing has capped them).
	 */
	isRequester(assignationId: number): boolean {
		return this.requests.some((r) => r.assignationId === assignationId && (r.status ?? "open") === "open"
			&& (r.remainingMinutes ?? Math.round((r.requestedHours - (r.scheduledHours ?? 0)) * 60)) > 0);
	}
	/** Consumers listed in the agent agenda: everybody, or only the requesting ones when "Demandeurs" is checked. */
	visibleAssignations(): any[] { return this.onlyRequesters ? this.assignations.filter((x) => this.isRequester(x.id)) : this.assignations; }
	/** True when the availabilities of this consumer are drawn in the agent agenda. */
	isVisible(assignationId: number): boolean { return this.isShown(assignationId) && (!this.onlyRequesters || this.isRequester(assignationId)); }
	toggleRequesters(): void {
		this.onlyRequesters = !this.onlyRequesters;
		this.cal.events = this.buildEvents();
	}
	toggleConsumer(assignationId: number): void {
		this.showDispo = { ...this.showDispo, [assignationId]: !this.isShown(assignationId) };
		this.cal.events = this.buildEvents();
	}
	/** "Tous": applies to the consumers currently listed (all of them, or only the requesting ones). */
	setAllConsumers(on: boolean): void {
		const next = { ...this.showDispo };
		for (const x of this.visibleAssignations()) next[x.id] = on;
		this.showDispo = next;
		this.cal.events = this.buildEvents();
	}
	/** Agent: open the agenda showing only this consumer's availabilities. */
	showOnly(assignationId: number): void {
		this.showDispo = Object.fromEntries(this.assignations.map((x) => [x.id, x.id === assignationId]));
		this.go("agent-agenda");
	}
	inCompany(a: any): boolean { return this.agents.some((x) => x.id === a.id); }
	fidelityId(c: any): number { return c.fidelityId ?? c.fidelity?.id; }
	fidelityKey(c: any): string { return c.fidelityKey ?? c.fidelity?.key ?? "—"; }
	copyConsumerLink(c: any): void {
		const key = this.fidelityKey(c);
		if (!key || key === "—") { this.error = "Aucune clé d’accès disponible pour ce consommateur."; return; }
		const link = `${location.origin}${location.pathname}#consumer-welcome?key=${encodeURIComponent(key)}`;
		const done = () => { this.notice = `Lien d’accès de ${this.consumerLabel(c)} copié : ${link}`; this.error = ""; };
		const fallback = () => { // navigator.clipboard only exists on https or localhost
			const area = document.createElement("textarea");
			area.value = link;
			document.body.append(area);
			area.select();
			const ok = document.execCommand("copy");
			area.remove();
			if (ok) done(); else { this.notice = ""; this.error = `Copie impossible, copiez le lien à la main : ${link}`; }
		};
		if (navigator.clipboard) navigator.clipboard.writeText(link).then(done, fallback); else fallback();
	}
	/** An implicit request (hours not stated by the consumer) is created with this many hours. */
	isUnlimited(r: AvailabilityRequest): boolean { return r.requestedHours >= 1000; }
	progress(r: AvailabilityRequest): string {
		const booked = `${r.scheduledHours ?? 0} h déjà planifiées`;
		return this.isUnlimited(r) ? `sans limite d’heures (${booked})` : `encore ${remainingOf(r)} h souhaitées (${booked})`;
	}
	remainingHours(r: AvailabilityRequest): number { return remainingOf(r); }
	/**
	 * Agent agenda: hours each consumer still wants (open requests), meetings already booked not counted.
	 * `unlimited` when one of his open requests has no limit.
	 */
	consumerHours(assignationId: number): { remaining: number; scheduled: number; unlimited: boolean } {
		const mine = this.requests.filter((r) => r.assignationId === assignationId);
		const open = mine.filter((r) => (r.status ?? "open") !== "closed");
		const round = (n: number) => Math.round(n * 10) / 10;
		return {
			remaining: round(open.filter((r) => !this.isUnlimited(r)).reduce((t, r) => t + remainingOf(r), 0)),
			scheduled: round(mine.reduce((t, r) => t + (r.scheduledHours ?? 0), 0)),
			unlimited: open.some((r) => this.isUnlimited(r))
		};
	}
	consumerHoursLabel(assignationId: number): string {
		const h = this.consumerHours(assignationId);
		if (h.unlimited) return "sans limite";
		return h.remaining > 0 ? `${h.remaining} h` : "aucune";
	}
	upcoming(): Meeting[] {
		return this.meetings.filter((m) => m.status === "pending").sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
	}
	/** Cancelled meetings of the visible range, oldest first (shown in a dedicated section). */
	cancelledMeetings(): Meeting[] {
		return this.meetings.filter((m) => m.status === "canceledBy").sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
	}
	who(assignationId: number): string {
		const a = this.assignations.find((x) => x.id === assignationId);
		const name = a ? [a.consumer?.name, a.consumer?.surname].filter(Boolean).join(" ") : "";
		return name || `Consommateur n° ${assignationId}`;
	}
	contractLabel(c: any): string { return c.companyName ?? c.company?.name ?? `Société n° ${c.companyId}`; }
	currentRequest(): AvailabilityRequest | undefined {
		const mine = this.requests.filter((r) => r.assignationId === this.selAssign);
		return mine.find((r) => remainingOf(r) > 0) ?? mine[0];
	}

	// ---- Admin helpers: who, rooms and prices -------------------------------
	/** Assignation (agent + consumer) of a meeting, from the admin's assignation list. */
	assignationOf(m: Meeting): any { return this.assignations.find((x) => x.id === m.assignationId); }
	meetingAgent(m: Meeting): string { const a = this.assignationOf(m); return a ? this.agentLabel(a) : "—"; }
	meetingConsumer(m: Meeting): string { const a = this.assignationOf(m); return a ? this.consumerLabel(a) : "—"; }
	money(n: number): string { return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n || 0); }
	packageLabel(p: Package): string { return `${p.name} (${this.money(p.hourlyRate)}/h)`; }
	packageById(id: number | null | undefined): Package | undefined { return id == null ? undefined : this.packages.find((p) => p.id === id); }

	/** Highest number of simultaneous intervals inside [from, to). */
	private peak(intervals: Array<{ s: number; e: number }>, from: number, to: number): number {
		const ev: Array<[number, number]> = [];
		for (const i of intervals) {
			const s = Math.max(from, i.s), e = Math.min(to, i.e);
			if (e > s) ev.push([s, 1], [e, -1]);
		}
		ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
		let cur = 0, max = 0;
		for (const [, d] of ev) { cur += d; max = Math.max(max, cur); }
		return max;
	}

	/** True when the room cannot host this meeting (the server stays the final judge). */
	roomFull(r: Room, m: Meeting): boolean {
		if (r.limit === -1 || m.roomName === r.name) return false;
		const s = Date.parse(m.startAt), e = s + m.durationMinutes * 60000;
		const others = this.meetings
			.filter((x) => x.id !== m.id && x.status !== "canceledBy" && x.roomName === r.name)
			.map((x) => ({ s: Date.parse(x.startAt), e: Date.parse(x.startAt) + x.durationMinutes * 60000 }));
		return this.peak(others, s, e) >= r.limit;
	}

	/** Admin dashboard: give (or remove) the room of an upcoming meeting. */
	async setMeetingRoom(m: Meeting, select: HTMLSelectElement) {
		const id = m.id, before = m.roomName ?? null, roomName = select.value || null;
		await this.optimistic(() => {
			this.meetings = this.meetings.map((x) => x.id === id ? { ...x, roomName } : x);
			return () => {
				this.meetings = this.meetings.map((x) => x.id === id ? { ...x, roomName: before } : x);
				select.value = before ?? ""; // show the real room again
			};
		}, async () => { await fetcher.patchMeeting(id, { roomName }); }, "Salle mise à jour.");
	}

	// ---- Agent script (userscript run on the server, in a sandbox) -------------------
	scriptEventLabel(t: string): string { return SCRIPT_EVENTS[t] ?? t; }
	runStatusLabel(s: string): string { return RUN_STATUS[s] ?? s; }
	scriptDirty(): boolean { return !!this.script && this.scriptCode !== (this.script.code || SCRIPT_TEMPLATE); }
	meetingOptionLabel(m: Meeting): string {
		const a = this.assignations.find((x) => x.id === m.assignationId);
		return `${this.fmt(m.startAt)} · ${a ? this.consumerLabel(a) : "Consommateur"} · ${this.statusLabel(m.status)}`;
	}

	/** Tab inserts a tab in the code editor instead of leaving it (Escape then Tab leaves it). */
	scriptTab(e: KeyboardEvent): void {
		if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
		const el = e.target as HTMLTextAreaElement;
		e.preventDefault();
		const { selectionStart: a, selectionEnd: b } = el;
		this.scriptCode = el.value.slice(0, a) + "\t" + el.value.slice(b);
		requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = a + 1; });
	}

	async saveScript() {
		await this.run(async () => { this.script = await fetcher.saveScript({ code: this.scriptCode }); }, "Script enregistré.");
	}

	async toggleScript(enabled: boolean) {
		await this.run(async () => {
			// Enabling saves the code that is shown, so that what runs is what the agent sees.
			this.script = await fetcher.saveScript(enabled ? { code: this.scriptCode, enabled } : { enabled });
		}, enabled ? "Script activé : il sera exécuté à chaque événement de rendez-vous." : "Script désactivé.");
	}

	resetScriptTemplate() {
		if (this.scriptCode.trim() && !confirm("Remplacer le code affiché par l’exemple ?")) return;
		this.scriptCode = SCRIPT_TEMPLATE;
	}

	async testScript() {
		await this.run(async () => {
			this.scriptTest.last = null;
			this.scriptTest.last = await fetcher.testScript({
				type: this.scriptTest.type, code: this.scriptCode,
				meetingId: this.scriptTest.meetingId ? Number(this.scriptTest.meetingId) : null
			});
			this.scriptRuns = await fetcher.scriptRuns();
		});
	}

	async refreshScriptRuns() {
		await this.load(async () => { this.scriptRuns = await fetcher.scriptRuns(); });
	}

	async saveSecret() {
		const name = this.secretForm.name.trim();
		await this.run(async () => {
			if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)) throw new Error("Nom invalide : lettres, chiffres et _ uniquement, sans commencer par un chiffre (64 caractères au maximum).");
			const replaced = this.script?.secretNames.includes(name);
			this.script = await fetcher.updateSecrets([{ name, value: this.secretForm.value }]);
			this.secretForm = { name: "", value: "" };
			this.notice = replaced ? `Secret « ${name} » remplacé.` : `Secret « ${name} » ajouté.`;
		});
	}

	async deleteSecret(name: string) {
		if (!confirm(`Supprimer le secret « ${name} » ?`)) return;
		await this.run(async () => { this.script = await fetcher.updateSecrets([{ name, value: null }]); }, "Secret supprimé.");
	}

	// ---- Public pages: authentication ------------------------------------
	async adminLogin() { await this.login("admin"); }
	async agentLogin() { await this.login("agent"); }

	private async login(role: "admin" | "agent"): Promise<void> {
		await this.run(async () => {
			const f = this.form;
			const r = role === "admin" ? await fetcher.adminLogin(f.username ?? "", f.password ?? "") : await fetcher.agentLogin(f.username ?? "", f.password ?? "");
			this.startSession(role, r);
			this.go(HOME[role]);
		});
	}

	async adminSignup() {
		await this.run(async () => {
			const f = this.form;
			const r = await fetcher.adminSignup({ username: f.username, password: f.password, displayName: f.displayName, companyName: f.companyName });
			this.startSession("admin", r);
			this.go(HOME.admin);
		});
	}

	async consumerAccess() {
		await this.run(async () => {
			const r = await fetcher.consumerAccess(String(this.form.key ?? "").trim(), this.form.password);
			this.startSession("consumer", r);
			this.go(HOME.consumer);
		});
	}

	// ---- Admin pages -----------------------------------------------------
	async searchConsumers() {
		await this.run(async () => { this.results = await fetcher.searchConsumers(String(this.form.q ?? "").trim()); });
	}

	async createConsumer() {
		await this.run(async () => {
			const f = this.form;
			this.created = await fetcher.createConsumer({ name: f.name, surname: f.surname, username: f.username, password: f.password || undefined });
			this.form = {};
			this.consumers = await fetcher.consumers();
		}, "Consommateur créé et inscrit à votre société.");
	}

	async enroll(c: any) {
		await this.run(async () => {
			this.created = { consumer: c, fidelity: await fetcher.enrollConsumer(c.id) };
			this.results = [];
			this.consumers = await fetcher.consumers();
		}, "Consommateur inscrit à votre société.");
	}

	async createAgent() {
		await this.run(async () => {
			const f = this.form;
			await fetcher.createAgent({ name: f.name, surname: f.surname, username: f.username, password: f.password });
			this.form = {};
			this.agents = await fetcher.agents();
		}, "Agent créé et rattaché à votre société.");
	}

	async searchAgents() {
		await this.run(async () => {
			this.agentResults = await fetcher.searchAgents(String(this.form.q ?? "").trim());
			this.searched = true;
		});
	}

	async attachAgent(a: any) {
		await this.run(async () => {
			await fetcher.attachAgent(a.id);
			this.agentResults = []; this.searched = false;
			this.agents = await fetcher.agents();
		}, "Agent rattaché à votre société.");
	}

	toggleAgent(a: any) { this.openAgent = this.openAgent === a.id ? null : a.id; }

	async removeAgent(a: any) {
		if (!confirm(`Retirer ${this.agentLabel(a)} de votre société ? Ses assignations seront supprimées.`)) return;
		await this.run(async () => {
			await fetcher.removeAgent(a.id);
			if (this.openAgent === a.id) this.openAgent = null;
			[this.agents, this.assignations] = await Promise.all([fetcher.agents(), fetcher.assignations()]);
		}, "Agent retiré de votre société.");
	}

	async removeAssignation(x: any) {
		if (!confirm(`Supprimer l’assignation de ${this.consumerLabel(x)} ?`)) return;
		await this.run(async () => {
			await fetcher.deleteAssignation(x.id);
			this.assignations = await fetcher.assignations();
		}, "Assignation supprimée.");
	}

	/** Opens the dialog used to attribute one more consumer to an agent. */
	openAssign(a: any) {
		this.assignDialog = { agent: a, q: "", fidelityId: "", error: "" };
		(document.getElementById("assign-dialog") as HTMLDialogElement | null)?.showModal();
	}

	closeAssign() {
		(document.getElementById("assign-dialog") as HTMLDialogElement | null)?.close();
		this.assignDialog.agent = null;
	}

	/** Consumers of the company that are not yet assigned to the chosen agent, filtered by the search text. */
	assignableConsumers(): any[] {
		const agent = this.assignDialog.agent;
		if (!agent) return [];
		const taken = new Set(this.assignationsOf(agent).map((x) => x.fidelityId));
		const q = this.assignDialog.q.trim().toLowerCase();
		return this.consumers.filter((c) => !taken.has(this.fidelityId(c))
			&& (!q || `${this.consumerLabel(c)} ${this.consumerOf(c).username}`.toLowerCase().includes(q)));
	}

	async confirmAssign() {
		const d = this.assignDialog;
		if (!d.agent || !d.fidelityId) return;
		await this.run(async () => {
			try {
				await fetcher.assign(d.agent.id, Number(d.fidelityId));
				this.assignations = await fetcher.assignations();
			} catch (e: any) {
				d.error = e?.message ?? "Assignation impossible."; // shown inside the dialog, the page is hidden behind it
				return;
			}
			this.closeAssign();
		}, "Consommateur attribué à l’agent.");
	}

	// ---- Packages and prices -----------------------------------------------
	async createPackage() {
		await this.run(async () => {
			const rate = Number(String(this.form.hourlyRate ?? "").replace(",", "."));
			if (!Number.isFinite(rate) || rate < 0) throw new Error("Le prix horaire doit être un nombre supérieur ou égal à 0.");
			await fetcher.createPackage(String(this.form.name ?? ""), rate);
			this.form = {};
			this.packages = await fetcher.packages();
		}, "Formule créée.");
	}

	async deletePackage(p: Package) {
		if (!confirm(`Supprimer la formule « ${p.name} » ?`)) return;
		await this.run(async () => { await fetcher.deletePackage(p.id); this.packages = await fetcher.packages(); }, "Formule supprimée.");
	}

	/** Default package id of a consumer row ({ consumer, fidelity }), or null when not defined. */
	defaultPackageId(c: any): number | null { return c.fidelity?.defaultPackageId ?? null; }

	async setConsumerPackage(c: any, value: string) {
		await this.run(async () => {
			await fetcher.setConsumerPackage(this.fidelityId(c), value ? Number(value) : null);
			this.consumers = await fetcher.consumers();
		}, "Formule par défaut enregistrée.");
	}

	/** Text of the "default" option of an assignation: it shows the package the default would give. */
	defaultOptionLabel(x: any): string {
		const c = this.consumers.find((k) => this.fidelityId(k) === x.fidelityId);
		const p = c ? this.packageById(this.defaultPackageId(c)) : undefined;
		return p ? `Par défaut (${this.packageLabel(p)})` : `Par défaut (aucune formule : ${this.money(0)})`;
	}

	async setAssignationPackage(x: any, value: string) {
		await this.run(async () => {
			await fetcher.setAssignationPackage(x.id, value ? Number(value) : null);
			this.assignations = await fetcher.assignations();
		}, "Prix horaire enregistré.");
	}

	private async loadRooms(): Promise<void> {
		this.rooms = (await fetcher.rooms()).map((r: Room) => ({ ...r, draftName: r.name, draftLimit: r.limit }));
	}

	async createRoom() {
		await this.run(async () => {
			const limit = Number(this.form.limit ?? -1);
			if (!Number.isInteger(limit) || (limit !== -1 && limit < 1)) throw new Error("La limite vaut -1 (illimitée) ou un entier positif.");
			await fetcher.createRoom(String(this.form.name ?? ""), limit);
			this.form = { autoFrom: this.form.autoFrom, autoTo: this.form.autoTo }; // keep the period of the automatic assignment
			await this.loadRooms();
		}, "Salle créée.");
	}

	/** Single "Enregistrer" button: names, limits and the order of every room are saved together, atomically. */
	async saveRooms() {
		await this.run(async () => {
			const items = this.rooms.map((r) => {
				const limit = Number(r.draftLimit);
				if (!Number.isInteger(limit) || (limit !== -1 && limit < 1)) throw new Error(`La limite de « ${r.name} » vaut -1 (illimitée) ou un entier positif.`);
				const newName = (r.draftName ?? "").trim();
				return { name: r.name, newName: newName && newName !== r.name ? newName : undefined, limit };
			});
			await fetcher.saveRooms(items);
			await this.loadRooms();
			await this.loadRoomCalendar();
		}, "Salles enregistrées.");
	}

	// Order of the rooms: drag the handle, or use the arrows (touch screens). Nothing is saved until "Enregistrer".
	moveRoom(from: number, to: number) {
		if (from === to || from < 0 || to < 0 || from >= this.rooms.length || to >= this.rooms.length) return;
		const list = [...this.rooms];
		const [item] = list.splice(from, 1);
		list.splice(to, 0, item);
		this.rooms = list;
	}
	roomDragStart(e: DragEvent, index: number) {
		this.dragRoom = index;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = "move";
			e.dataTransfer.setData("text/plain", String(index)); // Firefox needs some data to start a drag
			const row = (e.target as HTMLElement).closest("tr");
			if (row) e.dataTransfer.setDragImage(row, 0, 0);
		}
	}
	roomDragOver(e: DragEvent, index: number) {
		if (this.dragRoom === null) return;
		e.preventDefault();
		this.overRoom = index;
	}
	roomDrop(e: DragEvent, index: number) {
		e.preventDefault();
		if (this.dragRoom !== null) this.moveRoom(this.dragRoom, index);
		this.roomDragEnd();
	}
	roomDragEnd() { this.dragRoom = null; this.overRoom = null; }

	// ---- Room calendar (one day, one column per room) ------------------------
	async loadRoomCalendar(): Promise<void> {
		const { from, to } = this.roomCal.range;
		const a = await fetcher.agenda(from, to);
		this.roomMeetings = (a.meetings ?? []).filter((m: Meeting) => m.status !== "canceledBy");
		this.roomCal.events = this.roomMeetings.map((m) => ({
			id: `room-${m.id}`, kind: "meeting" as EventKind, title: `${this.meetingAgent(m)} · ${this.meetingConsumer(m)}`, status: m.status, raw: m,
			start: new Date(m.startAt), end: new Date(Date.parse(m.startAt) + m.durationMinutes * 60000)
		}));
	}

	/** Columns of the room calendar: the active rooms in their order, then the meetings that have no room. */
	roomColumns(): Array<{ key: string; label: string; name: string | null }> {
		return [
			...this.rooms.map((r) => ({ key: r.name, label: r.name, name: r.name as string | null })),
			{ key: "(none)", label: "Sans salle", name: null }
		];
	}
	roomColumnEvents(name: string | null) {
		const events = this.roomCal.events.filter((e) => (e.raw.roomName ?? null) === name);
		return this.roomCal.layout(events, this.roomCal.first);
	}
	/** Visible hours of the room calendar (kept in memory only, so the agent agenda settings are not touched). */
	applyRoomHours() {
		const s = this.roomCal.settings;
		s.startHour = Math.min(22, Math.max(0, Math.round(Number(s.startHour)) || 0));
		s.endHour = Math.min(24, Math.max(s.startHour + 1, Math.round(Number(s.endHour)) || 24));
	}

	/** Default period of the automatic room assignment: today, from 7:00 to 22:00. */
	private roomPeriodDefaults(): { autoFrom: string; autoTo: string } {
		const from = new Date(); from.setHours(7, 0, 0, 0);
		const to = new Date(); to.setHours(22, 0, 0, 0);
		return { autoFrom: toLocalInput(from), autoTo: toLocalInput(to) };
	}

	/** Automatic room assignment over the period typed in the form. */
	async autoAssignRooms() {
		await this.run(async () => {
			const from = new Date(String(this.form.autoFrom ?? ""));
			const to = new Date(String(this.form.autoTo ?? ""));
			if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new Error("Indiquez le début et la fin de la période.");
			if (to.getTime() <= from.getTime()) throw new Error("La fin de la période doit être après son début.");
			const r = await fetcher.autoAssignRooms(from.toISOString(), to.toISOString());
			this.roomCal.anchor = from; // show the day that was just processed
			await this.loadRoomCalendar();
			const n = r.assigned.length, k = r.unassigned.length;
			this.notice = n + (n > 1 ? " rendez-vous ont reçu une salle." : " rendez-vous a reçu une salle.")
				+ (k ? ` ${k} n’${k > 1 ? "ont" : "a"} pas pu en recevoir (aucune salle assez grande de libre).` : "");
		});
	}

	// ---- Results (admin-results and agent-results share Results.ts and one HTML block) ----------
	hoursLabel(h: number): string { return `${Math.round(h * 100) / 100} h`; }

	private async reloadResults(): Promise<void> {
		const a = await fetcher.agenda(ALL_FROM, ALL_TO);
		this.res.setData(this.res.mode, a.meetings ?? [], this.res.assignations);
	}

	/** Changes one meeting of the results on screen; returns how to undo it. */
	private patchResult(id: number, change: Partial<Meeting>): () => void {
		const before = this.res.meetings.find((m) => m.id === id);
		this.res.setData(this.res.mode, this.res.meetings.map((m) => m.id === id ? { ...m, ...change } : m), this.res.assignations);
		return () => { if (before) this.res.setData(this.res.mode, this.res.meetings.map((m) => m.id === id ? before : m), this.res.assignations); };
	}

	/** The only changes allowed from the results: validate (with the duration really spent), cancel or comment a pending meeting. */
	resultDone(id: number) {
		const m = this.res.meetings.find((x) => x.id === id);
		this.doneEdit = { id, minutes: m?.durationMinutes ?? 60 };
	}
	async resultConfirmDone() {
		const edit = this.doneEdit;
		if (!edit) return;
		const minutes = Number(edit.minutes);
		if (!this.check(() => { if (!Number.isInteger(minutes) || minutes <= 0) throw new Error("La durée réelle est un nombre entier de minutes, supérieur à 0."); })) return;
		this.doneEdit = null;
		const planned = this.res.meetings.find((x) => x.id === edit.id)?.durationMinutes;
		const actual = minutes === planned ? null : minutes;
		await this.optimistic(() => this.patchResult(edit.id, { status: "done", actualDurationMinutes: actual }),
			async () => { await fetcher.patchMeeting(edit.id, { status: "done", actualDurationMinutes: actual }); }, "Rendez-vous marqué comme terminé.");
	}
	async resultCancel(id: number) {
		if (!confirm("Annuler ce rendez-vous ?")) return;
		await this.optimistic(() => this.patchResult(id, { status: "canceledBy" }), async () => { await fetcher.cancelMeeting(id); }, "Rendez-vous annulé.");
	}
	async resultComment(id: number, text: string) {
		await this.optimistic(() => this.patchResult(id, { comment: text }), async () => { await fetcher.patchMeeting(id, { comment: text }); }, "Commentaire enregistré.");
	}

	// ---- Society rate (page Société) ---------------------------------------------------------------
	/** Example shown under the field: what a 32 EUR price becomes for the agent and for the company. */
	societyExample(): string {
		const rate = Number(String(this.form.societyRate ?? "").replace(",", "."));
		if (!Number.isFinite(rate) || rate < 0) return "";
		const price = 32;
		const agent = Math.round(price / (1 + rate / 100) * 100) / 100;
		const society = Math.round((price - agent) * 100) / 100;
		return `Exemple : si une formule coûte ${this.money(price)}, l’agent reçoit ${this.money(agent)} et la société ${this.money(society)}.`;
	}

	async saveSocietyRate() {
		await this.run(async () => {
			const rate = Number(String(this.form.societyRate ?? "").replace(",", "."));
			if (!Number.isFinite(rate) || rate < 0 || rate > 1000) throw new Error("Le taux doit être un nombre entre 0 et 1000 (en pourcentage).");
			const c = await fetcher.updateSocietyRate(rate);
			if (this.company) this.company = { ...this.company, ...c };
			this.companies = await fetcher.companies();
			this.form.societyRate = this.companies[0]?.societyRate ?? rate;
		}, "Taux de la société enregistré.");
	}

	async deactivateRoom(r: Room) {
		if (!confirm(`Désactiver la salle « ${r.name} » ?`)) return;
		await this.run(async () => { await fetcher.deactivateRoom(r.name); await this.loadRooms(); }, "Salle désactivée.");
	}

	// ---- Agenda (agent and consumer) -------------------------------------
	async openAgenda(): Promise<void> {
		this.cal.onSelect = (s, e, origin) => this.beginInterval(s, e, origin);
		this.cal.selection = null;
		this.cal.attach(() => void this.refreshAgenda());
		await this.refreshAgenda();
	}

	/**
	 * Loads the visible period. Until the answer arrives, the period is drawn from the generators already known
	 * (weekly repetitions), so changing week shows the usual hours at once. `silent` reloads without the spinner.
	 */
	async refreshAgenda(silent = false): Promise<void> {
		const { from, to } = this.cal.range;
		const key = `${this.selAssign}|${from}|${to}`;
		const seq = ++this.agendaSeq;
		if (key !== this.loadedRange) { this.rangeLoaded = false; this.cal.events = this.buildEvents(); }
		const work = async () => {
			const a = await fetcher.agenda(from, to);
			if (seq !== this.agendaSeq) return; // another period was asked meanwhile
			const meetings = a.meetings ?? [];
			let dispos: any[] = [];
			if (this.role === "agent") {
				let rooms: Room[];
				[dispos, rooms] = await Promise.all([fetcher.disponibilities({ from, to }), fetcher.rooms()]);
				if (seq !== this.agendaSeq) return;
				this.contracts = a.contracts ?? []; this.assignations = a.assignations ?? []; this.suggestions = a.suggestions ?? [];
				this.requests = (a.requests ?? []).map(normRequest); // used by the "Demandeurs" filter
				this.intercoursePairs = a.intercoursePairs ?? [];
				this.generators = a.generators ?? []; this.otherGenerators = a.consumerGenerators ?? [];
				this.rooms = rooms;
			} else {
				this.agentsList = a.agents ?? []; this.requests = (a.requests ?? []).map(normRequest); this.slots = a.agentSlots ?? []; // the agent's hours, independent of my availabilities
				this.generators = a.generators ?? []; this.otherGenerators = a.agentGenerators ?? [];
				if (this.selAssign === null && this.agentsList.length) this.selAssign = this.assignId(this.agentsList[0]);
				dispos = this.selAssign ? await fetcher.disponibilities({ assignationId: this.selAssign, from, to }) : [];
				if (seq !== this.agendaSeq) return;
			}
			this.meetings = meetings;
			this.dispos = dispos;
			this.loadedRange = `${this.selAssign}|${from}|${to}`;
			this.rangeLoaded = true;
			this.cal.events = this.buildEvents();
		};
		if (!silent) return this.load(work);
		try { await work(); } catch { /* a quiet reload never shows an error */ }
	}

	/** Agent of one of my assignations (consumer side). */
	agentOf(assignationId: number): string {
		const a = this.agentsList.find((x) => this.assignId(x) === assignationId);
		return a ? this.agentLabel(a) : "Agent";
	}

	/**
	 * Calendar events. The title is the other person (the consumer for the agent, the agent for the consumer).
	 * Meetings no longer consume availabilities and suggestions on the server: they are only cut out of them here,
	 * so an interval is drawn as the pieces left around the meetings.
	 */
	private buildEvents(): CalEvent[] {
		const span = (x: any) => ({ s: Date.parse(x.startAt), e: Date.parse(x.startAt) + x.durationMinutes * 60000 });
		this.buildVirtual();
		const { from, to } = this.cal.range;
		const inRange = (x: any) => { const { s, e } = span(x); return e > Date.parse(from) && s < Date.parse(to); };
		// Cancelled meetings are not drawn in the calendar: they are listed in their own section.
		// While the period loads, only what the generators give is drawn (the rows in memory belong to the previous period).
		const meetings = this.meetings.filter((m) => m.status !== "canceledBy" && (this.rangeLoaded || inRange(m)));
		this.cal.gaps = this.role === "agent" ? this.buildGaps(meetings) : [];
		const busy = meetings.map(span).sort((a, b) => a.s - b.s);
		const mk = (kind: EventKind, x: any, title: string, editable = false, status?: string, s = span(x).s, e = span(x).e): CalEvent => ({
			id: `${kind}-${x.id}-${s}`, kind, title, status, editable: editable && !x._pending && !x.virtual, love: x.love, raw: x,
			start: new Date(s), end: new Date(e), virtual: !!x.virtual, pending: !!x._pending
		});
		const cut = (kind: EventKind, x: any, title: string, editable = false): CalEvent[] => {
			const out: CalEvent[] = [];
			let { s, e } = span(x);
			for (const b of busy) {
				if (b.e <= s || b.s >= e) continue;
				if (b.s > s) out.push(mk(kind, x, title, editable, undefined, s, b.s));
				s = Math.max(s, b.e);
			}
			if (e > s) out.push(mk(kind, x, title, editable, undefined, s, e));
			return out;
		};
		const out: CalEvent[] = [];
		const agent = this.role === "agent";
		// Until the period is loaded, only the rows just created on screen (not saved yet) are drawn with the generators.
		const rows = (list: any[]) => this.rangeLoaded ? list : list.filter((x) => x._pending);
		for (const m of meetings) out.push(mk("meeting", m, agent ? this.who(m.assignationId) : this.agentOf(m.assignationId), false, m.status));
		if (agent) {
			for (const p of this.proposals) {
				out.push({ id: p.id, kind: "proposal", title: this.who(p.assignationId), raw: p, start: p.start, end: p.end });
			}
			for (const s of [...rows(this.suggestions), ...this.virtualSuggestions]) out.push(...cut("suggestion", s, "Mes horaires", true));
			for (const d of [...rows(this.dispos), ...this.virtualDispos]) if (this.isVisible(d.assignationId)) out.push(...cut("dispo", d, this.who(d.assignationId)));
		} else {
			for (const s of [...rows(this.slots), ...this.virtualSuggestions]) {
				const target = s.assignationId;
				if (this.selAssign !== null && target !== undefined && target !== this.selAssign) continue;
				out.push(...cut("slot", s, this.agentOf(target ?? this.selAssign)));
			}
			for (const d of [...rows(this.dispos), ...this.virtualDispos]) out.push(...cut("dispo", d, "Ma disponibilité", true));
		}
		return out;
	}

	// ---- Weekly repetitions ("générateurs") ------------------------------------------------------
	/**
	 * Occurrences of the generators in the visible period that are not real rows: the ones after the period the
	 * server already generated (two weeks), or every one while the period is loading. Cancelled ones are skipped.
	 */
	private buildVirtual(): void {
		const { from, to } = this.cal.range;
		const now = Date.now();
		const lo = Math.max(Date.parse(from), now);
		const hi = Date.parse(to);
		const rowsOf = (g: Generator) => (g.kind === "suggestion" ? (this.role === "agent" ? this.suggestions : this.slots) : this.dispos);
		const make = (g: Generator, assignationId: number | null) => {
			if (hi <= lo) return [];
			const cancelled = new Set(g.cancellations);
			const generated = Date.parse(g.generatedUntil);
			const real = new Set(rowsOf(g).filter((r: any) => r.generatorId === g.id).map((r: any) => r.generatorOccurrence));
			return occurrences(g, lo, hi)
				.filter((o) => !cancelled.has(o.date) && !real.has(o.date) && (!this.rangeLoaded || o.start >= generated))
				.map((o) => ({
					id: `g${g.id}-${o.date}`, virtual: true, _pending: (g as any)._pending, generatorId: g.id, generatorOccurrence: o.date,
					startAt: new Date(o.start).toISOString(), durationMinutes: g.durationMinutes, love: g.love,
					contractId: g.contractId, assignationId, requestId: g.requestId ?? null
				}));
		};
		if (this.role === "agent") {
			this.virtualSuggestions = this.generators.flatMap((g) => make(g, null));
			this.virtualDispos = this.otherGenerators.flatMap((g) => make(g, g.assignationId));
		} else {
			this.virtualDispos = this.generators.filter((g) => g.assignationId === this.selAssign).flatMap((g) => make(g, g.assignationId));
			this.virtualSuggestions = this.otherGenerators.filter((g) => g.assignationId === this.selAssign).flatMap((g) => make(g, g.assignationId));
		}
	}

	generatorOf(id: number | null | undefined): Generator | undefined {
		return id == null ? undefined : [...this.generators, ...this.otherGenerators].find((g) => g.id === id);
	}
	describeGenerator(g: Generator | undefined): string { return g ? describe(g) : ""; }
	weekdayLabel(n: number): string { return WEEKDAYS_FR[n] ?? ""; }
	weekdays(): Array<{ value: number; label: string }> { return [1, 2, 3, 4, 5, 6, 0].map((value) => ({ value, label: WEEKDAYS_FR[value] })); }
	/** My generators shown in the section: the consumer only sees those of the agent selected. */
	myGenerators(): Generator[] {
		return this.role === "consumer" ? this.generators.filter((g) => g.assignationId === this.selAssign) : this.generators;
	}
	/** Period of a generator, for the list ("depuis le …, jusqu'au …"). */
	generatorPeriod(g: Generator): string {
		const f = (d: string) => new Date(`${d}T12:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
		const tz = g.timeZone !== browserTimeZone() ? ` (heure de ${g.timeZone})` : "";
		return `à partir du ${f(g.startsOn)}${g.endsOn ? `, jusqu’au ${f(g.endsOn)}` : ""}${tz}`;
	}
	/** Cancelled occurrences still to come (the past ones do not matter any more). */
	futureCancellations(g: Generator): string[] {
		const today = localDate(Date.now(), g.timeZone);
		return g.cancellations.filter((d) => d >= today);
	}
	occurrenceLabel(date: string): string {
		return new Date(`${date}T12:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
	}

	/** From the agenda: opens the habit in the "Habitudes" page. */
	editGenerator(g: Generator) {
		this.closePanel();
		if (this.page.endsWith("-habits")) return this.openHabit(g);
		this.habitToEdit = g.id;
		this.go(this.role === "agent" ? "agent-habits" : "consumer-habits");
	}

	// ---- "Habitudes": the week template, one block per habit (generator) ----------------------------
	async openHabits(): Promise<void> {
		this.habitCal.onSelect = (s, e) => this.newHabit(s, e);
		this.habitCal.selection = null;
		this.habitCal.attach(() => { this.habitCal.events = this.buildHabitEvents(); });
		await this.load(() => this.loadHabits());
		const id = this.habitToEdit;
		this.habitToEdit = null;
		const g = this.generators.find((x) => x.id === id);
		if (g) this.openHabit(g);
	}

	/** The habits come with the agenda; a one-minute period is enough (no row is needed here). */
	private async loadHabits(): Promise<void> {
		const now = new Date();
		const a = await fetcher.agenda(now.toISOString(), new Date(now.getTime() + 60000).toISOString());
		this.requests = (a.requests ?? []).map(normRequest);
		this.generators = a.generators ?? [];
		if (this.role === "agent") {
			this.contracts = a.contracts ?? []; this.assignations = a.assignations ?? [];
			this.otherGenerators = a.consumerGenerators ?? [];
		} else {
			this.agentsList = a.agents ?? [];
			this.otherGenerators = a.agentGenerators ?? [];
			if (this.selAssign === null && this.agentsList.length) this.selAssign = this.assignId(this.agentsList[0]);
		}
		this.habitCal.events = this.buildHabitEvents();
	}

	/**
	 * One block per habit, on the column of its weekday. Mine can be edited; the other side's are shown for reference
	 * (the agent sees his consumers' habits, filtered like in the agenda; the consumer sees his agent's hours).
	 */
	private buildHabitEvents(): CalEvent[] {
		const days = this.habitCal.days;
		const out: CalEvent[] = [];
		const add = (g: Generator, kind: EventKind, title: string, editable: boolean) => {
			for (const day of days.filter((d) => d.getDay() === g.weekday)) {
				const start = new Date(day); start.setHours(0, g.startMinute, 0, 0);
				const every = g.intervalWeeks > 1 ? ` · toutes les ${g.intervalWeeks} sem.` : "";
				out.push({
					id: `habit-${g.id}-${day.getDay()}`, kind, title: title + every, love: g.love, editable, raw: g,
					start, end: new Date(start.getTime() + g.durationMinutes * 60000), pending: !!(g as any)._pending
				});
			}
		};
		if (this.role === "agent") {
			for (const g of this.generators) add(g, "suggestion", "Mes horaires", true);
			for (const g of this.otherGenerators) if (g.assignationId !== null && this.isVisible(g.assignationId)) add(g, "dispo", this.who(g.assignationId), false);
		} else {
			for (const g of this.myGenerators()) add(g, "dispo", "Ma disponibilité", true);
			for (const g of this.otherGenerators) if (g.assignationId === this.selAssign) add(g, "slot", this.agentOf(g.assignationId as number), false);
		}
		return out;
	}

	/** A slot drawn on the week template: new habit on that weekday, at that time. */
	newHabit(start: Date, end: Date) {
		if (this.role === "consumer" && this.selAssign === null) { this.habitCal.selection = null; this.error = "Aucun agent ne vous est assigné."; return; }
		if (this.role === "agent" && !this.contracts.length) { this.habitCal.selection = null; this.error = "Aucun contrat actif : demandez à votre administrateur."; return; }
		this.error = "";
		this.panel = {
			type: "habit", error: "", gen: null,
			form: { ...newGenForm(), weekday: start.getDay(), start: hhmm(start.getHours() * 60 + start.getMinutes()),
				duration: Math.max(15, Math.round((end.getTime() - start.getTime()) / 60000)), contractId: this.contracts[0]?.id ?? null }
		};
	}

	/** Keyboard / touch fallback: a new habit today at 9:00. */
	openNewHabit() {
		const s = new Date(); s.setHours(9, 0, 0, 0);
		this.newHabit(s, new Date(s.getTime() + 2 * 3600000));
	}

	openHabitEvent(ev: CalEvent) {
		if (ev.pending) { this.error = "Enregistrement en cours… réessayez dans un instant."; return; }
		if (!ev.editable) { // the other side's habit: only informative
			this.panel = { type: "habit-info", ev, error: "" };
			return;
		}
		this.openHabit(ev.raw);
	}

	openHabit(g: Generator) {
		this.error = "";
		this.panel = {
			type: "habit", error: "", gen: g,
			form: { id: g.id, weekday: g.weekday, start: hhmm(g.startMinute), duration: g.durationMinutes, love: g.love ?? 0.5,
				intervalWeeks: g.intervalWeeks, startsOn: g.startsOn, endsOn: g.endsOn ?? "", contractId: g.contractId }
		};
	}

	async submitHabit() {
		const form = this.panel.form;
		let ok = false;
		this.check(() => { this.generatorBody(form); ok = true; });
		if (!ok) return;
		this.closePanel();
		await this.saveGenerator(form);
	}

	private generatorBody(f: ReturnType<typeof newGenForm>): GeneratorBody {
		const [h, m] = String(f.start).split(":").map(Number);
		const duration = Number(f.duration), love = Number(f.love), interval = Number(f.intervalWeeks);
		if (!Number.isInteger(h) || !Number.isInteger(m)) throw new Error("L’heure de début est invalide.");
		if (!Number.isInteger(duration) || duration <= 0 || duration > 1440) throw new Error("La durée est un nombre entier de minutes, 24 h au plus.");
		if (!(love >= 0 && love <= 1)) throw new Error("La préférence doit être comprise entre 0 et 1.");
		if (!Number.isInteger(interval) || interval < 1 || interval > 52) throw new Error("La fréquence est comprise entre 1 et 52 semaines.");
		if (!f.startsOn) throw new Error("Indiquez la date de début.");
		if (f.endsOn && f.endsOn < f.startsOn) throw new Error("La date de fin doit être après la date de début.");
		const body: GeneratorBody = {
			weekday: Number(f.weekday), startMinute: h * 60 + m, durationMinutes: duration, love, intervalWeeks: interval,
			timeZone: browserTimeZone(), startsOn: f.startsOn, endsOn: f.endsOn || null
		};
		if (this.role === "agent") {
			const contractId = Number(f.contractId ?? this.contracts[0]?.id);
			if (!contractId) throw new Error("Aucun contrat actif : demandez à votre administrateur.");
			body.contractId = contractId;
		} else {
			if (this.selAssign === null) throw new Error("Aucun agent ne vous est assigné.");
			body.assignationId = this.selAssign;
			const request = this.currentRequest();
			if (request) body.requestId = request.id;
		}
		return body;
	}

	/** Rows generated by a generator that are still to come (removed by the server when the rule changes). */
	private dropFutureRows(id: number): () => void {
		const now = Date.now();
		const keep = (r: any) => r.generatorId !== id || Date.parse(r.startAt) <= now;
		const before = { dispos: this.dispos, suggestions: this.suggestions };
		this.dispos = this.dispos.filter(keep); this.suggestions = this.suggestions.filter(keep);
		return () => { this.dispos = before.dispos; this.suggestions = before.suggestions; };
	}

	/** Creates or changes a habit (generator), from the "Habitudes" page or the "repeat" box of the agenda. */
	async saveGenerator(form: ReturnType<typeof newGenForm>) {
		let body!: GeneratorBody;
		if (!this.check(() => { body = this.generatorBody(form); })) return;
		const id = form.id;
		const local = (base: Partial<Generator> = {}): Generator => ({
			...base, id: id ?? tempId(), kind: this.role === "agent" ? "suggestion" : "disponibility",
			contractId: body.contractId ?? null, assignationId: body.assignationId ?? null, requestId: body.requestId ?? null,
			weekday: body.weekday, startMinute: body.startMinute, durationMinutes: body.durationMinutes, love: body.love,
			intervalWeeks: body.intervalWeeks, timeZone: body.timeZone, startsOn: body.startsOn, endsOn: body.endsOn,
			// Everything is drawn from the rule until the server has generated the rows again.
			generatedUntil: new Date().toISOString(), cancellations: base.cancellations ?? [], _pending: true
		} as Generator);
		if (id === null) {
			const tmp = local();
			await this.optimistic(() => {
				this.generators = [...this.generators, tmp];
				return () => { this.generators = this.generators.filter((g) => g.id !== tmp.id); };
			}, async () => {
				const saved = await fetcher.createGenerator(body);
				this.generators = this.generators.map((g) => g.id === tmp.id ? { ...saved, generatedUntil: tmp.generatedUntil } : g);
			}, "Habitude enregistrée : le créneau apparaît chaque semaine dans l’agenda.");
			return;
		}
		const before = this.generators.find((g) => g.id === id);
		await this.optimistic(() => {
			this.generators = this.generators.map((g) => g.id === id ? local(g) : g);
			const restoreRows = this.dropFutureRows(id);
			return () => { restoreRows(); if (before) this.generators = this.generators.map((g) => g.id === id ? before : g); };
		}, async () => {
			const saved = await fetcher.updateGenerator(id, body);
			this.generators = this.generators.map((g) => g.id === id ? { ...saved, generatedUntil: new Date().toISOString() } : g);
		}, "Habitude modifiée.");
	}

	async deleteGenerator(g: Generator) {
		if (!confirm(`Supprimer l’habitude « ${describe(g)} » ? Les créneaux à venir qu’elle a créés seront supprimés.`)) return;
		const id = g.id;
		this.closePanel();
		const before = this.generators;
		await this.optimistic(() => {
			this.generators = this.generators.filter((x) => x.id !== id);
			const restoreRows = this.dropFutureRows(id);
			return () => { restoreRows(); this.generators = before; };
		}, async () => { await fetcher.deleteGenerator(id); }, "Habitude supprimée.");
	}

	/** Changes the cancellations of a generator on screen; returns how to undo it. */
	private setCancellations(id: number, change: (dates: string[]) => string[]): () => void {
		const before = this.generators.find((g) => g.id === id);
		this.generators = this.generators.map((g) => g.id === id ? { ...g, cancellations: change(g.cancellations) } : g);
		return () => { if (before) this.generators = this.generators.map((g) => g.id === id ? before : g); };
	}

	/** "Cancelator": this occurrence of the repetition will not happen (removed if it was already created). */
	async cancelOccurrence(generatorId: number, date: string) {
		this.closePanel();
		await this.optimistic(() => {
			const undo = this.setCancellations(generatorId, (d) => [...new Set([...d, date])]);
			const keep = (r: any) => !(r.generatorId === generatorId && r.generatorOccurrence === date);
			const before = { dispos: this.dispos, suggestions: this.suggestions };
			this.dispos = this.dispos.filter(keep); this.suggestions = this.suggestions.filter(keep);
			return () => { undo(); this.dispos = before.dispos; this.suggestions = before.suggestions; };
		}, async () => { await fetcher.cancelOccurrence(generatorId, date); }, "Occurrence annulée.");
	}

	async restoreOccurrence(generatorId: number, date: string) {
		await this.optimistic(() => this.setCancellations(generatorId, (d) => d.filter((x) => x !== date)),
			async () => { await fetcher.restoreOccurrence(generatorId, date); }, "Occurrence rétablie.");
	}


	// ---- Intercourse ("intercours": time the agent needs between two meetings) ----------------
	/** Default intercourse of a consumer (minutes). */
	intercourseOf(assignationId: number): number { return this.assignations.find((x) => x.id === assignationId)?.intercourseMinutes ?? 0; }
	/** Value chosen for a pair of consumers (order does not matter), or null. */
	pairIntercourse(a: number, b: number): number | null {
		const p = this.intercoursePairs.find((x) => (x.assignationA === a && x.assignationB === b) || (x.assignationA === b && x.assignationB === a));
		return p ? p.minutes : null;
	}
	/** Minutes required between meetings of two consumers: the pair value, else the larger default. */
	gap(a: number, b: number): number {
		return (a !== b ? this.pairIntercourse(a, b) : null) ?? Math.max(this.intercourseOf(a), this.intercourseOf(b));
	}
	toggleIntercourse(x: any) { this.openIntercourse = this.openIntercourse === x.id ? null : x.id; }

	private intercourseInput(value: string): number {
		const n = Number(String(value).trim());
		if (!Number.isInteger(n) || n < 0 || n > 1440) throw new Error("L’intercours est un nombre entier de minutes entre 0 et 1440.");
		return n;
	}

	async saveIntercourse(x: any, value: string) {
		await this.run(async () => {
			await fetcher.setIntercourse(x.id, this.intercourseInput(value || "0"));
			this.assignations = await fetcher.myConsumers();
		}, `Intercours de ${this.consumerLabel(x)} enregistré.`);
	}

	/** Empty value: the pair goes back to the default (the larger intercourse of both consumers). */
	async savePairIntercourse(x: any, y: any, value: string) {
		await this.run(async () => {
			this.intercoursePairs = await fetcher.setIntercoursePair(x.id, y.id, String(value).trim() === "" ? null : this.intercourseInput(value));
		}, `Intercours entre ${this.consumerLabel(x)} et ${this.consumerLabel(y)} enregistré.`);
	}

	/** Greyed bands after each meeting (or proposal) followed by another one the same day: the intercourse to keep. */
	private buildGaps(meetings: Meeting[]): CalEvent[] {
		const items = [
			...meetings.map((m) => ({ a: m.assignationId, s: Date.parse(m.startAt), e: Date.parse(m.startAt) + m.durationMinutes * 60000 })),
			...this.proposals.map((p) => ({ a: p.assignationId, s: p.start.getTime(), e: p.end.getTime() }))
		].sort((x, y) => x.s - y.s);
		const out: CalEvent[] = [];
		for (let i = 0; i + 1 < items.length; i++) {
			const cur = items[i], next = items[i + 1];
			if (new Date(cur.e).toDateString() !== new Date(next.s).toDateString()) continue;
			const g = this.gap(cur.a, next.a);
			if (g <= 0) continue;
			out.push({
				id: `gap-${cur.s}-${next.s}`, kind: "meeting", title: `Intercours ${g} min`, raw: null,
				status: next.s < cur.e + g * 60000 ? "short" : undefined, // the next meeting starts too early
				start: new Date(cur.e), end: new Date(cur.e + g * 60000)
			});
		}
		return out;
	}

	// ---- Agent: automatic proposals (client side only, nothing is saved until validated) ----------
	/**
	 * Proposes one meeting per consumer (shown in the filter), lasting min(maximum length, hours he still asks for),
	 * placed so that it suits the most consumers over the visible period.
	 */
	proposeMeetings() {
		const maxMinutes = Number(this.planForm.maxMinutes);
		if (!Number.isInteger(maxMinutes) || maxMinutes < 15 || maxMinutes % 15) { this.error = "La durée maximale est un multiple de 15 minutes."; return; }
		const { from, to } = this.cal.range;
		const remaining = new Map<number, number>();
		for (const r of this.requests) {
			if ((r.status ?? "open") !== "open") remaining.set(r.id, 0);
			else remaining.set(r.id, r.remainingMinutes ?? Math.round((r.requestedHours - (r.scheduledHours ?? 0)) * 60));
		}
		this.proposals = plan({
			from: Date.parse(from), to: Date.parse(to), now: Date.now(), maxMinutes,
			// Occurrences of the repetitions count too: booking one generates it on the server.
			dispos: [...this.dispos, ...this.virtualDispos].filter((d) => this.isVisible(d.assignationId)),
			suggestions: [...this.suggestions, ...this.virtualSuggestions], contracts: this.contracts, assignations: this.assignations, remaining,
			meetings: this.meetings.filter((m) => m.status !== "canceledBy"),
			gap: (a, b) => this.gap(a, b)
		});
		this.closePanel();
		this.cal.events = this.buildEvents();
		const n = this.proposals.length;
		const people = new Set(this.proposals.map((p) => p.assignationId)).size;
		if (n) { this.error = ""; this.notice = `${n} proposition${n > 1 ? "s" : ""} pour ${people} consommateur${people > 1 ? "s" : ""}. Rien n’est enregistré tant que vous ne validez pas.`; }
		else { this.notice = ""; this.error = "Aucune proposition possible sur cette période (disponibilités, horaires, heures demandées ou intercours)."; }
	}

	private async bookProposal(p: Proposal): Promise<void> {
		await fetcher.createMeeting({
			assignationId: p.assignationId, startAt: p.start.toISOString(), durationMinutes: Math.round((p.end.getTime() - p.start.getTime()) / 60000),
			roomName: null, comment: "", idempotencyKey: `${p.id}-${uid()}`
		});
		this.proposals = this.proposals.filter((x) => x.id !== p.id);
	}

	/** The proposal becomes a meeting on screen at once; it comes back if the server refuses it. */
	async validateProposal() {
		const p: Proposal = this.panel.ev.raw;
		this.closePanel();
		const tmp = this.tempMeeting(p.assignationId, p.start, Math.round((p.end.getTime() - p.start.getTime()) / 60000));
		await this.optimistic(() => {
			this.proposals = this.proposals.filter((x) => x.id !== p.id);
			this.meetings = [...this.meetings, tmp];
			return () => { this.meetings = this.meetings.filter((m) => m.id !== tmp.id); this.proposals = [...this.proposals, p]; };
		}, async () => {
			const r = await fetcher.createMeeting({
				assignationId: p.assignationId, startAt: p.start.toISOString(), durationMinutes: tmp.durationMinutes,
				roomName: null, comment: "", idempotencyKey: `${p.id}-${uid()}`
			});
			this.meetings = this.meetings.map((m) => m.id === tmp.id ? r.meeting : m);
		}, "Rendez-vous créé.");
	}

	/** Meeting drawn before the server created it. */
	private tempMeeting(assignationId: number, start: Date, durationMinutes: number, roomName: string | null = null, comment = ""): Meeting {
		return { id: tempId(), assignationId, startAt: start.toISOString(), durationMinutes, status: "pending", roomName, comment, _pending: true } as Meeting;
	}

	eraseProposal() {
		const p: Proposal = this.panel.ev.raw;
		this.proposals = this.proposals.filter((x) => x.id !== p.id);
		this.closePanel();
		this.cal.events = this.buildEvents();
	}

	clearProposals() {
		this.proposals = [];
		if (this.panel?.type === "proposal") this.closePanel();
		this.cal.events = this.buildEvents();
	}

	/** Books every proposal; the ones the server refuses stay displayed. */
	async validateAllProposals() {
		if (!confirm(`Créer les ${this.proposals.length} rendez-vous proposés ?`)) return;
		const failed: string[] = [];
		await this.run(async () => {
			for (const p of [...this.proposals]) {
				try { await this.bookProposal(p); } catch (e: any) { failed.push(`${this.who(p.assignationId)} (${this.fmt(p.start.toISOString())}) : ${e?.message ?? "refusé"}`); }
			}
			if (this.panel?.type === "proposal") this.closePanel();
			await this.refreshAgenda();
			if (failed.length) throw new Error(`Non créés : ${failed.join(" · ")}`);
		}, "Tous les rendez-vous proposés ont été créés.");
	}

	/** Move an editable availability/suggestion by dropping it at a new date/time. */
	async dropEvent(e: DragEvent, day: Date) {
		e.preventDefault();
		const payload = e.dataTransfer?.getData("text/calendar-event");
		if (!payload) return;
		let data: { kind: EventKind; id: number; duration: number; love?: number };
		try { data = JSON.parse(payload); } catch { return; }
		if (data.kind !== "dispo" && data.kind !== "suggestion") return;
		const col = e.currentTarget as HTMLElement;
		const rect = col.getBoundingClientRect();
		const minutes = this.cal.settings.startHour * 60 + Math.floor(((e.clientY - rect.top) / rect.height) * this.cal.hours.length * 60 / 15) * 15;
		const start = new Date(day); start.setHours(0, minutes, 0, 0);
		if (start.getTime() <= Date.now()) { this.error = "Impossible de déplacer un créneau dans le passé."; return; }
		const body = { startAt: start.toISOString(), durationMinutes: data.duration, love: data.love ?? 0.5 };
		await this.saveRow(data.kind === "dispo" ? "dispos" : "suggestions", data.id, body, "Créneau déplacé.");
	}

	/**
	 * Moves / changes one of my intervals on screen at once, then on the server. A generated occurrence changed by
	 * hand leaves its repetition (the server cancels it there), the screen does the same.
	 */
	private async saveRow(list: "dispos" | "suggestions", id: number, body: { startAt: string; durationMinutes: number; love: number }, ok: string) {
		const before = this[list].find((x: any) => x.id === id);
		if (!before) return;
		await this.optimistic(() => {
			const undoCancel = before.generatorId ? this.setCancellations(before.generatorId, (d) => [...new Set([...d, before.generatorOccurrence])]) : null;
			this[list] = this[list].map((x: any) => x.id === id ? { ...x, ...body, generatorId: null, generatorOccurrence: null, _pending: true } : x);
			return () => { undoCancel?.(); this[list] = this[list].map((x: any) => x.id === id ? before : x); };
		}, async () => {
			const saved = list === "dispos" ? await fetcher.updateDispo(id, body) : await fetcher.updateSuggestion(id, body);
			this[list] = this[list].map((x: any) => x.id === id ? saved : x);
		}, ok);
	}

	dragCalendarEvent(e: DragEvent, ev: CalEvent) {
		if (!ev.editable || (ev.kind !== "dispo" && ev.kind !== "suggestion")) { e.preventDefault(); return; }
		e.dataTransfer?.setData("text/calendar-event", JSON.stringify({
			kind: ev.kind, id: ev.raw.id, duration: Math.round((ev.end.getTime() - ev.start.getTime()) / 60000), love: ev.raw.love
		}));
		if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
	}

	async selectAgent(value: string) {
		this.selAssign = Number(value);
		this.closePanel();
		if (this.page === "consumer-habits") { this.habitCal.events = this.buildHabitEvents(); return; }
		await this.refreshAgenda();
	}

	async createRequest() {
		await this.run(async () => {
			const hours = Number(this.form.hours);
			if (!(hours > 0)) throw new Error("Indiquez un nombre d’heures supérieur à 0, ou ajoutez directement vos disponibilités.");
			await fetcher.createRequest(this.selAssign as number, hours);
			this.form = {};
			await this.refreshAgenda();
		}, "Demande enregistrée. Ajoutez maintenant vos disponibilités dans l’agenda.");
	}

	/**
	 * Consumer: change the hours of the current request at any time.
	 * With `unlimited`, the limit is removed (the request goes back to "sans limite d’heures").
	 */
	async updateRequestHours(unlimited = false) {
		const request = this.currentRequest();
		if (!request) return;
		await this.run(async () => {
			let hours: number | null = null;
			if (!unlimited) {
				hours = Number(String(this.form.editHours ?? "").replace(",", "."));
				if (!(hours > 0)) throw new Error("Indiquez un nombre d’heures supérieur à 0.");
			}
			await fetcher.updateRequestHours(request.id, hours);
			this.form.editHours = "";
			await this.refreshAgenda();
		}, unlimited ? "La limite d’heures est retirée." : "Nombre d’heures mis à jour.");
	}

	closePanel() { this.panel = null; this.cal.selection = null; this.habitCal.selection = null; }

	/** Fallback for keyboard and touch users who do not want to pick a slot in the grid. */
	openCreate() {
		const s = new Date();
		s.setMinutes(Math.ceil(s.getMinutes() / 30) * 30, 0, 0);
		this.beginInterval(s, new Date(s.getTime() + 3600000));
	}

	/** A slot was drawn: the agent books a meeting when the gesture started on an availability, else adds his hours. */
	beginInterval(start: Date, end: Date, origin: CalEvent | null = null) {
		if (end.getTime() <= Date.now()) { this.cal.selection = null; this.error = "Ce créneau est déjà passé."; return; }
		if (this.role === "agent" && origin?.kind === "dispo") { this.error = ""; void this.openBook(origin, start, end); return; }
		if (this.role === "consumer" && this.selAssign === null) {
			this.cal.selection = null;
			this.error = "Aucun agent ne vous est assigné.";
			return;
		}
		if (this.role === "agent" && !this.contracts.length) { this.cal.selection = null; this.error = "Aucun contrat actif : demandez à votre administrateur."; return; }
		this.error = "";
		this.panel = {
			type: "interval", error: "",
			form: { id: null, start: toLocalInput(start), duration: Math.round((end.getTime() - start.getTime()) / 60000), love: 0.5, contractId: this.contracts[0]?.id, repeat: false, intervalWeeks: 1 }
		};
	}

	openEvent(ev: CalEvent) {
		this.error = "";
		if (ev.pending) { this.error = "Enregistrement en cours… réessayez dans un instant."; return; }
		if (ev.kind === "meeting") return this.openMeeting(ev.raw);
		if (ev.kind === "slot") { this.panel = { type: "slot", ev, error: "" }; return; }
		if (ev.kind === "proposal") { this.panel = { type: "proposal", ev, error: "" }; return; }
		if (ev.kind === "dispo" && this.role === "agent") return void this.openBook(ev);
		if (ev.virtual) { // an occurrence of one of my repetitions that is not generated yet
			this.panel = { type: "occurrence", ev, gen: this.generatorOf(ev.raw.generatorId), error: "" };
			return;
		}
		this.panel = { // editing one of my own intervals
			type: "interval", error: "",
			form: { id: ev.raw.id, start: toLocalInput(new Date(ev.raw.startAt)), duration: ev.raw.durationMinutes, love: ev.raw.love ?? 0.5, contractId: ev.raw.contractId,
				generatorId: ev.raw.generatorId ?? null, occurrence: ev.raw.generatorOccurrence ?? null }
		};
	}

	/** Consumer: turn the agent's slot into a new availability (prefilled form). */
	useSlot() {
		const ev: CalEvent = this.panel.ev;
		this.beginInterval(ev.start, ev.end);
	}

	/** Saves the slot of the panel: shown at once, sent in the background. "Répéter" creates a weekly repetition instead. */
	async submitInterval() {
		const f = this.panel.form;
		const start = new Date(f.start);
		const duration = Number(f.duration);
		const love = Number(f.love);
		if (!this.check(() => {
			if (Number.isNaN(start.getTime())) throw new Error("La date de début est invalide.");
			if (!Number.isInteger(duration) || duration <= 0) throw new Error("La durée doit être un nombre entier de minutes.");
			if (!(love >= 0 && love <= 1)) throw new Error("La préférence doit être comprise entre 0 et 1.");
			if (start.getTime() + duration * 60000 <= Date.now()) throw new Error("Ce créneau est déjà passé.");
			if (f.repeat && duration > 1440) throw new Error("Un créneau répété dure 24 h au plus.");
		})) return;
		const body = { startAt: start.toISOString(), durationMinutes: duration, love };
		const list = this.role === "consumer" ? "dispos" : "suggestions";
		if (!f.id && f.repeat) {
			const tz = browserTimeZone();
			const form = { ...newGenForm(), weekday: start.getDay(), start: hhmm(start.getHours() * 60 + start.getMinutes()), duration, love,
				intervalWeeks: Number(f.intervalWeeks) || 1, startsOn: localDate(start.getTime(), tz), contractId: Number(f.contractId) || null };
			let ok = false;
			this.check(() => { this.generatorBody(form); ok = true; });
			if (!ok) return;
			this.closePanel();
			return this.saveGenerator(form);
		}
		this.closePanel();
		if (f.id) return this.saveRow(list, f.id, body, "Créneau enregistré.");
		const tmp: any = this.role === "consumer"
			? { id: tempId(), assignationId: this.selAssign, requestId: this.currentRequest()?.id, ...body, _pending: true }
			: { id: tempId(), contractId: Number(f.contractId), ...body, _pending: true };
		await this.optimistic(() => {
			this[list] = [...this[list], tmp];
			return () => { this[list] = this[list].filter((x: any) => x.id !== tmp.id); };
		}, async () => {
			const saved = this.role === "consumer"
				? await fetcher.createDispo({ assignationId: tmp.assignationId, requestId: tmp.requestId, ...body })
				: await fetcher.createSuggestion({ contractId: tmp.contractId, ...body });
			this[list] = this[list].map((x: any) => x.id === tmp.id ? saved : x);
		}, "Créneau enregistré.");
	}

	async deleteInterval() {
		const f = this.panel.form;
		if (!confirm(f.generatorId ? "Supprimer cette occurrence ? La répétition continue les autres semaines." : "Supprimer ce créneau ?")) return;
		const id = f.id, list = this.role === "consumer" ? "dispos" : "suggestions";
		const row = this[list].find((x: any) => x.id === id);
		this.closePanel();
		await this.optimistic(() => {
			// A generated occurrence is cancelled in its repetition (the server does the same).
			const undoCancel = row?.generatorId ? this.setCancellations(row.generatorId, (d) => [...new Set([...d, row.generatorOccurrence])]) : null;
			this[list] = this[list].filter((x: any) => x.id !== id);
			return () => { undoCancel?.(); if (row) this[list] = [...this[list], row]; };
		}, async () => {
			if (list === "dispos") await fetcher.deleteDispo(id); else await fetcher.deleteSuggestion(id);
		}, "Créneau supprimé.");
	}

	// ---- Agent: book a meeting inside a consumer availability ---------------
	/**
	 * The meeting starts at the clicked quarter hour (or at the start of the availability when clicked elsewhere).
	 * When a slot was drawn from the availability, the meeting takes exactly that slot.
	 */
	private async openBook(ev: CalEvent, from?: Date, to?: Date) {
		const at = this.cal.lastPoint?.getTime() ?? 0;
		const start = from ?? (at >= ev.start.getTime() && at < ev.end.getTime() ? new Date(at) : ev.start);
		const minutes = to ? Math.round((to.getTime() - start.getTime()) / 60000) : Math.min(60, Math.round((ev.end.getTime() - start.getTime()) / 60000));
		this.panel = {
			type: "book", ev, error: "", key: uid(), rooms: [] as Room[],
			form: { assignationId: ev.raw.assignationId, start: toLocalInput(start), duration: minutes, roomName: "", comment: "" }
		};
		await this.checkRooms();
	}

	async checkRooms() {
		const p = this.panel;
		if (!p || p.type !== "book") return;
		const start = new Date(p.form.start);
		const duration = Number(p.form.duration);
		if (Number.isNaN(start.getTime()) || !Number.isInteger(duration) || duration <= 0) return;
		try { p.rooms = await fetcher.roomsAvailability(start.toISOString(), duration); } catch { p.rooms = []; }
		if (p.form.roomName && p.rooms.some((r: Room) => r.name === p.form.roomName && r.available === false)) p.form.roomName = "";
	}

	/** The meeting is drawn at once (checked here like the server does), and removed again if the server refuses it. */
	async submitBook() {
		const p = this.panel;
		const f = p.form;
		const start = new Date(f.start);
		const duration = Number(f.duration);
		if (!this.check(() => {
			if (Number.isNaN(start.getTime()) || !Number.isInteger(duration) || duration <= 0) throw new Error("Date ou durée invalide.");
			if (start.getTime() <= Date.now()) throw new Error("Un rendez-vous doit commencer dans le futur.");
			const ev: CalEvent = p.ev;
			const end = start.getTime() + duration * 60000;
			// Treat adjacent availability rows for the same request as one continuous window (repetitions included).
			const related = [...this.dispos, ...this.virtualDispos]
				.filter((d: any) => d.assignationId === f.assignationId && d.requestId === ev.raw.requestId)
				.map((d: any) => ({ start: Date.parse(d.startAt), end: Date.parse(d.startAt) + d.durationMinutes * 60000 }))
				.sort((a, b) => a.start - b.start);
			let coveredUntil = start.getTime();
			for (const interval of related) {
				if (interval.end <= coveredUntil) continue;
				if (interval.start > coveredUntil) break;
				coveredUntil = Math.max(coveredUntil, interval.end);
				if (coveredUntil >= end) break;
			}
			if (coveredUntil < end) {
				const windowEnd = related.find((interval) => interval.start <= start.getTime() && interval.end >= start.getTime())?.end ?? ev.end.getTime();
				throw new Error(`Le rendez-vous doit rester dans une disponibilité continue à partir de ${this.cal.time(new Date(start.getTime()))} (disponible jusqu’à ${this.cal.time(new Date(windowEnd))}).`);
			}
			const s = start.getTime();
			if (this.meetings.some((m) => m.status !== "canceledBy" && Date.parse(m.startAt) < end && Date.parse(m.startAt) + m.durationMinutes * 60000 > s)) {
				throw new Error("Vous avez déjà un rendez-vous sur ce créneau.");
			}
		})) return;
		this.closePanel();
		const tmp = this.tempMeeting(f.assignationId, start, duration, f.roomName || null, f.comment ?? "");
		await this.optimistic(() => {
			this.meetings = [...this.meetings, tmp];
			return () => { this.meetings = this.meetings.filter((m) => m.id !== tmp.id); };
		}, async () => {
			const r = await fetcher.createMeeting({
				assignationId: f.assignationId, startAt: start.toISOString(), durationMinutes: duration,
				roomName: f.roomName || null, comment: f.comment ?? "", idempotencyKey: p.key
			});
			this.meetings = this.meetings.map((m) => m.id === tmp.id ? r.meeting : m);
		}, "Rendez-vous créé.");
	}

	// ---- Meeting details and lifecycle -----------------------------------
	openMeeting(m: Meeting) {
		this.panel = {
			type: "meeting", m, error: "",
			form: { comment: m.comment ?? "", roomName: m.roomName ?? m.room ?? "", actual: m.durationMinutes }
		};
	}

	/** "60 min" or, for a meeting validated with another duration, "60 min prévues · 45 min effectuées". */
	durationLabel(m: Meeting): string {
		const a = m.actualDurationMinutes;
		return a != null && a !== m.durationMinutes ? `${m.durationMinutes} min prévues · ${a} min effectuées` : `${a ?? m.durationMinutes} min`;
	}

	canEditMeeting(m: Meeting): boolean { return this.role === "agent" && m.status === "pending" && m.id > 0; }
	canCancelMeeting(m: Meeting): boolean { return m.status === "pending" && m.id > 0; }

	/** Changes one meeting of the agenda on screen; returns how to undo it. */
	private patchMeetingLocal(id: number, change: Partial<Meeting>): () => void {
		const before = this.meetings.find((m) => m.id === id);
		this.meetings = this.meetings.map((m) => m.id === id ? { ...m, ...change } : m);
		return () => { if (before) this.meetings = this.meetings.map((m) => m.id === id ? before : m); };
	}

	async saveMeeting() {
		const p = this.panel;
		const id = p.m.id, change = { comment: p.form.comment, roomName: p.form.roomName || null };
		this.closePanel();
		await this.optimistic(() => this.patchMeetingLocal(id, change), async () => { await fetcher.patchMeeting(id, change); }, "Rendez-vous mis à jour.");
	}

	/** Validates the meeting with the duration really spent (the booked one by default). */
	async markDone() {
		const p = this.panel;
		const minutes = Number(p.form.actual);
		if (!this.check(() => { if (!Number.isInteger(minutes) || minutes <= 0) throw new Error("La durée réelle est un nombre entier de minutes, supérieur à 0."); })) return;
		const id = p.m.id, actual = minutes === p.m.durationMinutes ? null : minutes;
		// The comment and room typed in the panel are kept too.
		const change = { comment: p.form.comment, roomName: p.form.roomName || null };
		const changed = change.comment !== (p.m.comment ?? "") || change.roomName !== (p.m.roomName ?? null);
		this.closePanel();
		await this.optimistic(() => this.patchMeetingLocal(id, { ...change, status: "done", actualDurationMinutes: actual }), async () => {
			if (changed) await fetcher.patchMeeting(id, change);
			await fetcher.patchMeeting(id, { status: "done", actualDurationMinutes: actual });
		}, "Rendez-vous marqué comme terminé.");
	}

	async cancelMeeting() {
		if (!confirm("Annuler ce rendez-vous ?")) return;
		const id = this.panel.m.id;
		this.closePanel();
		await this.optimistic(() => this.patchMeetingLocal(id, { status: "canceledBy" }), async () => { await fetcher.cancelMeeting(id); }, "Rendez-vous annulé.");
	}
}

const raw = new DomHandler();
export const dom = Alpine.reactive(raw);
raw.bindAll(dom);
