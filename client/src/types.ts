// Shared type definitions for the client.
// Server records whose exact shape is not guaranteed by the REST contract are typed loosely (any).

export type Role = "admin" | "agent" | "consumer";
export type Id = number;

export type Page =
	| "main"
	| "admin-welcome" | "admin-login" | "admin-signup"
	| "admin-dashboard" | "admin-companies" | "admin-consumers" | "admin-agents" | "admin-rooms"
	| "agent-welcome" | "agent-login" | "agent-signup"
	| "agent-dashboard" | "agent-companies" | "agent-consumers" | "agent-agenda"
	| "consumer-welcome" | "consumer-access" | "consumer-dashboard" | "consumer-agenda";

export interface Company { id: Id; name: string }

export interface Room {
	name: string;
	limit: number;
	active?: boolean;
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
	comment?: string;
}

export interface AvailabilityRequest {
	id: Id;
	assignationId: Id;
	requestedHours: number;
	scheduledHours?: number;
}

declare global {
	interface Window { SERVER_ADDRESS: string }
}
