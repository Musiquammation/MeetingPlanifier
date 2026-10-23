// DomHandler: single Alpine component of the app.
// It owns the hash router, the session, the data of every page and the agenda actions.
// `dom` is a reactive singleton: Alpine.data("app", () => dom) then Alpine.start().

import Alpine from "alpinejs";
import { Calendar, addDays, toLocalInput, type CalEvent, type EventKind } from "./Calendar";
import { ResultsView } from "./Results";
import { fetcher } from "./fetcher";
import type { AvailabilityRequest, Company, Meeting, Package, Page, Role, Room } from "./types";

/** Required role per page (null = public page). */
const PAGES: Record<Page, Role | null> = {
	main: null,
	"admin-welcome": null, "admin-login": null, "admin-signup": null,
	"admin-dashboard": "admin", "admin-companies": "admin", "admin-consumers": "admin", "admin-agents": "admin", "admin-rooms": "admin",
	"admin-packages": "admin", "admin-results": "admin",
	"agent-welcome": null, "agent-login": null, "agent-signup": null,
	"agent-dashboard": "agent", "agent-companies": "agent", "agent-consumers": "agent", "agent-agenda": "agent", "agent-results": "agent",
	"consumer-welcome": null, "consumer-access": null,
	"consumer-dashboard": "consumer", "consumer-agenda": "consumer"
};
/** Period wide enough to get every meeting, whatever its date (results pages). */
const ALL_FROM = "2000-01-01T00:00:00.000Z";
const ALL_TO = "2100-01-01T00:00:00.000Z";
/** Default percentage the company takes on the agent (same value as the server). */
const DEFAULT_SOCIETY_RATE = 28;
const HOME: Record<Role, Page> = { admin: "admin-dashboard", agent: "agent-dashboard", consumer: "consumer-dashboard" };
const STATUS: Record<string, string> = { pending: "En attente", done: "Terminé", canceledBy: "Annulé" };
const KIND: Record<EventKind, string> = { meeting: "Rendez-vous", dispo: "Disponibilité", suggestion: "Suggestion", slot: "Créneau de l’agent" };

