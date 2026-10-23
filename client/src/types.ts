// Shared type definitions for the client.
// Server records whose exact shape is not guaranteed by the REST contract are typed loosely (any).

export type Role = "admin" | "agent" | "consumer";
export type Id = number;

export type Page =
	| "main"
	| "admin-welcome" | "admin-login" | "admin-signup"
	| "admin-dashboard" | "admin-companies" | "admin-consumers" | "admin-agents" | "admin-rooms" | "admin-packages" | "admin-results"
	| "agent-welcome" | "agent-login" | "agent-signup"
	| "agent-dashboard" | "agent-companies" | "agent-consumers" | "agent-agenda" | "agent-results"
	| "consumer-welcome" | "consumer-access" | "consumer-dashboard" | "consumer-agenda";

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
	durationMinutes: number;
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

/** A package ("formule") is a named hourly rate. */
export interface Package { id: Id; name: string; hourlyRate: number }

export interface AvailabilityRequest {
	id: Id;
	assignationId: Id;
	requestedHours: number;
	scheduledHours?: number;
	/** Raw values from the server (minutes), used to know the hours that remain. */
	status?: "open" | "fulfilled" | "closed";
	requestedMinutes?: number;
	scheduledMinutes?: number;
	remainingMinutes?: number;
}

declare global {
	interface Window { SERVER_ADDRESS: string }
}
