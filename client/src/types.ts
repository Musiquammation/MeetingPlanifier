// Shared type definitions for the client.
// Server records whose exact shape is not guaranteed by the REST contract are typed loosely (any).

export type Role = "admin" | "agent" | "consumer";
export type Id = number;

export type Page =
	| "main"
	| "admin-welcome" | "admin-login" | "admin-signup"
	| "admin-dashboard" | "admin-companies" | "admin-consumers" | "admin-agents" | "admin-rooms" | "admin-packages" | "admin-results"
	| "agent-welcome" | "agent-login" | "agent-signup"
	| "agent-dashboard" | "agent-companies" | "agent-consumers" | "agent-agenda" | "agent-habits" | "agent-results" | "agent-script"
	| "consumer-welcome" | "consumer-access" | "consumer-dashboard" | "consumer-agenda" | "consumer-habits";

/** societyRate (percent) is only sent to administrators: the company takes it on top of the agent's amount (default 28). */
export interface Company { id: Id; name: string; societyRate?: number }

export interface Room {
	name: string;
	limit: number;
	active?: boolean;
	/** Order chosen by the admin (drag and drop in #admin-rooms). */
	position?: number;
	// Filled by GET /api/rooms/availability
	available?: boolean;
	free?: number;
	// Local edit buffers used by the admin-rooms page
	draftName?: string;
	draftLimit?: number;
}

export interface Meeting {
	id: Id;
	assignationId: Id;
	startAt: string;
	/** Duration booked. */
	durationMinutes: number;
	/** Duration really spent, given when the meeting was validated (null = the booked duration). */
	actualDurationMinutes?: number | null;
	status: "pending" | "done" | "canceledBy";
	room?: string | null;
	roomName?: string | null;
	/** Hourly rate applied to the meeting (from the package resolved when the meeting was created). Admin only. */
	hourlyRate?: number;
	/** Percentage the company takes on the agent (admin only). */
	societyRate?: number;
	/** Hourly amount received by the agent (admin and the agent himself). */
	agentHourlyRate?: number;
	/** Hourly amount kept by the company (admin only). */
	societyHourlyRate?: number;
	comment?: string;
}

/**
 * Weekly repetition ("générateur") of the agent's hours (kind "suggestion") or of a consumer's availabilities
 * (kind "disponibility"). The server generates the next two weeks; the agenda draws the later occurrences itself.
 */
export interface Generator {
	id: Id;
	kind: "suggestion" | "disponibility";
	contractId: Id | null;
	assignationId: Id | null;
	requestId?: Id | null;
	weekday: number;
	startMinute: number;
	durationMinutes: number;
	/** Not sent to a consumer for his agent's hours. */
	love?: number;
	intervalWeeks: number;
	timeZone: string;
	startsOn: string;
	endsOn: string | null;
	/** Occurrences starting before this instant exist as real rows (or were skipped). */
	generatedUntil: string;
	/** Local dates of the cancelled occurrences. */
	cancellations: string[];
}

export interface GeneratorBody {
	weekday: number; startMinute: number; durationMinutes: number; love: number; intervalWeeks: number;
	timeZone: string; startsOn: string; endsOn: string | null;
	contractId?: number; assignationId?: number; requestId?: number;
}

/** A package ("formule") is a named hourly rate. */
export interface Package { id: Id; name: string; hourlyRate: number }

export interface AvailabilityRequest {
	id: Id;
	assignationId: Id;
	requestedHours: number;
	scheduledHours?: number;
	/** Hours still wanted (validated or done meetings are not counted). */
	remainingHours?: number;
	/** Raw values from the server (minutes), used to know the hours that remain. */
	status?: "open" | "fulfilled" | "closed";
	requestedMinutes?: number;
	scheduledMinutes?: number;
	remainingMinutes?: number;
}

/** Intercourse chosen for a pair of consumers of the agent (unordered, replaces max of both defaults). */
export interface IntercoursePair { assignationA: Id; assignationB: Id; minutes: number }

/** Meeting proposed by the optimizer of the agent agenda: client side only until validated. */
export interface Proposal { id: string; assignationId: Id; start: Date; end: Date; score: number }

declare global {
	interface Window { SERVER_ADDRESS: string }
}

/** Userscript of the agent (secret values are write-only: only their names come back). */
export interface AgentScript {
	code: string;
	enabled: boolean;
	updatedAt: string | null;
	secretNames: string[];
	eventTypes: string[];
	limits: { cpuTimeMs: number; wallTimeMs: number; memoryMb: number; maxRequests: number; requestTimeoutMs: number; maxResponseBytes: number };
}

export interface ScriptRun {
	id: number;
	trigger: "event" | "test";
	eventType: string;
	meetingId: number | null;
	status: "ok" | "error" | "timeout" | "skipped";
	durationMs: number;
	logs: string[];
	result: string | null;
	error: string | null;
	createdAt: string;
}
