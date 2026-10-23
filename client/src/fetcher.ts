// Fetcher: the only place that talks to the server.
// - prefixes every request with window.SERVER_ADDRESS (read lazily, at request time)
// - attaches the Bearer token
// - normalises snake_case keys coming from the server into camelCase
// - turns every failure into an ApiError carrying a French, user-facing message

const TOKEN_KEY = "planning.token";

export class ApiError extends Error {
	constructor(public status: number, message: string) {
		super(message);
	}
}

const camel = (s: string) => s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());

function camelize(value: any): any {
	if (Array.isArray(value)) return value.map(camelize);
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [camel(k), camelize(v)]));
	}
	return value;
}

type Query = Record<string, string | number | boolean | null | undefined>;

export class Fetcher {
	token: string | null = null;
	/** Called when the server answers 401 while a token was sent (expired session). */
	onUnauthorized: (() => void) | null = null;

	constructor() {
		try { this.token = sessionStorage.getItem(TOKEN_KEY); } catch { /* storage unavailable */ }
	}

	setToken(token: string | null): void {
		this.token = token;
		try {
			if (token) sessionStorage.setItem(TOKEN_KEY, token);
			else sessionStorage.removeItem(TOKEN_KEY);
		} catch { /* storage unavailable */ }
	}

	async request<T = any>(method: string, path: string, opts: { query?: Query; body?: unknown } = {}): Promise<T> {
		const url = new URL(path, window.SERVER_ADDRESS);
		for (const [k, v] of Object.entries(opts.query ?? {})) {
			if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
		}
		const headers: Record<string, string> = {};
		if (opts.body !== undefined) headers["Content-Type"] = "application/json";
		if (this.token) headers["Authorization"] = `Bearer ${this.token}`;

		let res: Response;
		try {
			res = await fetch(url, {
				method,
				headers,
				body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
			});
		} catch {
			throw new ApiError(0, "Serveur injoignable. Vérifiez votre connexion puis réessayez.");
		}

		let data: any = null;
		try { data = await res.json(); } catch { /* empty or non-JSON body */ }

		if (!res.ok) {
			if (res.status === 401 && this.token) this.onUnauthorized?.();
			throw new ApiError(res.status, data?.error ?? `Erreur ${res.status}.`);
		}
		return camelize(data) as T;
	}

	private get = <T = any>(path: string, query?: Query) => this.request<T>("GET", path, { query });
	private post = <T = any>(path: string, body: unknown = {}) => this.request<T>("POST", path, { body });
	private patch = <T = any>(path: string, body: unknown) => this.request<T>("PATCH", path, { body });
	private del = <T = any>(path: string) => this.request<T>("DELETE", path);

	// ---- Authentication -------------------------------------------------
	adminSignup(b: { username: string; password: string; displayName: string; companyName: string }) { return this.post("/api/admin/signup", b); }
	adminLogin(username: string, password: string) { return this.post("/api/admin/login", { username, password }); }
	agentLogin(username: string, password: string) { return this.post("/api/agent/login", { username, password }); }
	consumerAccess(key: string, password?: string) { return this.post("/api/consumer/access", { key, password: password || undefined }); }
	me() { return this.get("/api/me"); }
	logout() { return this.post("/api/logout"); }

	// ---- Administration -------------------------------------------------
	companies() { return this.get<any[]>("/api/companies"); }
	/** Percentage the company takes on the agent (default 28): 32 EUR paid = 25 EUR for the agent + 7 EUR for the company. */
	updateSocietyRate(societyRate: number) { return this.patch("/api/companies/current", { societyRate }); }
	consumers() { return this.get<any[]>("/api/consumers"); }
	searchConsumers(q: string) { return this.get<any[]>("/api/consumers/search", { q, limit: 20 }); }
	createConsumer(b: { name: string; surname: string; username: string; password?: string }) { return this.post("/api/consumers", b); }
	agents() { return this.get<any[]>("/api/agents"); }
	createAgent(b: { name: string; surname: string; username: string; password: string }) { return this.post("/api/agents", b); }

	/** Enrols an existing consumer in the admin's company (creates a Fidelity and its access key). */
	enrollConsumer(consumerId: number) { return this.post("/api/fidelities", { consumerId }); }
	/** Assigns an agent to a consumer's Fidelity (creates an Assignation). */
	assign(agentId: number, fidelityId: number) { return this.post("/api/assignations", { agentId, fidelityId }); }
	assignations() { return this.get<any[]>("/api/assignations"); }
	deleteAssignation(id: number) { return this.del(`/api/assignations/${id}`); }
	searchAgents(q: string) { return this.get<any[]>("/api/agents/search", { q, limit: 20 }); }
	/** Attaches an existing agent to the admin's company (creates a Contract). */
	attachAgent(agentId: number) { return this.post("/api/contracts", { agentId }); }
	/** Removes an agent from the admin's company. */
	removeAgent(agentId: number) { return this.del(`/api/agents/${agentId}`); }

