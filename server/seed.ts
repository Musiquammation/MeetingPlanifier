// Test data: `npm run seed` (idempotent, can be run again at any time).
//
//  - company "Société X" with the rooms "Salle A" and "Salle B", administrator  X-admin / x
//  - agent  X / x  (active), with the mock Google Sheets userscript enabled
//  - consumers A and B, access keys AAAAAA and BBBBBB (keys are 6 characters long), assigned to X,
//    package "standard" (32 €/h), and availabilities / suggestions for the next 7 days so X can book right away
//
// Secrets belong to the agent: they are set by X in the Script menu (#agent-script), never here.
// The script needs SHEET_URL (link of the sheet) and GOOGLE_SERVICE_ACCOUNT (JSON key of a service account).
// Running the seed again keeps the secrets, but puts the example code back.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import bcrypt from "bcryptjs";
import { Database } from "./Database";

const COMPANY = "Société X";
const PASSWORD = "x";
const CONSUMERS = [
	{ username: "A", name: "Consumer", surname: "A", key: "AAAAAA" },
	{ username: "B", name: "Consumer", surname: "B", key: "BBBBBB" },
];
const SCRIPT_FILE = resolve(import.meta.dirname, "userscript", "examples", "google-sheet-meetings.js");

const database = new Database();
const hash = bcrypt.hashSync(PASSWORD, 12);
const done: string[] = [];

// ---- Company and administrator ----------------------------------------------
let company = database.getCompanyByName(COMPANY);
if (!company) {
	company = database.createAdminWithCompany({ username: "X-admin", passwordHash: hash, displayName: "Admin X", companyName: COMPANY, level: 100 }).company;
	done.push(`company "${COMPANY}" + admin X-admin / ${PASSWORD}`);
}
const companyId = company.id;

for (const room of ["Salle A", "Salle B"]) if (!database.getRoom(companyId, room)) database.createRoom(companyId, room, 2);

let pkg = database.listPackages(companyId).find((p) => p.name === "standard");
if (!pkg) pkg = database.createPackage(companyId, "standard", 32);

// ---- Agent X ---------------------------------------------------------------------
let agentId = database.getAgentCredentialsByUsername("X")?.id;
if (agentId === undefined) {
	agentId = database.createAgent({ name: "Agent", surname: "X", username: "X", passwordHash: hash, status: "active" }).id;
	done.push(`agent X / ${PASSWORD}`);
} else {
	database.setAgentPasswordHash(agentId, hash);
	database.setAgentStatus(agentId, "active");
}
let contract = database.listContractsForAgent(agentId).find((c) => c.companyId === companyId);
if (!contract) contract = database.createContract(agentId, companyId);

// ---- Consumers A and B -------------------------------------------------------------
const assignations: number[] = [];
for (const spec of CONSUMERS) {
	let consumerId = database.getConsumerCredentialsByUsername(spec.username)?.id;
	if (consumerId === undefined) consumerId = database.createConsumer({ name: spec.name, surname: spec.surname, username: spec.username, passwordHash: null }).id;
	let fidelity = database.listFidelitiesForCompany(companyId).find((f) => f.consumerId === consumerId);
	if (!fidelity) {
		fidelity = database.createFidelity(companyId, consumerId, spec.key);
		done.push(`consumer ${spec.username}, key ${spec.key}`);
	} else if (fidelity.key !== spec.key) {
		console.warn(`Consumer ${spec.username} already has the key ${fidelity.key} in ${COMPANY} (expected ${spec.key}).`);
	}
	if (fidelity.defaultPackageId !== pkg.id) database.setFidelityDefaultPackage(fidelity.id, pkg.id);
	let assignation = database.listAssignationsForAgent(agentId).find((a) => a.fidelityId === fidelity.id);
	if (!assignation) assignation = database.createAssignation(agentId, fidelity.id);
	assignations.push(assignation.id);
}

// ---- Availabilities (consumers) and suggestions (agent X): 9:00 to 17:00 UTC, next 7 days ----------
const days = Array.from({ length: 7 }, (_, i) => {
	const day = new Date();
	day.setUTCDate(day.getUTCDate() + i + 1);
	day.setUTCHours(9, 0, 0, 0);
	return day.toISOString();
});
const tryCreate = (create: () => unknown) => { try { create(); return 1; } catch { return 0; /* overlaps an existing interval */ } };
let created = 0;
for (const assignationId of assignations) {
	const requestId = database.listAvailabilityRequestsForAssignation(assignationId).find((r) => r.status !== "closed")?.id
		?? database.createAvailabilityRequest(assignationId, 20).id;
	for (const startAt of days) {
		created += tryCreate(() => database.createDisponibility({ assignationId, requestId, startAt, durationMinutes: 480, love: 1 }));
	}
}
for (const startAt of days) {
	created += tryCreate(() => database.createSuggestion({ contractId: contract.id, startAt, durationMinutes: 480, love: 1 }));
}
if (created) done.push(`${created} availability / suggestion intervals`);

// ---- Userscript of X: the mock Google Sheets script --------------------------------
database.saveAgentScript(agentId, { code: readFileSync(SCRIPT_FILE, "utf8"), enabled: true });
const missing = ["SHEET_URL", "GOOGLE_SERVICE_ACCOUNT"].filter((name) => !(name in database.getAgentScript(agentId).secrets));
done.push(`script of X: google-sheet-meetings.js (enabled)`);
if (missing.length) console.warn(`Secrets to set by X in the Script menu (#agent-script): ${missing.join(", ")}.`);

database.close();
console.log(["Seed done:", ...done.map((line) => `  - ${line}`)].join("\n"));
