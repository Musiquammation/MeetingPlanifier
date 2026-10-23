import type { Express, Request, Response, NextFunction } from "express";
import express from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";

type Role = "admin" | "agent" | "consumer";
type Session = { role: Role; id: number; companyId?: number; expiresAt: number };
type Db = Record<string, any>;

const sessions = new Map<string, Session>();
/** Hours of the implicit request created when a consumer gives availabilities without stating hours. */
const UNLIMITED_HOURS = 1000;
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

function fail(res: Response, status: number, message: string) {
  return res.status(status).json({ error: message });
}
function requiredString(value: unknown, label: string, max = 200): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
	throw new Error(`${label} est requis (maximum ${max} caractères).`);
  }
  return value.trim();
}
function positiveInt(value: unknown, label: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${label} doit être un entier positif.`);
  return n;
}
/** Optional positive integer: undefined, null and "" all mean "no value" (returned as null). */
function optionalId(value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  return positiveInt(value, label);
}
function intervalInput(body: any) {
  const startAt = requiredString(body.startAt ?? body.start_at, "startAt", 40);
  const durationMinutes = positiveInt(body.durationMinutes ?? body.duration_minutes, "durationMinutes");
  const love = body.love === undefined ? 0.5 : Number(body.love);
  if (!Number.isFinite(love) || love < 0 || love > 1) throw new Error("love doit être compris entre 0 et 1.");
  if (!Number.isFinite(Date.parse(startAt))) throw new Error("startAt doit être une date ISO valide.");
  return { startAt, durationMinutes, love };
}

/**
 * Enregistre l'ensemble des routes REST sur une application Express.
 * Le paramètre database est une instance de la classe Database documentée dans le projet.
 */
export function initApi(app: Express, database: Db): void {
  app.use(express.json({ limit: "256kb" }));

  app.get("/api/health", (_req, res) => {
	try { return res.json(database.healthCheck()); }
	catch { return fail(res, 503, "Base de données indisponible."); }
  });

  const auth = (roles?: Role[]) => (req: Request, res: Response, next: NextFunction) => {
	const token = (req.header("authorization") || "").replace(/^Bearer\s+/i, "");
	const session = sessions.get(token);
	if (!session || session.expiresAt <= Date.now()) {
	  if (token) sessions.delete(token);
	  return fail(res, 401, "Session absente ou expirée.");
	}
	if (roles && !roles.includes(session.role)) return fail(res, 403, "Droits insuffisants.");
	(req as any).session = session;
	(req as any).token = token;
	next();
  };
  const issueSession = (role: Role, id: number, companyId?: number) => {
	const token = crypto.randomBytes(32).toString("base64url");
	sessions.set(token, { role, id, companyId, expiresAt: Date.now() + SESSION_TTL_MS });
	return token;
  };
  const session = (req: Request): Session => (req as any).session;

  app.post("/api/admin/signup", (req, res) => {
	try {
	  const username = requiredString(req.body.username, "username", 80);
	  const password = requiredString(req.body.password, "password", 200);
	  const displayName = requiredString(req.body.displayName, "displayName", 120);
	  const companyName = requiredString(req.body.companyName, "companyName", 120);
	  const passwordHash = requirePasswordHash(password);
	  const result = database.createAdminWithCompany({ username, passwordHash, displayName, companyName, level: 100 });
	  const token = issueSession("admin", result.admin.id, result.company.id);
	  return res.status(201).json({ token, user: result.admin, company: result.company });
	} catch (e: any) { return fail(res, 400, e.message || "Inscription impossible."); }
  });

  app.post("/api/admin/login", (req, res) => {
	try {
	  const username = requiredString(req.body.username, "username", 80);
	  const password = requiredString(req.body.password, "password", 200);
	  const credentials = database.getAdminCredentialsByUsername(username);
	  if (!credentials || !verifyPassword(password, credentials.passwordHash ?? credentials.password_hash)) {
		return fail(res, 401, "Identifiants invalides.");
	  }
	  const company = database.getCompanyForAdmin(credentials.id);
	  const token = issueSession("admin", credentials.id, company?.id);
	  return res.json({ token, user: database.getAdminById(credentials.id), company });
	} catch { return fail(res, 401, "Identifiants invalides."); }
  });

  app.post("/api/agent/login", (req, res) => {
	try {
	  const username = requiredString(req.body.username, "username", 80);
	  const password = requiredString(req.body.password, "password", 200);
	  const credentials = database.getAgentCredentialsByUsername(username);
	  if (!credentials || !verifyPassword(password, credentials.passwordHash ?? credentials.password_hash)) {
		return fail(res, 401, "Identifiants invalides.");
	  }
	  const token = issueSession("agent", credentials.id);
	  return res.json({ token, user: database.getAgentById(credentials.id) });
	} catch { return fail(res, 401, "Identifiants invalides."); }
  });

  app.post("/api/agent/signup", (_req, res) =>
	fail(res, 403, "L'inscription agent doit être validée par un administrateur et rattachée à une société."));

  app.post("/api/consumer/access", (req, res) => {
	try {
	  const key = requiredString(req.body.key, "key", 6);
	  const fidelity = database.getFidelityByAccessKey(key);
	  if (!fidelity || fidelity.active === false) return fail(res, 401, "Clé ou mot de passe invalide.");
	  const credentials = database.getConsumerCredentialsById(fidelity.consumerId ?? fidelity.consumer_id);
	  if (!credentials) return fail(res, 401, "Clé ou mot de passe invalide.");
	  const hash = credentials.passwordHash ?? credentials.password_hash;
	  if (hash && (typeof req.body.password !== "string" || !verifyPassword(req.body.password, hash))) {
		return fail(res, 401, "Clé ou mot de passe invalide.");
	  }
	  const token = issueSession("consumer", credentials.id);
	  return res.json({ token, user: database.getConsumerById(credentials.id) });
	} catch (e: any) { return fail(res, 400, e.message || "Accès impossible."); }
  });

  app.get("/api/me", auth(), (req, res) => {
	const s = session(req);
	const user = s.role === "admin" ? database.getAdminById(s.id)
	  : s.role === "agent" ? database.getAgentById(s.id) : database.getConsumerById(s.id);
	return res.json({ role: s.role, user, companyId: s.companyId });
  });
  app.post("/api/logout", auth(), (req, res) => {
	sessions.delete((req as any).token);
	return res.json({ ok: true });
  });

  const admin = auth(["admin"]);
  const companyId = (req: Request) => {
	const id = session(req).companyId;
	if (!id) throw new Error("Aucune société associée à ce compte.");
	return id;
  };

  app.get("/api/companies", auth(), (req, res) => {
	try {
	  const s = session(req);
	  if (s.role === "admin") return res.json([database.getCompanyForAdmin(s.id)].filter(Boolean));
	  if (s.role === "agent") return res.json(database.listContractsForAgent(s.id).map((c: any) => database.getCompanyById(c.companyId ?? c.company_id)).filter(Boolean));
	  return res.json(database.listAssignedAgentsForConsumer(s.id).map((x: any) => x.company).filter(Boolean));
	} catch (e: any) { return fail(res, 400, e.message); }
  });

  app.get("/api/consumers/search", admin, (req, res) => {
	try { return res.json(database.searchConsumers(String(req.query.q || ""), Math.min(50, Number(req.query.limit) || 20))); }
	catch (e: any) { return fail(res, 400, e.message); }
  });
  app.get("/api/consumers", admin, (req, res) => {
	try { return res.json(database.listConsumersForCompany(companyId(req))); }
	catch (e: any) { return fail(res, 400, e.message); }
  });
  app.post("/api/consumers", admin, (req, res) => {
	try {
	  const name = requiredString(req.body.name, "name", 100);
	  const surname = requiredString(req.body.surname, "surname", 100);
	  const username = requiredString(req.body.username, "username", 80);
	  const consumer = database.createConsumer({ name, surname, username, passwordHash: req.body.password ? requirePasswordHash(requiredString(req.body.password, "password", 200)) : null });
	  const fidelity = database.createFidelity(companyId(req), consumer.id);
	  return res.status(201).json({ consumer, fidelity });
	} catch (e: any) { return fail(res, 400, e.message || "Création impossible."); }
  });

  app.get("/api/agents", auth(), (req, res) => {
	try {
	  const s = session(req);
	  if (s.role === "admin") return res.json(database.listAgentsForCompany(companyId(req)));
	  if (s.role === "consumer") return res.json(database.listAssignedAgentsForConsumer(s.id));
	  return res.json(database.listContractsForAgent(s.id));
	} catch (e: any) { return fail(res, 400, e.message); }
  });
  app.post("/api/agents", admin, (req, res) => {
	try {
	  const agent = database.createAgent({
		name: requiredString(req.body.name, "name", 100),
		surname: requiredString(req.body.surname, "surname", 100),
		username: requiredString(req.body.username, "username", 80),
		passwordHash: requirePasswordHash(requiredString(req.body.password, "password", 200)),
		status: "active"
	  });
	  const contract = database.createContract(agent.id, companyId(req));
	  return res.status(201).json({ agent, contract });
	} catch (e: any) { return fail(res, 400, e.message || "Création impossible."); }
  });

  app.get("/api/agents/search", admin, (req, res) => {
	try { return res.json(database.searchAgents(String(req.query.q || ""), Math.min(50, Number(req.query.limit) || 20))); }
	catch (e: any) { return fail(res, 400, e.message); }
  });
  /** Rattache un agent existant à la société de l'administrateur. */
  app.post("/api/contracts", admin, (req, res) => {
	try {
	  const agentId = positiveInt(req.body.agentId, "agentId");
	  if (!database.getAgentById(agentId)) return fail(res, 404, "Agent introuvable.");
	  const cid = companyId(req);
	  if (database.listContractsForCompany(cid).some((c: any) => c.agentId === agentId)) return fail(res, 409, "Cet agent fait déjà partie de votre société.");
	  return res.status(201).json(database.createContract(agentId, cid));
	} catch (e: any) { return fail(res, 400, e.message || "Rattachement impossible."); }
  });
  /** Retire un agent de la société (supprime son contrat et ses assignations dans cette société). */
  app.delete("/api/agents/:id", admin, (req, res) => {
	try {
	  const agentId = positiveInt(req.params.id, "id");
	  const cid = companyId(req);
	  const contract = database.listContractsForCompany(cid).find((c: any) => c.agentId === agentId);
	  if (!contract) return fail(res, 404, "Cet agent ne fait pas partie de votre société.");
	  database.withTransaction(() => {
		for (const a of database.listAssignationsForCompany(cid).filter((x: any) => x.agentId === agentId)) database.deleteAssignation(a.id);
		database.deleteContract(contract.id);
	  });
	  return res.json({ ok: true });
	} catch (e: any) { return fail(res, 400, /FOREIGN KEY|constraint/i.test(e.message) ? "Impossible : cet agent a des rendez-vous liés à ses assignations." : e.message || "Suppression impossible."); }
  });

  /** Inscrit un consommateur existant à la société (crée une fidélité et sa clé d'accès). */
  app.post("/api/fidelities", admin, (req, res) => {
	try {
	  const consumerId = positiveInt(req.body.consumerId, "consumerId");
	  if (!database.getConsumerById(consumerId)) return fail(res, 404, "Consommateur introuvable.");
	  const cid = companyId(req);
	  if (database.listFidelitiesForCompany(cid).some((f: any) => f.consumerId === consumerId)) return fail(res, 409, "Ce consommateur est déjà inscrit à votre société.");
	  return res.status(201).json(database.createFidelity(cid, consumerId));
	} catch (e: any) { return fail(res, 400, e.message || "Inscription impossible."); }
  });

  app.get("/api/assignations", admin, (req, res) => {
	try { return res.json(database.listAssignationsForCompany(companyId(req))); }
	catch (e: any) { return fail(res, 400, e.message); }
  });
  app.post("/api/assignations", admin, (req, res) => {
	try {
	  const agentId = positiveInt(req.body.agentId, "agentId");
	  const fidelityId = positiveInt(req.body.fidelityId, "fidelityId");
	  const cid = companyId(req);
	  if (!database.listContractsForCompany(cid).some((c: any) => c.agentId === agentId)) return fail(res, 400, "Cet agent ne fait pas partie de votre société.");
	  if (database.getFidelityById(fidelityId)?.companyId !== cid) return fail(res, 400, "Ce consommateur n'est pas inscrit à votre société.");
	  if (database.listAssignationsForCompany(cid).some((a: any) => a.agentId === agentId && a.fidelityId === fidelityId)) return fail(res, 409, "Cet agent est déjà assigné à ce consommateur.");
	  return res.status(201).json(database.createAssignation(agentId, fidelityId));
	} catch (e: any) { return fail(res, 400, e.message || "Assignation impossible."); }
  });
  app.delete("/api/assignations/:id", admin, (req, res) => {
	try {
	  const id = positiveInt(req.params.id, "id");
	  if (!database.listAssignationsForCompany(companyId(req)).some((a: any) => a.id === id)) return fail(res, 404, "Assignation introuvable.");
	  database.deleteAssignation(id);
	  return res.json({ ok: true });
	} catch (e: any) { return fail(res, 400, /FOREIGN KEY|constraint/i.test(e.message) ? "Impossible : cette assignation a des rendez-vous." : e.message || "Suppression impossible."); }
  });

  /** Chooses the package (hourly rate) of an agent/consumer pair; packageId null = use the consumer's default package. */
  app.patch("/api/assignations/:id", admin, (req, res) => {
	try {
	  const id = positiveInt(req.params.id, "id");
	  if (!database.listAssignationsForCompany(companyId(req)).some((a: any) => a.id === id)) return fail(res, 404, "Assignation introuvable.");
	  return res.json(database.setAssignationPackage(id, optionalId(req.body.packageId, "packageId")));
	} catch (e: any) { return fail(res, 400, e.message || "Modification impossible."); }
  });

  /** Sets the default package (formule par défaut) of a consumer in the admin's company; null = not defined (price 0). */
  app.patch("/api/fidelities/:id", admin, (req, res) => {
	try {
	  const id = positiveInt(req.params.id, "id");
	  if (database.getFidelityById(id)?.companyId !== companyId(req)) return fail(res, 404, "Consommateur introuvable dans votre société.");
	  return res.json(database.setFidelityDefaultPackage(id, optionalId(req.body.defaultPackageId, "defaultPackageId")));
	} catch (e: any) { return fail(res, 400, e.message || "Modification impossible."); }
  });

  app.get("/api/packages", admin, (req, res) => {
	try { return res.json(database.listPackages(companyId(req))); }
	catch (e: any) { return fail(res, 400, e.message); }
  });
  app.post("/api/packages", admin, (req, res) => {
	try {
	  const name = requiredString(req.body.name, "name", 120);
	  const hourlyRate = Number(req.body.hourlyRate);
	  if (!Number.isFinite(hourlyRate) || hourlyRate < 0) return fail(res, 400, "Le prix horaire doit être un nombre supérieur ou égal à 0.");
	  return res.status(201).json(database.createPackage(companyId(req), name, hourlyRate));
	} catch (e: any) { return fail(res, 400, /UNIQUE/i.test(e.message) ? "Une formule porte déjà ce nom." : e.message || "Création impossible."); }
  });
  app.delete("/api/packages/:id", admin, (req, res) => {
	try {
	  const id = positiveInt(req.params.id, "id");
	  if (database.getPackageById(id)?.companyId !== companyId(req)) return fail(res, 404, "Formule introuvable.");
	  database.deletePackage(id);
	  return res.json({ ok: true });
	} catch (e: any) { return fail(res, 400, /FOREIGN KEY|constraint/i.test(e.message) ? "Impossible : cette formule est encore utilisée." : e.message || "Suppression impossible."); }
  });

  app.get("/api/my-consumers", auth(["agent"]), (req, res) => {
	try { return res.json(database.listAssignationDetailsForAgent(session(req).id)); }
	catch (e: any) { return fail(res, 400, e.message); }
  });

  app.get("/api/rooms", auth(), (req, res) => {
	try {
	  const s = session(req);
	  const cid = s.role === "admin" ? companyId(req)
		: s.role === "agent" ? (database.listContractsForAgent(s.id)[0]?.companyId ?? database.listContractsForAgent(s.id)[0]?.company_id)
		: undefined;
	  if (!cid) return res.json([]);
	  return res.json(database.listRooms(cid));
	} catch (e: any) { return fail(res, 400, e.message); }
  });
  app.post("/api/rooms", admin, (req, res) => {
	try {
	  const name = requiredString(req.body.name, "name", 100);
	  const limit = Number(req.body.limit);
	  if (!Number.isInteger(limit) || (limit !== -1 && limit < 1)) return fail(res, 400, "limit doit valoir -1 ou un entier positif.");
	  return res.status(201).json(database.createRoom(companyId(req), name, limit));
	} catch (e: any) { return fail(res, 400, e.message); }
  });
  /** Saves every room at once, in one transaction: rooms[] is in display order, each with its current name, optional newName and limit. */
  app.put("/api/rooms", admin, (req, res) => {
	try {
	  if (!Array.isArray(req.body.rooms)) return fail(res, 400, "La liste des salles est requise.");
	  const items = req.body.rooms.map((r: any) => {
		const limit = Number(r?.limit);
		if (!Number.isInteger(limit) || (limit !== -1 && limit < 1)) throw new Error("limit doit valoir -1 ou un entier positif.");
		return {
		  name: requiredString(r?.name, "name", 100),
		  newName: r?.newName === undefined || r.newName === null ? undefined : requiredString(r.newName, "newName", 100),
		  limit
		};
	  });
	  return res.json(database.saveRooms(companyId(req), items));
	} catch (e: any) { return fail(res, 400, /UNIQUE|PRIMARY KEY/i.test(e.message) ? "Deux salles ne peuvent pas porter le même nom." : e.message); }
  });
  /** Gives a room to the pending meetings without one on a period (see Database.autoAssignRooms for the rules). */
  app.post("/api/rooms/auto-assign", admin, (req, res) => {
	try {
	  const from = requiredString(req.body.from, "from", 40);
	  const to = requiredString(req.body.to, "to", 40);
	  if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || Date.parse(from) >= Date.parse(to)) return fail(res, 400, "Plage de dates invalide.");
	  return res.json(database.autoAssignRooms(companyId(req), from, to));
	} catch (e: any) { return fail(res, 400, e.message || "Attribution impossible."); }
  });
  app.patch("/api/rooms/:name", admin, (req, res) => {
	try {
	  const oldName = decodeURIComponent(req.params.name as string);
	  if (req.body.newName) return res.json(database.renameRoom(companyId(req), oldName, requiredString(req.body.newName, "newName", 100)));
	  const limit = Number(req.body.limit);
	  if (!Number.isInteger(limit) || (limit !== -1 && limit < 1)) return fail(res, 400, "limit doit valoir -1 ou un entier positif.");
	  return res.json(database.updateRoomLimit(companyId(req), oldName, limit));
	} catch (e: any) { return fail(res, 400, e.message); }
  });
  app.delete("/api/rooms/:name", admin, (req, res) => {
	try { database.setRoomActive(companyId(req), decodeURIComponent(req.params.name as string), false); return res.json({ ok: true }); }
	catch (e: any) { return fail(res, 400, e.message); }
  });

  app.get("/api/agenda", auth(), (req, res) => {
	try {
	  const from = requiredString(req.query.from, "from", 40);
	  const to = requiredString(req.query.to, "to", 40);
	  if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || Date.parse(from) >= Date.parse(to)) return fail(res, 400, "Plage de dates invalide.");
	  database.cleanExpiredIntervals?.();
	  const s = session(req);
	  if (s.role === "consumer") {
		const agents = database.listAssignedAgentsForConsumer(s.id);
		const assignations = database.listAssignationsForConsumer(s.id);
		return res.json({
		  agents,
		  requests: assignations.flatMap((a: any) => database.listAvailabilityRequestsForAssignation(a.id)),
		  slots: database.listCompatibleSlotsForConsumer(s.id, from, to),
		  // The agent's opening hours, whatever the consumer's own availabilities are
		  agentSlots: database.listAgentSuggestionsForConsumer(s.id, from, to),
		  meetings: assignations.flatMap((a: any) => database.listMeetingsForAssignation(a.id, from, to))
		});
	  }
	  if (s.role === "agent") {
		const contracts = database.listContractsForAgent(s.id);
		const assignations = database.listAssignationDetailsForAgent(s.id);
		return res.json({
		  contracts, assignations,
		  suggestions: contracts.flatMap((c: any) => database.listSuggestionsForContract(c.id, from, to)),
		  meetings: assignations.flatMap((a: any) => database.listMeetingsForAssignation(a.id, from, to))
		});
	  }
	  return res.json({ meetings: database.listMeetingsForCompany(companyId(req), from, to), agents: database.listAgentsForCompany(companyId(req)) });
	} catch (e: any) { return fail(res, 400, e.message || "Agenda indisponible."); }
  });

  app.post("/api/availability-requests", auth(["consumer"]), (req, res) => {
	try {
	  const assignationId = positiveInt(req.body.assignationId, "assignationId");
	  const hours = Number(req.body.requestedHours);
	  if (!Number.isFinite(hours) || hours <= 0 || hours > 1000) return fail(res, 400, "requestedHours doit être supérieur à 0.");
	  const owned = database.listAssignationsForConsumer(session(req).id).some((a: any) => a.id === assignationId);
	  if (!owned) return fail(res, 403, "Assignation inaccessible.");
	  return res.status(201).json(database.createAvailabilityRequest(assignationId, hours));
	} catch (e: any) { return fail(res, 400, e.message); }
  });
  app.get("/api/disponibilities", auth(), (req, res) => {
	try {
	  const s = session(req);
	  if (s.role === "consumer") {
		const assignationId = positiveInt(req.query.assignationId, "assignationId");
		if (!database.listAssignationsForConsumer(s.id).some((a: any) => a.id === assignationId)) return fail(res, 403, "Assignation inaccessible.");
		return res.json(database.listDisponibilitiesForAssignation(assignationId, req.query.from as string, req.query.to as string));
	  }
	  if (s.role === "agent") return res.json(database.listAssignationsForAgent(s.id).flatMap((a: any) => database.listDisponibilitiesForAssignation(a.id, req.query.from as string, req.query.to as string)));
	  return fail(res, 403, "Cette ressource n'est pas disponible pour ce rôle.");
	} catch (e: any) { return fail(res, 400, e.message); }
  });
  app.post("/api/disponibilities", auth(["consumer"]), (req, res) => {
	try {
	  const assignationId = positiveInt(req.body.assignationId, "assignationId");
	  if (!database.listAssignationsForConsumer(session(req).id).some((a: any) => a.id === assignationId)) return fail(res, 403, "Assignation inaccessible.");
	  // The number of hours is optional: without a request, an "unlimited" one is created once and reused.
	  let requestId: number;
	  if (req.body.requestId === undefined || req.body.requestId === null || req.body.requestId === "") {
		const open = database.listAvailabilityRequestsForAssignation(assignationId).find((r: any) => r.status === "open");
		requestId = open ? open.id : database.createAvailabilityRequest(assignationId, UNLIMITED_HOURS).id;
	  } else {
		requestId = positiveInt(req.body.requestId, "requestId");
		const request = database.getAvailabilityRequestProgress(requestId);
		if (!request || Number(request.assignationId ?? request.assignation_id) !== assignationId) return fail(res, 403, "Demande inaccessible.");
	  }
	  return res.status(201).json(database.createDisponibility({ assignationId, requestId, ...intervalInput(req.body) }));
	} catch (e: any) { return fail(res, 400, e.message); }
  });
  app.patch("/api/disponibilities/:id", auth(["consumer"]), (req, res) => {
	try {
	  const id = positiveInt(req.params.id, "id");
	  const owned = database.listAssignationsForConsumer(session(req).id).some((a: any) => database.listDisponibilitiesForAssignation(a.id).some((d: any) => d.id === id));
	  if (!owned) return fail(res, 404, "Disponibilité introuvable.");
	  return res.json(database.updateDisponibility(id, intervalInput(req.body)));
	} catch (e: any) { return fail(res, 400, e.message); }
  });
  app.delete("/api/disponibilities/:id", auth(["consumer"]), (req, res) => {
	try {
	  const id = positiveInt(req.params.id, "id");
	  const owned = database.listAssignationsForConsumer(session(req).id).some((a: any) => database.listDisponibilitiesForAssignation(a.id).some((d: any) => d.id === id));
	  if (!owned) return fail(res, 404, "Disponibilité introuvable.");
	  database.deleteDisponibility(id); return res.json({ ok: true });
	} catch (e: any) { return fail(res, 400, e.message); }
  });

  app.get("/api/suggestions", auth(["agent"]), (req, res) => {
	try {
	  const contracts = database.listContractsForAgent(session(req).id);
	  return res.json(contracts.flatMap((c: any) => database.listSuggestionsForContract(c.id, req.query.from as string, req.query.to as string)));
	} catch (e: any) { return fail(res, 400, e.message); }
  });
  app.post("/api/suggestions", auth(["agent"]), (req, res) => {
	try {
	  const contractId = positiveInt(req.body.contractId, "contractId");
	  if (!database.listContractsForAgent(session(req).id).some((c: any) => c.id === contractId)) return fail(res, 403, "Contrat inaccessible.");
	  return res.status(201).json(database.createSuggestion({ contractId, ...intervalInput(req.body) }));
	} catch (e: any) { return fail(res, 400, e.message); }
  });
  app.patch("/api/suggestions/:id", auth(["agent"]), (req, res) => {
	try {
	  const id = positiveInt(req.params.id, "id");
	  const owned = database.listContractsForAgent(session(req).id).some((c: any) => database.listSuggestionsForContract(c.id).some((x: any) => x.id === id));
	  if (!owned) return fail(res, 404, "Suggestion introuvable.");
	  return res.json(database.updateSuggestion(id, intervalInput(req.body)));
	} catch (e: any) { return fail(res, 400, e.message); }
  });
  app.delete("/api/suggestions/:id", auth(["agent"]), (req, res) => {
	try {
	  const id = positiveInt(req.params.id, "id");
	  const owned = database.listContractsForAgent(session(req).id).some((c: any) => database.listSuggestionsForContract(c.id).some((x: any) => x.id === id));
	  if (!owned) return fail(res, 404, "Suggestion introuvable.");
	  database.deleteSuggestion(id); return res.json({ ok: true });
	} catch (e: any) { return fail(res, 400, e.message); }
  });

  app.get("/api/rooms/availability", auth(["admin", "agent"]), (req, res) => {
	try {
	  const startAt = requiredString(req.query.startAt, "startAt", 40);
	  const duration = positiveInt(req.query.durationMinutes, "durationMinutes");
	  const s = session(req);
	  const cid = s.role === "admin" ? companyId(req) : (database.listContractsForAgent(s.id)[0]?.companyId ?? database.listContractsForAgent(s.id)[0]?.company_id);
	  if (!cid) return res.json([]);
	  return res.json(database.getRoomsAvailability(cid, startAt, duration));
	} catch (e: any) { return fail(res, 400, e.message); }
  });

	app.post("/api/meetings/from-availability", auth(["agent"]), (req, res) => {
		try {
			const assignationId = positiveInt(req.body.assignationId, "assignationId");
			const startAt = requiredString(req.body.startAt, "startAt", 40);

			let durationMinutes: number;
			try {
				durationMinutes = positiveInt(req.body.durationMinutes, "durationMinutes");
			} catch (e: any) {
				return fail(res, 400, e.message || "Durée invalide.");
			}

			if (!Number.isFinite(Date.parse(startAt))) {
				return fail(res, 400, "Date de début invalide.");
			}

			const owned = database.listAssignationsForAgent(session(req).id)
				.some((a: any) => a.id === assignationId);

			if (!owned) return fail(res, 403, "Assignation inaccessible.");


			// Locate the consumer availability and the agent suggestion that contain the requested interval.
			const t0 = Date.parse(startAt);
			const t1 = t0 + durationMinutes * 60000;
			const within = (x: any) => Date.parse(x.startAt) <= t0 && Date.parse(x.startAt) + x.durationMinutes * 60000 >= t1;
			const assignation = database.getAssignationById(assignationId);
			const fidelity = assignation ? database.getFidelityById(assignation.fidelityId) : null;
			const dispo = database.listDisponibilitiesForAssignation(assignationId).find(within);
			if (!assignation || !fidelity || !dispo) return fail(res, 409, "Ce créneau n'est plus dans une disponibilité du consommateur.");
			const contract = database.listContractsForAgent(session(req).id).find((c: any) => c.companyId === fidelity.companyId);
			const suggestion = contract ? database.listSuggestionsForContract(contract.id).find(within) : undefined;
			if (!suggestion) return fail(res, 409, "Ce créneau n'est pas dans vos horaires.");

			const result = database.createMeetingFromAvailability({
				assignationId,
				requestId: dispo.requestId,
				disponibilityId: dispo.id,
				suggestionId: suggestion.id,
				startAt,
				durationMinutes,
				roomName: req.body.roomName == null || req.body.roomName === ""
					? null
					: requiredString(req.body.roomName, "roomName", 100),
				comment: typeof req.body.comment === "string"
					? req.body.comment.slice(0, 2000)
					: "",
				idempotencyKey: typeof req.body.idempotencyKey === "string"
					? req.body.idempotencyKey.slice(0, 100)
					: undefined
			});

			return res.status(201).json(result);
		} catch (e: any) {
			return fail(res, 409, e.message || "Créneau non réservable.");
		}
	});
	
  app.patch("/api/meetings/:id", auth(["agent", "admin"]), (req, res) => {
	try {
	  const id = positiveInt(req.params.id, "id");
	  let meeting = database.getMeetingById(id);
	  if (!meeting) return fail(res, 404, "Réunion introuvable.");
	  const s = session(req);
	  if (s.role === "agent" && !database.listAssignationsForAgent(s.id).some((a: any) => a.id === (meeting.assignationId ?? meeting.assignation_id))) return fail(res, 403, "Réunion inaccessible.");
	  if (req.body.comment !== undefined) meeting = database.updateMeetingComment(id, String(req.body.comment).slice(0, 2000));
	  if (req.body.roomName !== undefined) meeting = database.setMeetingRoom(id, req.body.roomName === null || req.body.roomName === "" ? null : requiredString(req.body.roomName, "roomName", 100));
	  if (req.body.status === "done") meeting = database.markMeetingDone(id);
	  else if (req.body.status !== undefined) return fail(res, 400, "Statut non autorisé.");
	  return res.json(meeting);
	} catch (e: any) { return fail(res, 400, e.message); }
  });
  app.post("/api/meetings/:id/cancel", auth(["agent", "admin", "consumer"]), (req, res) => {
	try {
	  const id = positiveInt(req.params.id, "id");
	  const meeting = database.getMeetingById(id);
	  if (!meeting) return fail(res, 404, "Réunion introuvable.");
	  const s = session(req);
	  if (s.role === "agent" && !database.listAssignationsForAgent(s.id).some((a: any) => a.id === (meeting.assignationId ?? meeting.assignation_id))) return fail(res, 403, "Réunion inaccessible.");
	  if (s.role === "consumer" && !database.listAssignationsForConsumer(s.id).some((a: any) => a.id === (meeting.assignationId ?? meeting.assignation_id))) return fail(res, 403, "Réunion inaccessible.");
	  return res.json(database.cancelMeeting(id, s.role, s.id));
	} catch (e: any) { return fail(res, 400, e.message); }
  });
}

function requirePasswordHash(password: string): string {
  return bcrypt.hashSync(password, 12);
}
function verifyPassword(password: string, hash: string): boolean {
  try { return bcrypt.compareSync(password, hash); } catch { return false; }
}