/** The server reports minutes; the UI works in hours. */
const normRequest = (r: any): AvailabilityRequest => ({
	...r,
	requestedHours: r.requestedHours ?? Math.round((r.requestedMinutes ?? 0) / 6) / 10,
	scheduledHours: r.scheduledHours ?? Math.round((r.scheduledMinutes ?? 0) / 6) / 10
});

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

	cal = new Calendar();

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
		const raw = decodeURIComponent(location.hash.replace(/^#\/?/, "")).split("?")[0];
		let page = (Object.prototype.hasOwnProperty.call(PAGES, raw) ? raw : "main") as Page;
		const need = PAGES[page];
		if (need && this.role !== need) page = `${need}-welcome` as Page; // private page without matching session
		else if (!need && this.role && page.startsWith(`${this.role}-`)) page = HOME[this.role]; // already logged in
		if (location.hash !== `#${page}`) history.replaceState(null, "", `#${page}`);

		this.page = page;
		this.form = {}; this.created = null; this.panel = null; this.results = [];
		this.notice = ""; this.error = this.flash; this.flash = "";
		this.ready = true;
		window.scrollTo(0, 0);
		await this.loadPage();
	}

	// ---- Helpers for submits and loads -----------------------------------
	private async run(fn: () => Promise<void>, ok = ""): Promise<void> {
		if (this.busy) return;
		this.busy = true; this.error = ""; this.notice = "";
		if (this.panel) this.panel.error = "";
		try {
			await fn();
			if (ok) this.notice = ok;
		} catch (e: any) {
			const msg = e?.message ?? "Une erreur est survenue.";
			if (this.panel) this.panel.error = msg; else this.error = msg;
		} finally { this.busy = false; }
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
				return this.load(async () => { this.assignations = await fetcher.myConsumers(); });
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
	/** An implicit request (hours not stated by the consumer) is created with this many hours. */
	isUnlimited(r: AvailabilityRequest): boolean { return r.requestedHours >= 1000; }
	progress(r: AvailabilityRequest): string {
		return this.isUnlimited(r) ? `${r.scheduledHours ?? 0} h planifiées (sans limite d’heures)` : `${r.scheduledHours ?? 0} / ${r.requestedHours} h planifiées`;
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
		return mine.find((r) => (r.scheduledHours ?? 0) < r.requestedHours) ?? mine[0];
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
		await this.run(async () => {
			try {
				await fetcher.patchMeeting(m.id, { roomName: select.value || null });
			} catch (e) {
				select.value = m.roomName ?? ""; // show the real room again
				throw e;
			}
			const { from, to } = horizon(14);
			this.meetings = (await fetcher.agenda(from, to)).meetings ?? [];
		}, "Salle mise à jour.");
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

	/** The only changes allowed from the results: validate, cancel or comment a pending meeting. */
	async resultDone(id: number) {
		await this.run(async () => { await fetcher.patchMeeting(id, { status: "done" }); await this.reloadResults(); }, "Rendez-vous marqué comme terminé.");
	}
	async resultCancel(id: number) {
		if (!confirm("Annuler ce rendez-vous ?")) return;
		await this.run(async () => { await fetcher.cancelMeeting(id); await this.reloadResults(); }, "Rendez-vous annulé.");
	}
	async resultComment(id: number, text: string) {
		await this.run(async () => { await fetcher.patchMeeting(id, { comment: text }); await this.reloadResults(); }, "Commentaire enregistré.");
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
		this.cal.onSelect = (s, e) => this.beginInterval(s, e);
		this.cal.selection = null;
		this.cal.attach(() => void this.refreshAgenda());
		await this.refreshAgenda();
	}

	async refreshAgenda(): Promise<void> {
		await this.load(async () => {
			const { from, to } = this.cal.range;
			const a = await fetcher.agenda(from, to);
			this.meetings = a.meetings ?? [];
			if (this.role === "agent") {
				this.contracts = a.contracts ?? []; this.assignations = a.assignations ?? []; this.suggestions = a.suggestions ?? [];
				this.requests = (a.requests ?? []).map(normRequest); // used by the "Demandeurs" filter
				[this.dispos, this.rooms] = await Promise.all([fetcher.disponibilities({ from, to }), fetcher.rooms()]);
			} else {
				this.agentsList = a.agents ?? []; this.requests = (a.requests ?? []).map(normRequest); this.slots = a.agentSlots ?? []; // the agent's hours, independent of my availabilities
				if (this.selAssign === null && this.agentsList.length) this.selAssign = this.assignId(this.agentsList[0]);
				this.dispos = this.selAssign ? await fetcher.disponibilities({ assignationId: this.selAssign, from, to }) : [];
			}
			this.cal.events = this.buildEvents();
		});
	}

	private buildEvents(): CalEvent[] {
		const mk = (kind: EventKind, x: any, title: string, editable = false, status?: string): CalEvent => ({
			id: `${kind}-${x.id}`, kind, title, status, editable, love: x.love, raw: x,
			start: new Date(x.startAt), end: new Date(Date.parse(x.startAt) + x.durationMinutes * 60000)
		});
		const out: CalEvent[] = [];
		const agent = this.role === "agent";
		// Cancelled meetings are not drawn in the calendar: they are listed in their own section
		for (const m of this.meetings) if (m.status !== "canceledBy") out.push(mk("meeting", m, agent ? this.who(m.assignationId) : "Rendez-vous", false, m.status));
		if (agent) {
			for (const s of this.suggestions) out.push(mk("suggestion", s, "Mes horaires", true));
			for (const d of this.dispos) if (this.isVisible(d.assignationId)) out.push(mk("dispo", d, this.who(d.assignationId)));
		} else {
			for (const s of this.slots) {
				const target = s.assignationId;
				if (this.selAssign !== null && target !== undefined && target !== this.selAssign) continue;
				out.push(mk("slot", s, "Agent disponible"));
			}
			for (const d of this.dispos) out.push(mk("dispo", d, "Ma disponibilité", true));
		}
		return out;
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
		await this.run(async () => {
			const body = { startAt: start.toISOString(), durationMinutes: data.duration, love: data.love ?? 0.5 };
			if (data.kind === "dispo") await fetcher.updateDispo(data.id, body);
			else await fetcher.updateSuggestion(data.id, body);
			await this.refreshAgenda();
		}, "Créneau déplacé.");
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

	closePanel() { this.panel = null; this.cal.selection = null; }

	/** Fallback for keyboard and touch users who do not want to pick a slot in the grid. */
	openCreate() {
		const s = new Date();
		s.setMinutes(Math.ceil(s.getMinutes() / 30) * 30, 0, 0);
		this.beginInterval(s, new Date(s.getTime() + 3600000));
	}

	beginInterval(start: Date, end: Date) {
		if (end.getTime() <= Date.now()) { this.cal.selection = null; this.error = "Ce créneau est déjà passé."; return; }
		if (this.role === "consumer" && this.selAssign === null) {
			this.cal.selection = null;
			this.error = "Aucun agent ne vous est assigné.";
			return;
		}
		if (this.role === "agent" && !this.contracts.length) { this.cal.selection = null; this.error = "Aucun contrat actif : demandez à votre administrateur."; return; }
		this.error = "";
		this.panel = {
			type: "interval", error: "",
			form: { id: null, start: toLocalInput(start), duration: Math.round((end.getTime() - start.getTime()) / 60000), love: 0.5, contractId: this.contracts[0]?.id }
		};
	}

	openEvent(ev: CalEvent) {
		this.error = "";
		if (ev.kind === "meeting") return this.openMeeting(ev.raw);
		if (ev.kind === "slot") { this.panel = { type: "slot", ev, error: "" }; return; }
		if (ev.kind === "dispo" && this.role === "agent") return void this.openBook(ev);
		this.panel = { // editing one of my own intervals
			type: "interval", error: "",
			form: { id: ev.raw.id, start: toLocalInput(ev.start), duration: ev.raw.durationMinutes, love: ev.raw.love ?? 0.5, contractId: ev.raw.contractId }
		};
	}

	/** Consumer: turn the agent's slot into a new availability (prefilled form). */
	useSlot() {
		const ev: CalEvent = this.panel.ev;
		this.beginInterval(ev.start, ev.end);
	}

	async submitInterval() {
		await this.run(async () => {
			const f = this.panel.form;
			const start = new Date(f.start);
			const duration = Number(f.duration);
			const love = Number(f.love);
			if (Number.isNaN(start.getTime())) throw new Error("La date de début est invalide.");
			if (!Number.isInteger(duration) || duration <= 0) throw new Error("La durée doit être un nombre entier de minutes.");
			if (!(love >= 0 && love <= 1)) throw new Error("La préférence doit être comprise entre 0 et 1.");
			if (start.getTime() + duration * 60000 <= Date.now()) throw new Error("Ce créneau est déjà passé.");
			const body = { startAt: start.toISOString(), durationMinutes: duration, love };
			if (this.role === "consumer") {
				if (f.id) await fetcher.updateDispo(f.id, body);
				else await fetcher.createDispo({ assignationId: this.selAssign as number, requestId: this.currentRequest()?.id, ...body });
			} else if (f.id) await fetcher.updateSuggestion(f.id, body);
			else await fetcher.createSuggestion({ contractId: Number(f.contractId), ...body });
			this.closePanel();
			await this.refreshAgenda();
		}, "Créneau enregistré.");
	}

	async deleteInterval() {
		if (!confirm("Supprimer ce créneau ?")) return;
		await this.run(async () => {
			const id = this.panel.form.id;
			if (this.role === "consumer") await fetcher.deleteDispo(id); else await fetcher.deleteSuggestion(id);
			this.closePanel();
			await this.refreshAgenda();
		}, "Créneau supprimé.");
	}

	// ---- Agent: book a meeting inside a consumer availability ---------------
	private async openBook(ev: CalEvent) {
		const minutes = Math.round((ev.end.getTime() - ev.start.getTime()) / 60000);
		this.panel = {
			type: "book", ev, error: "", key: uid(), rooms: [] as Room[],
			form: { assignationId: ev.raw.assignationId, start: toLocalInput(ev.start), duration: Math.min(60, minutes), roomName: "", comment: "" }
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

	async submitBook() {
		await this.run(async () => {
			const p = this.panel;
			const f = p.form;
			const start = new Date(f.start);
			const duration = Number(f.duration);
			if (Number.isNaN(start.getTime()) || !Number.isInteger(duration) || duration <= 0) throw new Error("Date ou durée invalide.");
			const ev: CalEvent = p.ev;
			const end = start.getTime() + duration * 60000;
			// Treat adjacent availability rows for the same request as one continuous window.
			const related = this.dispos
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
			if (start.getTime() < ev.start.getTime() || coveredUntil < end) {
				const windowEnd = related.find((interval) => interval.start <= start.getTime() && interval.end >= start.getTime())?.end ?? ev.end.getTime();
				throw new Error(`Le rendez-vous doit rester dans une disponibilité continue à partir de ${this.cal.time(new Date(start.getTime()))} (disponible jusqu’à ${this.cal.time(new Date(windowEnd))}).`);
			}
			await fetcher.createMeeting({
				assignationId: f.assignationId, startAt: start.toISOString(), durationMinutes: duration,
				roomName: f.roomName || null, comment: f.comment ?? "", idempotencyKey: p.key
			});
			this.closePanel();
			await this.refreshAgenda();
		}, "Rendez-vous créé.");
	}

	// ---- Meeting details and lifecycle -----------------------------------
	openMeeting(m: Meeting) {
		this.panel = {
			type: "meeting", m, error: "",
			form: { comment: m.comment ?? "", roomName: m.roomName ?? m.room ?? "" }
		};
	}

	canEditMeeting(m: Meeting): boolean { return this.role === "agent" && m.status === "pending"; }
	canCancelMeeting(m: Meeting): boolean { return m.status === "pending"; }

	async saveMeeting() {
		await this.run(async () => {
			const p = this.panel;
			await fetcher.patchMeeting(p.m.id, { comment: p.form.comment, roomName: p.form.roomName || null });
			this.closePanel();
			await this.refreshAgenda();
		}, "Rendez-vous mis à jour.");
	}

	async markDone() {
		await this.run(async () => {
			await fetcher.patchMeeting(this.panel.m.id, { status: "done" });
			this.closePanel();
			await this.refreshAgenda();
		}, "Rendez-vous marqué comme terminé.");
	}

	async cancelMeeting() {
		if (!confirm("Annuler ce rendez-vous ?")) return;
		await this.run(async () => {
			await fetcher.cancelMeeting(this.panel.m.id);
			this.closePanel();
			await this.refreshAgenda();
		}, "Rendez-vous annulé.");
	}
}

const raw = new DomHandler();
export const dom = Alpine.reactive(raw);
raw.bindAll(dom);
