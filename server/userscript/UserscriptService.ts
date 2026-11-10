// Userscripts of the agents: builds the arguments of an event, runs the script in a sandboxed child process
// (runner.mjs) and stores the result. The public API is described in USERSCRIPT_API.md.

import { fork, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentScriptRun, Database, UserscriptMeetingContext } from "../Database";

export type UserscriptEventType = "new-meeting" | "update-meeting" | "cancel-meeting" | "valid-meeting";
export const USERSCRIPT_EVENT_TYPES: UserscriptEventType[] = ["new-meeting", "update-meeting", "cancel-meeting", "valid-meeting"];
type Actor = { role: "admin" | "agent" | "consumer" };
/** What an update-meeting event changed: only the fields that really changed are present. */
export type MeetingChanges = {
	room?: { from: string | null; to: string | null };
	comment?: { from: string; to: string };
};

export interface UserscriptLimits {
	/** CPU time of each synchronous run of the isolate (top level, then the call of userscript). */
	cpuTimeMs: number;
	/** Total duration, HTTP requests included; the child process is killed a bit after it. */
	wallTimeMs: number;
	memoryMb: number;
	maxRequests: number;
	requestTimeoutMs: number;
	maxRequestBytes: number;
	maxResponseBytes: number;
	maxLogLines: number;
	maxLogBytes: number;
	maxResultBytes: number;
	/** Only for local development: lets scripts reach localhost and private networks. */
	allowPrivateNetwork: boolean;
}

export const DEFAULT_LIMITS: UserscriptLimits = {
	cpuTimeMs: 1000,
	wallTimeMs: 10000,
	memoryMb: 32,
	maxRequests: 10,
	requestTimeoutMs: 5000,
	maxRequestBytes: 256 * 1024,
	maxResponseBytes: 1024 * 1024,
	maxLogLines: 200,
	maxLogBytes: 64 * 1024,
	maxResultBytes: 16 * 1024,
	allowPrivateNetwork: process.env.USERSCRIPT_ALLOW_PRIVATE_NETWORK === "1",
};

type Outcome = Pick<AgentScriptRun, "status" | "result" | "logs" | "error" | "durationMs">;

const here = dirname(fileURLToPath(import.meta.url));
const RUNNER = resolve(here, "runner.mjs");
const requireHere = createRequire(import.meta.url);
/** Native binary of isolated-vm, loaded directly by the runner (see runner.mjs). */
const ISOLATED_VM_BINARY: string = requireHere("node-gyp-build").path(dirname(requireHere.resolve("isolated-vm/package.json")));

const round2 = (n: number) => Math.round(n * 100) / 100;
const addMinutes = (iso: string, minutes: number) => new Date(Date.parse(iso) + minutes * 60000).toISOString();

export class UserscriptService {
	private running = 0;
	private readonly queue: Array<() => void> = [];
	private readonly queuedPerAgent = new Map<number, number>();
	private readonly agentTail = new Map<number, Promise<void>>();

	constructor(
		private readonly database: Database,
		private readonly limits: UserscriptLimits = DEFAULT_LIMITS,
		private readonly maxConcurrent = 2,
		private readonly maxQueuedPerAgent = 50,
	) {}

	// ---- Arguments ------------------------------------------------------------

	/**
	 * Arguments given to userscript(env, args), from the agent's point of view.
	 * Only the consumer and the package of the event are included. Everything is a fresh plain object.
	 */
	buildArgs(type: UserscriptEventType, ctx: UserscriptMeetingContext, actor: Actor | null, test = false, changes: MeetingChanges | null = null): Record<string, unknown> {
		const m = ctx.meeting;
		// Once validated, the meeting lasts the time really spent (when the agent gave it): prices follow it.
		const minutes = m.actualDurationMinutes ?? m.durationMinutes;
		const hours = minutes / 60;
		const meeting = {
			id: m.id,
			status: m.status,
			startAt: m.startAt,
			endAt: addMinutes(m.startAt, minutes),
			durationMinutes: minutes,
			durationHours: round2(hours),
			plannedEndAt: addMinutes(m.startAt, m.durationMinutes),
			plannedDurationMinutes: m.durationMinutes,
			actualDurationMinutes: m.actualDurationMinutes,
			consumer: ctx.consumer.username,
			company: { id: ctx.company.id, name: ctx.company.name },
			room: m.roomName,
			comment: m.comment,
			pricing: ctx.package?.name ?? null,
			hourlyRate: round2(m.hourlyRate),
			agentHourlyRate: round2(m.agentHourlyRate),
			societyHourlyRate: round2(m.societyHourlyRate),
			price: round2(m.hourlyRate * hours),
			agentAmount: round2(m.agentHourlyRate * hours),
			societyAmount: round2(m.societyHourlyRate * hours),
			societyCommission: m.societyRate / 100,
			availabilityRequestId: m.availabilityRequestId,
			consumerLove: m.sourceDisponibilityLove,
			agentLove: m.sourceSuggestionLove,
			canceledBy: m.canceledByRole,
			createdAt: m.createdAt,
			updatedAt: m.updatedAt,
		};
		const consumers = {
			[ctx.consumer.username]: {
				id: ctx.consumer.id,
				username: ctx.consumer.username,
				name: ctx.consumer.name,
				surname: ctx.consumer.surname,
				key: ctx.consumer.key,
				pricing: ctx.package?.name ?? null,
				intercourseMinutes: ctx.intercourseMinutes,
				company: { id: ctx.company.id, name: ctx.company.name },
			},
		};
		const pricings: Record<string, number> = ctx.package ? { [ctx.package.name]: ctx.package.hourlyRate } : {};
		return {
			event: {
				type, meeting, actor: actor ? { role: actor.role } : null, triggeredAt: new Date().toISOString(), test,
				changes: changes ? JSON.parse(JSON.stringify(changes)) : null,
			},
			agent: { ...ctx.agent },
			company: { id: ctx.company.id, name: ctx.company.name },
			consumers,
			pricings,
			societyCommission: ctx.company.societyRate / 100,
		};
	}