	rooms() { return this.get<any[]>("/api/rooms"); }
	createRoom(name: string, limit: number) { return this.post("/api/rooms", { name, limit }); }
	renameRoom(name: string, newName: string) { return this.patch(`/api/rooms/${encodeURIComponent(name)}`, { newName }); }
	updateRoomLimit(name: string, limit: number) { return this.patch(`/api/rooms/${encodeURIComponent(name)}`, { limit }); }
	deactivateRoom(name: string) { return this.del(`/api/rooms/${encodeURIComponent(name)}`); }
	/** Saves every room in one request: the array order is the display order. */
	saveRooms(rooms: Array<{ name: string; newName?: string; limit: number }>) { return this.request<any[]>("PUT", "/api/rooms", { body: { rooms } }); }
	/** Gives a room to the room-less pending meetings of a period (rooms with limit -1 are never used). */
	autoAssignRooms(from: string, to: string) { return this.post<{ assigned: Array<{ meetingId: number; roomName: string }>; unassigned: number[] }>("/api/rooms/auto-assign", { from, to }); }
	roomsAvailability(startAt: string, durationMinutes: number) { return this.get<any[]>("/api/rooms/availability", { startAt, durationMinutes }); }

	// ---- Packages (hourly-rate formulas) ----------------------------------
	packages() { return this.get<any[]>("/api/packages"); }
	createPackage(name: string, hourlyRate: number) { return this.post("/api/packages", { name, hourlyRate }); }
	deletePackage(id: number) { return this.del(`/api/packages/${id}`); }
	/** Default package of a consumer in the admin's company (null = not defined, price 0). */
	setConsumerPackage(fidelityId: number, defaultPackageId: number | null) { return this.patch(`/api/fidelities/${fidelityId}`, { defaultPackageId }); }
	/** Package of an agent/consumer pair (null = the consumer's default package). */
	setAssignationPackage(assignationId: number, packageId: number | null) { return this.patch(`/api/assignations/${assignationId}`, { packageId }); }

	// ---- Agenda ---------------------------------------------------------
	agenda(from: string, to: string) { return this.get("/api/agenda", { from, to }); }
	createRequest(assignationId: number, requestedHours: number) { return this.post("/api/availability-requests", { assignationId, requestedHours }); }
	/** Changes the hours of a request at any time; null removes the limit. */
	updateRequestHours(id: number, requestedHours: number | null) { return this.patch(`/api/availability-requests/${id}`, { requestedHours }); }

	disponibilities(q: { assignationId?: number; from?: string; to?: string }) { return this.get<any[]>("/api/disponibilities", q); }
	createDispo(b: { assignationId: number; requestId?: number; startAt: string; durationMinutes: number; love: number }) { return this.post("/api/disponibilities", b); }
	updateDispo(id: number, b: { startAt: string; durationMinutes: number; love: number }) { return this.patch(`/api/disponibilities/${id}`, b); }
	deleteDispo(id: number) { return this.del(`/api/disponibilities/${id}`); }

	myConsumers() { return this.get<any[]>("/api/my-consumers"); }

	suggestions(q: { from?: string; to?: string }) { return this.get<any[]>("/api/suggestions", q); }
	createSuggestion(b: { contractId: number; startAt: string; durationMinutes: number; love: number }) { return this.post("/api/suggestions", b); }
	updateSuggestion(id: number, b: { startAt: string; durationMinutes: number; love: number }) { return this.patch(`/api/suggestions/${id}`, b); }
	deleteSuggestion(id: number) { return this.del(`/api/suggestions/${id}`); }

	createMeeting(b: { assignationId: number; startAt: string; durationMinutes: number; roomName: string | null; comment: string; idempotencyKey: string }) {
		return this.post("/api/meetings/from-availability", b);
	}
	patchMeeting(id: number, b: { comment?: string; roomName?: string | null; status?: "done" }) { return this.patch(`/api/meetings/${id}`, b); }
	cancelMeeting(id: number) { return this.post(`/api/meetings/${id}/cancel`); }
}

export const fetcher = new Fetcher();
