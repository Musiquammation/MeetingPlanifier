// DomHandler: single Alpine component of the app.
// It owns the hash router, the session, the data of every page and the agenda actions.
// `dom` is a reactive singleton: Alpine.data("app", () => dom) then Alpine.start().

import Alpine from "alpinejs";
import { Calendar, addDays, toLocalInput, type CalEvent, type EventKind } from "./Calendar";
import { fetcher } from "./fetcher";
import type { AvailabilityRequest, Company, Meeting, Page, Role, Room } from "./types";

/** Required role per page (null = public page). */
const PAGES: Record<Page, Role | null> = {
	main: null,
	"admin-welcome": null, "admin-login": null, "admin-signup": null,
	"admin-dashboard": "admin", "admin-companies": "admin", "admin-consumers": "admin", "admin-agents": "admin", "admin-rooms": "admin",
	"agent-welcome": null, "agent-login": null, "agent-signup": null,
	"agent-dashboard": "agent", "agent-companies": "agent", "agent-consumers": "agent", "agent-agenda": "agent",
	"consumer-welcome": null, "consumer-access": null,
	"consumer-dashboard": "consumer", "consumer-agenda": "consumer"
};
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
					const [a, c, ag] = await Promise.all([fetcher.agenda(from, to), fetcher.consumers(), fetcher.agents()]);
					this.meetings = a.meetings ?? []; this.consumers = c; this.agents = ag;
				});
			case "admin-companies": case "agent-companies":
				return this.load(async () => { this.companies = await fetcher.companies(); });
			case "admin-consumers":
				return this.load(async () => { [this.consumers, this.agents] = await Promise.all([fetcher.consumers(), fetcher.agents()]); });
			case "admin-agents":
				this.agentResults = []; this.searched = false; this.openAgent = null;
				return this.load(async () => { [this.consumers, this.agents, this.assignations] = await Promise.all([fetcher.consumers(), fetcher.agents(), fetcher.assignations()]); });
			case "admin-rooms":
				return this.load(() => this.loadRooms());
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
	toggleConsumer(assignationId: number): void {
		this.showDispo = { ...this.showDispo, [assignationId]: !this.isShown(assignationId) };
		this.cal.events = this.buildEvents();
	}
	setAllConsumers(on: boolean): void {
		this.showDispo = Object.fromEntries(this.assignations.map((x) => [x.id, on]));
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

	async assign() {
		await this.run(async () => {
			await fetcher.assign(Number(this.form.agentId), Number(this.form.fidelityId));
			this.form = {};
			this.assignations = await fetcher.assignations();
		}, "Agent assigné au consommateur.");
	}

	private async loadRooms(): Promise<void> {
		this.rooms = (await fetcher.rooms()).map((r: Room) => ({ ...r, draftName: r.name, draftLimit: r.limit }));
	}

	async createRoom() {
		await this.run(async () => {
			const limit = Number(this.form.limit ?? -1);
			if (!Number.isInteger(limit) || (limit !== -1 && limit < 1)) throw new Error("La limite vaut -1 (illimitée) ou un entier positif.");
			await fetcher.createRoom(String(this.form.name ?? ""), limit);
			this.form = {};
			await this.loadRooms();
		}, "Salle créée.");
	}

	async saveRoom(r: Room) {
		await this.run(async () => {
			const limit = Number(r.draftLimit);
			if (!Number.isInteger(limit) || (limit !== -1 && limit < 1)) throw new Error("La limite vaut -1 (illimitée) ou un entier positif.");
			let name = r.name;
			if (r.draftName && r.draftName !== name) { await fetcher.renameRoom(name, r.draftName); name = r.draftName; }
			if (limit !== r.limit) await fetcher.updateRoomLimit(name, limit);
			await this.loadRooms();
		}, "Salle enregistrée.");
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
			for (const d of this.dispos) if (this.isShown(d.assignationId)) out.push(mk("dispo", d, this.who(d.assignationId)));
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
		let data: { kind: EventKind; id: number; duration: number };
		try { data = JSON.parse(payload); } catch { return; }
		if (data.kind !== "dispo" && data.kind !== "suggestion") return;
		const col = e.currentTarget as HTMLElement;
		const rect = col.getBoundingClientRect();
		const minutes = this.cal.settings.startHour * 60 + Math.floor(((e.clientY - rect.top) / rect.height) * this.cal.hours.length * 60 / 15) * 15;
		const start = new Date(day); start.setHours(0, minutes, 0, 0);
		if (start.getTime() <= Date.now()) { this.error = "Impossible de déplacer un créneau dans le passé."; return; }
		await this.run(async () => {
			const body = { startAt: start.toISOString(), durationMinutes: data.duration };
			if (data.kind === "dispo") await fetcher.updateDispo(data.id, body);
			else await fetcher.updateSuggestion(data.id, body);
			await this.refreshAgenda();
		}, "Créneau déplacé.");
	}

	dragCalendarEvent(e: DragEvent, ev: CalEvent) {
		if (!ev.editable || (ev.kind !== "dispo" && ev.kind !== "suggestion")) { e.preventDefault(); return; }
		e.dataTransfer?.setData("text/calendar-event", JSON.stringify({
			kind: ev.kind, id: ev.raw.id, duration: Math.round((ev.end.getTime() - ev.start.getTime()) / 60000)
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
			if (start < ev.start || start.getTime() + duration * 60000 > ev.end.getTime()) {
				throw new Error(`Le rendez-vous doit rester dans la disponibilité (${this.cal.time(ev.start)} – ${this.cal.time(ev.end)}).`);
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