	/** Fake event for the "test" button when the agent has no meeting yet. */
	sampleArgs(type: UserscriptEventType, agentId: number): Record<string, unknown> {
		const agent = this.database.getAgentById(agentId);
		const start = new Date(Date.now() + 86400000);
		start.setUTCMinutes(0, 0, 0);
		return this.buildArgs(type, {
			meeting: {
				id: 0, assignationId: 0, availabilityRequestId: null, sourceContractId: null, sourceDisponibilityLove: 1,
				sourceSuggestionLove: 1, startAt: start.toISOString(), durationMinutes: 60,
				actualDurationMinutes: type === "valid-meeting" ? 45 : null,
				status: type === "cancel-meeting" ? "canceledBy" : type === "valid-meeting" ? "done" : "pending",
				roomCompanyId: null, roomName: "Salle A", hourlyRate: 32, societyRate: 28, agentHourlyRate: 25, societyHourlyRate: 7,
				comment: "Example meeting", canceledByRole: type === "cancel-meeting" ? "consumer" : null, canceledById: null,
				idempotencyKey: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
			},
			assignationId: 0,
			intercourseMinutes: 0,
			agent: agent ? { id: agent.id, name: agent.name, surname: agent.surname, username: agent.username } : { id: agentId, name: "", surname: "", username: "" },
			company: { id: 0, name: "Example company", societyRate: 28 },
			consumer: { id: 0, name: "Jane", surname: "Doe", username: "jane.doe", key: "ABC123" },
			package: { id: 0, name: "standard", hourlyRate: 32 },
		}, { role: "agent" }, true, type === "update-meeting" ? { room: { from: "Salle B", to: "Salle A" } } : null);
	}

	// ---- Execution ----------------------------------------------------------------

	/** Fire-and-forget: runs the script of the meeting's agent if it is enabled. Never throws. */
	dispatch(type: UserscriptEventType, meetingId: number, actor: Actor, changes: MeetingChanges | null = null): void {
		try {
			const ctx = this.database.getUserscriptMeetingContext(meetingId);
			if (!ctx) return;
			const script = this.database.getAgentScript(ctx.agent.id);
			if (!script.enabled || !script.code.trim()) return;
			const args = this.buildArgs(type, ctx, actor, false, changes);
			void this.execute(ctx.agent.id, script.code, script.secrets, args)
				.then((outcome) => this.record(ctx.agent.id, "event", type, meetingId, outcome, script.secrets))
				.catch((error) => console.error("[userscript] dispatch failed:", error));
		} catch (error) {
			console.error("[userscript] dispatch failed:", error);
		}
	}

	/** Runs a draft of the code (or the saved one) on a meeting of the agent, or on a sample event. */
	async test(agentId: number, type: UserscriptEventType, code: string, meetingId: number | null): Promise<AgentScriptRun> {
		const script = this.database.getAgentScript(agentId);
		let args: Record<string, unknown>;
		if (meetingId !== null) {
			const ctx = this.database.getUserscriptMeetingContext(meetingId);
			if (!ctx || ctx.agent.id !== agentId) throw new Error("Rendez-vous introuvable.");
			const m = ctx.meeting;
			args = this.buildArgs(type, ctx, { role: "agent" }, true, type === "update-meeting" ? { room: { from: m.roomName, to: m.roomName } } : null);
		} else {
			args = this.sampleArgs(type, agentId);
		}
		const outcome = await this.execute(agentId, code, script.secrets, args);
		return this.record(agentId, "test", type, meetingId, outcome, script.secrets);
	}

	private record(agentId: number, trigger: "event" | "test", type: string, meetingId: number | null, outcome: Outcome, secrets: Record<string, string>): AgentScriptRun {
		// Secrets never end up in the stored history, even if the script logs them.
		const values = Object.values(secrets).filter((v) => v.length >= 4).sort((a, b) => b.length - a.length);
		const redact = (text: string | null) => text === null ? null : values.reduce((t, v) => t.split(v).join("***"), text);
		return this.database.addAgentScriptRun({
			agentId, trigger, eventType: type, meetingId,
			status: outcome.status, durationMs: outcome.durationMs,
			logs: outcome.logs.map((l) => redact(l) ?? ""), result: redact(outcome.result), error: redact(outcome.error),
		});
	}

	private async execute(agentId: number, code: string, secrets: Record<string, string>, args: Record<string, unknown>): Promise<Outcome> {
		const queued = this.queuedPerAgent.get(agentId) ?? 0;
		if (queued >= this.maxQueuedPerAgent) {
			return { status: "skipped", result: null, logs: [], error: "Too many executions waiting for this agent: this one was skipped.", durationMs: 0 };
		}
		this.queuedPerAgent.set(agentId, queued + 1);
		// The executions of one agent run one after the other, in the order of the events: an "update" can never
		// overtake the "new" of the same meeting (e.g. two writes to the same spreadsheet row).
		const previous = this.agentTail.get(agentId) ?? Promise.resolve();
		const run = previous.then(async () => {
			await this.acquire();
			try { return await this.spawn(code, secrets, args); }
			finally { this.release(); }
		});
		const tail = run.then(() => undefined, () => undefined);
		this.agentTail.set(agentId, tail);
		try {
			return await run;
		} finally {
			if (this.agentTail.get(agentId) === tail) this.agentTail.delete(agentId);
			const left = (this.queuedPerAgent.get(agentId) ?? 1) - 1;
			if (left <= 0) this.queuedPerAgent.delete(agentId); else this.queuedPerAgent.set(agentId, left);
		}
	}

	private acquire(): Promise<void> {
		if (this.running < this.maxConcurrent) { this.running += 1; return Promise.resolve(); }
		return new Promise((resolveSlot) => this.queue.push(() => { this.running += 1; resolveSlot(); }));
	}

	private release(): void {
		this.running -= 1;
		this.queue.shift()?.();
	}

	/** One child process per execution: nothing (memory, globals, connections) survives between two runs. */
	private spawn(code: string, secrets: Record<string, string>, args: Record<string, unknown>): Promise<Outcome> {
		const limits = this.limits;
		const started = Date.now();
		return new Promise((resolveOutcome) => {
			let settled = false;
			let child: ChildProcess;
			const finish = (outcome: Outcome) => {
				if (settled) return;
				settled = true;
				clearTimeout(killer);
				if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
				resolveOutcome(outcome);
			};
			try {
				child = fork(RUNNER, [ISOLATED_VM_BINARY], {
					// Empty environment: the runner must not see the server's variables (database path, keys...).
					env: {},
					execArgv: [
						"--no-node-snapshot", // required by isolated-vm on Node >= 20
						`--max-old-space-size=${Math.max(64, limits.memoryMb * 4)}`,
						// Node permission model: no file writes, no child process, no worker; only the runner and isolated-vm can be read.
						"--experimental-permission",
						"--allow-addons",
						"--no-warnings",
						`--allow-fs-read=${RUNNER}`,
						`--allow-fs-read=${ISOLATED_VM_BINARY}`,
					],
					stdio: ["ignore", "ignore", "pipe", "ipc"],
					serialization: "advanced",
				});
			} catch (error: any) {
				resolveOutcome({ status: "error", result: null, logs: [], error: `Cannot start the sandbox: ${error?.message ?? error}`, durationMs: 0 });
				return;
			}
			const killer = setTimeout(() => finish({
				status: "timeout", result: null, logs: [], error: `Execution exceeded the time limit (${limits.wallTimeMs} ms)`, durationMs: Date.now() - started,
			}), limits.wallTimeMs + 2000);
			let stderr = "";
			child.stderr?.on("data", (chunk) => { if (stderr.length < 4000) stderr += String(chunk); });
			child.on("message", (message: any) => {
				if (message?.type === "ready") child.send({ code, secrets, args, limits });
				else if (message?.type === "result") finish(message.outcome as Outcome);
			});
			child.on("error", (error) => finish({ status: "error", result: null, logs: [], error: `Sandbox error: ${error.message}`, durationMs: Date.now() - started }));
			child.on("exit", (exitCode, signal) => finish({
				status: "error", result: null, logs: [],
				error: `Sandbox stopped unexpectedly (${signal ?? `code ${exitCode}`})${stderr ? `: ${stderr.trim().slice(0, 1000)}` : ""}`,
				durationMs: Date.now() - started,
			}));
		});
	}
}
