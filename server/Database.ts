import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { randomInt } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export type MeetingStatus = "pending" | "done" | "canceledBy";
export type AgentStatus = "pending" | "active" | "disabled";
export type AvailabilityRequestStatus = "open" | "fulfilled" | "closed";
export type Role = "admin" | "agent" | "consumer";

export interface Company {
  id: number;
  name: string;
  /**
   * Percentage the company takes on top of what the agent receives (default 28).
   * A price of 32 EUR with a rate of 28 gives 25 EUR to the agent and 7 EUR to the company (32 = 25 * 1.28).
   */
  societyRate: number;
  createdAt: string;
  updatedAt: string;
}

export interface Admin {
  id: number;
  username: string;
  displayName: string;
  createdAt: string;
}

export interface AdminCredentials extends Admin {
  passwordHash: string;
}

export interface Privilege {
  id: number;
  adminId: number;
  companyId: number;
  level: number;
}

export interface Agent {
  id: number;
  name: string;
  surname: string;
  username: string;
  status: AgentStatus;
  createdAt: string;
}

export interface AgentCredentials extends Agent {
  passwordHash: string | null;
}

export interface Consumer {
  id: number;
  name: string;
  surname: string;
  username: string;
  createdAt: string;
}

export interface ConsumerCredentials extends Consumer {
  personalKey: string;
  passwordHash: string | null;
}

export interface Fidelity {
  id: number;
  key: string;
  companyId: number;
  consumerId: number;
  active: boolean;
  /** Default package (hourly-rate formula) of the consumer in this company; null = not defined, price is 0. */
  defaultPackageId: number | null;
  createdAt: string;
}

/** A package is a named hourly rate that an admin can attach to consumers and assignations. */
export interface Package {
  id: number;
  companyId: number;
  name: string;
  hourlyRate: number;
  createdAt: string;
}

export interface Contract {
  id: number;
  agentId: number;
  companyId: number;
  createdAt: string;
}

export interface Assignation {
  id: number;
  agentId: number;
  fidelityId: number;
  /** Package chosen for this agent/consumer pair; null = use the consumer's default package. */
  packageId: number | null;
  createdAt: string;
}

export interface Room {
  companyId: number;
  name: string;
  limit: number;
  active: boolean;
  /** Display order chosen by the admin (also the preference order of the automatic room assignment). */
  position: number;
  createdAt: string;
  updatedAt: string;
}

/** Result of the automatic room assignment over a period. */
export interface AutoAssignRoomsResult {
  assigned: Array<{ meetingId: number; roomName: string }>;
  /** Meetings for which no allowed room had enough capacity. */
  unassigned: number[];
}

export interface AvailabilityRequest {
  id: number;
  assignationId: number;
  requestedMinutes: number;
  status: AvailabilityRequestStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AvailabilityRequestProgress extends AvailabilityRequest {
  scheduledMinutes: number;
  remainingMinutes: number;
}

export interface Disponibility {
  id: number;
  assignationId: number;
  requestId: number;
  startAt: string;
  durationMinutes: number;
  love: number;
  createdAt: string;
  updatedAt: string;
}

export interface Suggestion {
  id: number;
  contractId: number;
  startAt: string;
  durationMinutes: number;
  love: number;
  createdAt: string;
  updatedAt: string;
}

export interface Meeting {
  id: number;
  assignationId: number;
  availabilityRequestId: number | null;
  sourceContractId: number | null;
  sourceDisponibilityLove: number | null;
  sourceSuggestionLove: number | null;
  startAt: string;
  durationMinutes: number;
  status: MeetingStatus;
  roomCompanyId: number | null;
  roomName: string | null;
  /** Hourly rate applied to this meeting (snapshot of the package resolved at creation). */
  hourlyRate: number;
  /** Society rate (percent) applied to this meeting; follows the company while the meeting is pending. */
  societyRate: number;
  /** Hourly amount received by the agent: hourlyRate / (1 + societyRate / 100). Derived, never stored. */
  agentHourlyRate: number;
  /** Hourly amount kept by the company: hourlyRate - agentHourlyRate. Derived, never stored. */
  societyHourlyRate: number;
  comment: string;
  canceledByRole: Role | null;
  canceledById: number | null;
  idempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoomAvailability extends Room {
  peakOccupancy: number;
  remainingCapacity: number | null;
  available: boolean;
}

export interface CompatibleSlot {
  assignationId: number;
  requestId: number;
  disponibilityId: number;
  suggestionId: number;
  agentId: number;
  agentName: string;
  startAt: string;
  durationMinutes: number;
  disponibilityLove: number;
  suggestionLove: number;
}

export interface CreateConsumerInput {
  name: string;
  surname: string;
  username: string;
  passwordHash?: string | null;
}

export interface CreateAgentInput {
  name: string;
  surname: string;
  username: string;
  passwordHash?: string | null;
  status?: AgentStatus;
}

export interface CreateDisponibilityInput {
  assignationId: number;
  requestId: number;
  startAt: string | Date;
  durationMinutes: number;
  love: number;
}

export interface CreateSuggestionInput {
  contractId: number;
  startAt: string | Date;
  durationMinutes: number;
  love: number;
}

export interface CreateMeetingFromAvailabilityInput {
  assignationId: number;
  requestId: number;
  disponibilityId: number;
  suggestionId: number;
  startAt: string | Date;
  durationMinutes: number;
  roomName?: string | null;
  comment?: string;
  idempotencyKey?: string;
  now?: string | Date;
}

export interface MeetingCreationResult {
  meeting: Meeting;
  alreadyExisted: boolean;
}

export interface CleanupResult {
  deletedDisponibilities: number;
  trimmedDisponibilities: number;
  deletedSuggestions: number;
  trimmedSuggestions: number;
}

interface RawRow {
  [key: string]: string | number | bigint | null | Uint8Array | undefined;
}

const KEY_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!?";
const KEY_LENGTH = 6;
const LOVE_MIN = 0;
const LOVE_MAX = 1;
const MAX_INTERVAL_MINUTES = 60 * 24 * 31;
/** Default percentage taken by the company on the agent (see Company.societyRate). */
export const DEFAULT_SOCIETY_RATE = 28;
const MAX_SOCIETY_RATE = 1000;
/** Two preferences closer than this are considered equal when merging intervals. */
const LOVE_EPSILON = 1e-9;

/* All schema definitions, SQL statements, and database transactions live in this class. */
export class Database {
  private static readonly SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(name)) BETWEEN 1 AND 120),
  society_rate REAL NOT NULL DEFAULT 28 CHECK (society_rate >= 0 AND society_rate <= 1000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(username)) BETWEEN 1 AND 120),
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 160),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS privileges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL UNIQUE,
  company_id INTEGER NOT NULL,
  level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 0),
  UNIQUE (admin_id, company_id),
  FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_privileges_company ON privileges(company_id);

CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  surname TEXT NOT NULL CHECK (length(trim(surname)) BETWEEN 1 AND 120),
  username TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(username)) BETWEEN 1 AND 120),
  password_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS consumers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE CHECK (length(key) = 6),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  surname TEXT NOT NULL CHECK (length(trim(surname)) BETWEEN 1 AND 120),
  username TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(username)) BETWEEN 1 AND 120),
  password_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(name)) BETWEEN 1 AND 120),
  hourly_rate REAL NOT NULL DEFAULT 0 CHECK (hourly_rate >= 0),
  created_at TEXT NOT NULL,
  UNIQUE (company_id, name),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_packages_company ON packages(company_id);

CREATE TABLE IF NOT EXISTS fidelities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE CHECK (length(key) = 6),
  company_id INTEGER NOT NULL,
  consumer_id INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  default_package_id INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE (company_id, consumer_id),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  FOREIGN KEY (consumer_id) REFERENCES consumers(id) ON DELETE RESTRICT,
  FOREIGN KEY (default_package_id) REFERENCES packages(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_fidelities_consumer ON fidelities(consumer_id);
CREATE INDEX IF NOT EXISTS idx_fidelities_company ON fidelities(company_id, active);

CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL,
  company_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (agent_id, company_id),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_contracts_company ON contracts(company_id);
CREATE INDEX IF NOT EXISTS idx_contracts_agent ON contracts(agent_id);

CREATE TRIGGER IF NOT EXISTS trg_contract_prevent_assigned_delete
BEFORE DELETE ON contracts
WHEN EXISTS (
  SELECT 1 FROM assignations a
  JOIN fidelities f ON f.id = a.fidelity_id
  WHERE a.agent_id = OLD.agent_id AND f.company_id = OLD.company_id
)
BEGIN
  SELECT RAISE(ABORT, 'Cannot remove a contract while the agent is assigned to consumers in that company');
END;

CREATE TABLE IF NOT EXISTS assignations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL,
  fidelity_id INTEGER NOT NULL,
  package_id INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE (agent_id, fidelity_id),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE RESTRICT,
  FOREIGN KEY (fidelity_id) REFERENCES fidelities(id) ON DELETE RESTRICT,
  FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_assignations_agent ON assignations(agent_id);
CREATE INDEX IF NOT EXISTS idx_assignations_fidelity ON assignations(fidelity_id);

CREATE TABLE IF NOT EXISTS rooms (
  company_id INTEGER NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(name)) BETWEEN 1 AND 120),
  limit_count INTEGER NOT NULL CHECK (limit_count = -1 OR limit_count > 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (company_id, name),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_rooms_company_active ON rooms(company_id, active);

CREATE TABLE IF NOT EXISTS availability_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignation_id INTEGER NOT NULL,
  requested_minutes INTEGER NOT NULL CHECK (requested_minutes > 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fulfilled', 'closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (assignation_id) REFERENCES assignations(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_requests_assignation_status ON availability_requests(assignation_id, status);

CREATE TABLE IF NOT EXISTS disponibilities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignation_id INTEGER NOT NULL,
  request_id INTEGER NOT NULL,
  start_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0 AND duration_minutes <= 44640),
  love REAL NOT NULL CHECK (love >= 0 AND love <= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (assignation_id) REFERENCES assignations(id) ON DELETE RESTRICT,
  FOREIGN KEY (request_id) REFERENCES availability_requests(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_disponibilities_assignation_start ON disponibilities(assignation_id, start_at);
CREATE INDEX IF NOT EXISTS idx_disponibilities_request_start ON disponibilities(request_id, start_at);

CREATE TABLE IF NOT EXISTS suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id INTEGER NOT NULL,
  start_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0 AND duration_minutes <= 44640),
  love REAL NOT NULL CHECK (love >= 0 AND love <= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_suggestions_contract_start ON suggestions(contract_id, start_at);

CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignation_id INTEGER NOT NULL,
  availability_request_id INTEGER,
  source_contract_id INTEGER,
  source_disponibility_love REAL CHECK (source_disponibility_love BETWEEN 0 AND 1),
  source_suggestion_love REAL CHECK (source_suggestion_love BETWEEN 0 AND 1),
  start_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0 AND duration_minutes <= 44640),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'canceledBy')),
  room_company_id INTEGER,
  room_name TEXT,
  comment TEXT NOT NULL DEFAULT '' CHECK (length(comment) <= 4000),
  hourly_rate REAL NOT NULL DEFAULT 0 CHECK (hourly_rate >= 0),
  society_rate REAL NOT NULL DEFAULT 28 CHECK (society_rate >= 0 AND society_rate <= 1000),
  canceled_by_role TEXT CHECK (canceled_by_role IS NULL OR canceled_by_role IN ('admin', 'agent', 'consumer')),
  canceled_by_id INTEGER,
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((room_company_id IS NULL AND room_name IS NULL) OR (room_company_id IS NOT NULL AND room_name IS NOT NULL)),
  FOREIGN KEY (assignation_id) REFERENCES assignations(id) ON DELETE RESTRICT,
  FOREIGN KEY (availability_request_id) REFERENCES availability_requests(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_contract_id) REFERENCES contracts(id) ON DELETE RESTRICT,
  FOREIGN KEY (room_company_id, room_name) REFERENCES rooms(company_id, name) ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_meetings_assignation_start ON meetings(assignation_id, start_at);
CREATE INDEX IF NOT EXISTS idx_meetings_request_status ON meetings(availability_request_id, status);
CREATE INDEX IF NOT EXISTS idx_meetings_room_start ON meetings(room_company_id, room_name, start_at, status);
CREATE INDEX IF NOT EXISTS idx_meetings_status_start ON meetings(status, start_at);

CREATE TRIGGER IF NOT EXISTS trg_assignation_company_match_insert
BEFORE INSERT ON assignations
BEGIN
  SELECT CASE WHEN NOT EXISTS (
  SELECT 1
  FROM fidelities f
  JOIN contracts c ON c.agent_id = NEW.agent_id AND c.company_id = f.company_id
  WHERE f.id = NEW.fidelity_id
  ) THEN RAISE(ABORT, 'Agent must have a contract with the fidelity company') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_assignation_company_match_update
BEFORE UPDATE OF agent_id, fidelity_id ON assignations
BEGIN
  SELECT CASE WHEN NOT EXISTS (
  SELECT 1
  FROM fidelities f
  JOIN contracts c ON c.agent_id = NEW.agent_id AND c.company_id = f.company_id
  WHERE f.id = NEW.fidelity_id
  ) THEN RAISE(ABORT, 'Agent must have a contract with the fidelity company') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_request_assignation_match_insert
BEFORE INSERT ON availability_requests
BEGIN
  SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM assignations a WHERE a.id = NEW.assignation_id
  ) THEN RAISE(ABORT, 'Unknown assignation') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_disponibility_request_match_insert
BEFORE INSERT ON disponibilities
BEGIN
  SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM availability_requests r
  WHERE r.id = NEW.request_id AND r.assignation_id = NEW.assignation_id
  ) THEN RAISE(ABORT, 'Disponibility request and assignation do not match') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_disponibility_request_match_update
BEFORE UPDATE OF request_id, assignation_id ON disponibilities
BEGIN
  SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM availability_requests r
  WHERE r.id = NEW.request_id AND r.assignation_id = NEW.assignation_id
  ) THEN RAISE(ABORT, 'Disponibility request and assignation do not match') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_meeting_relation_match_insert
BEFORE INSERT ON meetings
BEGIN
  SELECT CASE WHEN NEW.availability_request_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM availability_requests r
  WHERE r.id = NEW.availability_request_id AND r.assignation_id = NEW.assignation_id
  ) THEN RAISE(ABORT, 'Meeting request and assignation do not match') END;
  SELECT CASE WHEN NEW.room_company_id IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM assignations a
  JOIN fidelities f ON f.id = a.fidelity_id
  WHERE a.id = NEW.assignation_id AND f.company_id = NEW.room_company_id
  ) THEN RAISE(ABORT, 'Meeting room must belong to the assignation company') END;
  SELECT CASE WHEN NEW.source_contract_id IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM assignations a
  JOIN fidelities f ON f.id = a.fidelity_id
  JOIN contracts c ON c.id = NEW.source_contract_id
  WHERE a.id = NEW.assignation_id AND a.agent_id = c.agent_id AND f.company_id = c.company_id
  ) THEN RAISE(ABORT, 'Meeting source contract does not match the assignation') END;
END;
`;

  private readonly connection: DatabaseSync;
  private readonly databasePath: string;
  private closed = false;
  private transactionDepth = 0;

  constructor(databasePath = resolve(process.cwd(), "dist", "database.sqlite")) {
  this.databasePath = databasePath;
  if (databasePath !== ":memory:" && !databasePath.startsWith("file:")) {
    const fullPath = isAbsolute(databasePath) ? databasePath : resolve(process.cwd(), databasePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    this.databasePath = fullPath;
  }
  this.connection = new DatabaseSync(this.databasePath);
  this.connection.exec("PRAGMA foreign_keys = ON;");
  this.connection.exec("PRAGMA busy_timeout = 5000;");
  this.initialize();
  }

  /** Create all tables and indexes without destroying an existing database. */
  initialize(): void {
  this.ensureOpen();
  this.connection.exec(Database.SCHEMA_SQL);
  this.migrate();
  this.connection.exec("PRAGMA user_version = 1;");
  }

  /**
   * Bring a database created by an older version of the schema up to date.
   * CREATE TABLE IF NOT EXISTS never alters an existing table, so new columns are added here.
   */
  private migrate(): void {
  const hasColumn = (table: string, column: string): boolean =>
    (this.connection.prepare(`PRAGMA table_info(${table})`).all() as RawRow[]).some((row) => String(row.name) === column);
  if (!hasColumn("fidelities", "default_package_id")) {
    this.connection.exec("ALTER TABLE fidelities ADD COLUMN default_package_id INTEGER REFERENCES packages(id) ON DELETE RESTRICT");
  }
  if (!hasColumn("assignations", "package_id")) {
    this.connection.exec("ALTER TABLE assignations ADD COLUMN package_id INTEGER REFERENCES packages(id) ON DELETE RESTRICT");
  }
  if (!hasColumn("meetings", "hourly_rate")) {
    this.connection.exec("ALTER TABLE meetings ADD COLUMN hourly_rate REAL NOT NULL DEFAULT 0 CHECK (hourly_rate >= 0)");
  }
  if (!hasColumn("companies", "society_rate")) {
    this.connection.exec("ALTER TABLE companies ADD COLUMN society_rate REAL NOT NULL DEFAULT 28 CHECK (society_rate >= 0 AND society_rate <= 1000)");
  }
  if (!hasColumn("meetings", "society_rate")) {
    this.connection.exec("ALTER TABLE meetings ADD COLUMN society_rate REAL NOT NULL DEFAULT 28 CHECK (society_rate >= 0 AND society_rate <= 1000)");
  }
  if (!hasColumn("rooms", "position")) {
    this.connection.exec("ALTER TABLE rooms ADD COLUMN position INTEGER NOT NULL DEFAULT 0");
    // Keep the previous (alphabetical) order as the initial manual order of every company.
    const rows = this.connection.prepare(
    "SELECT company_id, name FROM rooms ORDER BY company_id, name COLLATE NOCASE",
    ).all() as RawRow[];
    const counters = new Map<number, number>();
    const update = this.connection.prepare("UPDATE rooms SET position = ? WHERE company_id = ? AND name = ?");
    for (const row of rows) {
    const companyId = Number(row.company_id);
    const index = counters.get(companyId) ?? 0;
    counters.set(companyId, index + 1);
    update.run(index, companyId, String(row.name));
    }
  }
  }

  /** Run a callback atomically and roll it back if any statement fails. */
  withTransaction<T>(callback: () => T): T {
  this.ensureOpen();
  const depth = this.transactionDepth;
  const savepoint = `database_nested_${depth}`;
  this.connection.exec(depth === 0 ? "BEGIN IMMEDIATE;" : `SAVEPOINT ${savepoint};`);
  this.transactionDepth = depth + 1;
  try {
    const result = callback();
    this.connection.exec(depth === 0 ? "COMMIT;" : `RELEASE SAVEPOINT ${savepoint};`);
    this.transactionDepth = depth;
    return result;
  } catch (error) {
    this.transactionDepth = depth;
    try {
    if (depth === 0) {
      this.connection.exec("ROLLBACK;");
    } else {
      this.connection.exec(`ROLLBACK TO SAVEPOINT ${savepoint};`);
      this.connection.exec(`RELEASE SAVEPOINT ${savepoint};`);
    }
    } catch {
    // Preserve the original failure if rollback itself fails.
    }
    throw error;
  }
  }

  /** Return basic database health information. */
  healthCheck(): { ok: true; sqliteVersion: string; databasePath: string } {
  this.ensureOpen();
  const row = this.connection.prepare("SELECT sqlite_version() AS version").get() as RawRow;
  return { ok: true, sqliteVersion: String(row.version), databasePath: this.databasePath };
  }

  close(): void {
  if (!this.closed) {
    this.connection.close();
    this.closed = true;
  }
  }

  // ---------------------------------------------------------------------------
  // Companies and administrator privileges
  // ---------------------------------------------------------------------------

  createCompany(name: string): Company {
  const cleanName = this.requiredText(name, "Company name", 120);
  const now = this.nowIso();
  const result = this.connection.prepare(
    "INSERT INTO companies (name, created_at, updated_at) VALUES (?, ?, ?)",
  ).run(cleanName, now, now);
  return this.getCompanyById(Number(result.lastInsertRowid))!;
  }

  createAdminWithCompany(input: {
  username: string;
  passwordHash: string;
  displayName: string;
  companyName: string;
  level?: number;
  }): { admin: Admin; company: Company; privilege: Privilege } {
  const username = this.requiredText(input.username, "Username", 120);
  const passwordHash = this.requiredText(input.passwordHash, "Password hash", 500);
  const displayName = this.requiredText(input.displayName, "Display name", 160);
  const companyName = this.requiredText(input.companyName, "Company name", 120);
  const level = input.level ?? 1;
  this.assertInteger(level, "Privilege level", 0);
  return this.withTransaction(() => {
    const now = this.nowIso();
    const companyInsert = this.connection.prepare(
    "INSERT INTO companies (name, created_at, updated_at) VALUES (?, ?, ?)",
    ).run(companyName, now, now);
    const companyId = Number(companyInsert.lastInsertRowid);
    const adminInsert = this.connection.prepare(
    "INSERT INTO admins (username, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)",
    ).run(username, passwordHash, displayName, now);
    const adminId = Number(adminInsert.lastInsertRowid);
    this.connection.prepare(
    "INSERT INTO privileges (admin_id, company_id, level) VALUES (?, ?, ?)",
    ).run(adminId, companyId, level);
    return {
    admin: this.getAdminById(adminId)!,
    company: this.getCompanyById(companyId)!,
    privilege: this.getPrivilegeByAdminId(adminId)!,
    };
  });
  }

  getCompanyById(id: number): Company | null {
  const row = this.connection.prepare(
    "SELECT id, name, society_rate, created_at, updated_at FROM companies WHERE id = ?",
  ).get(id) as RawRow | undefined;
  return row ? this.mapCompany(row) : null;
  }

  getCompanyByName(name: string): Company | null {
  const row = this.connection.prepare(
    "SELECT id, name, society_rate, created_at, updated_at FROM companies WHERE name = ? COLLATE NOCASE",
  ).get(name.trim()) as RawRow | undefined;
  return row ? this.mapCompany(row) : null;
  }

  listCompanies(): Company[] {
  const rows = this.connection.prepare(
    "SELECT id, name, society_rate, created_at, updated_at FROM companies ORDER BY name COLLATE NOCASE",
  ).all() as RawRow[];
  return rows.map((row) => this.mapCompany(row));
  }

  updateCompanyName(id: number, name: string): Company {
  const cleanName = this.requiredText(name, "Company name", 120);
  this.connection.prepare(
    "UPDATE companies SET name = ?, updated_at = ? WHERE id = ?",
  ).run(cleanName, this.nowIso(), id);
  const company = this.getCompanyById(id);
  if (!company) throw new Error("Company not found");
  return company;
  }

  /**
   * Change the percentage the company takes on the agent (0 to 1000).
   * Pending meetings follow the new rate; done and cancelled meetings keep the rate they were settled with.
   */
  updateSocietyRate(companyId: number, societyRate: number): Company {
  this.assertSocietyRate(societyRate);
  return this.withTransaction(() => {
    const now = this.nowIso();
    this.connection.prepare("UPDATE companies SET society_rate = ?, updated_at = ? WHERE id = ?").run(societyRate, now, companyId);
    const company = this.getCompanyById(companyId);
    if (!company) throw new Error("Company not found");
    this.connection.prepare(
    `UPDATE meetings SET society_rate = ?, updated_at = ?
     WHERE status = 'pending'
     AND assignation_id IN (SELECT a.id FROM assignations a JOIN fidelities f ON f.id = a.fidelity_id WHERE f.company_id = ?)`,
    ).run(societyRate, now, companyId);
    return company;
  });
  }

  /** Society rate (percent) of a company; falls back to the default when the company is unknown. */
  getSocietyRate(companyId: number): number {
  return this.getCompanyById(companyId)?.societyRate ?? DEFAULT_SOCIETY_RATE;
  }

  getAdminById(id: number): Admin | null {
  const row = this.connection.prepare(
    "SELECT id, username, display_name, created_at FROM admins WHERE id = ?",
  ).get(id) as RawRow | undefined;
  return row ? this.mapAdmin(row) : null;
  }

  getAdminCredentialsByUsername(username: string): AdminCredentials | null {
  const row = this.connection.prepare(
    "SELECT id, username, password_hash, display_name, created_at FROM admins WHERE username = ? COLLATE NOCASE",
  ).get(username.trim()) as RawRow | undefined;
  if (!row) return null;
  return { ...this.mapAdmin(row), passwordHash: String(row.password_hash) };
  }

  getPrivilegeByAdminId(adminId: number): Privilege | null {
  const row = this.connection.prepare(
    "SELECT id, admin_id, company_id, level FROM privileges WHERE admin_id = ?",
  ).get(adminId) as RawRow | undefined;
  return row ? this.mapPrivilege(row) : null;
  }

  getCompanyForAdmin(adminId: number): Company | null {
  const row = this.connection.prepare(
    `SELECT c.id, c.name, c.society_rate, c.created_at, c.updated_at
     FROM companies c JOIN privileges p ON p.company_id = c.id WHERE p.admin_id = ?`,
  ).get(adminId) as RawRow | undefined;
  return row ? this.mapCompany(row) : null;
  }

  updatePrivilegeLevel(adminId: number, level: number): Privilege {
  this.assertInteger(level, "Privilege level", 0);
  this.connection.prepare("UPDATE privileges SET level = ? WHERE admin_id = ?").run(level, adminId);
  const privilege = this.getPrivilegeByAdminId(adminId);
  if (!privilege) throw new Error("Privilege not found");
  return privilege;
  }

  // ---------------------------------------------------------------------------
  // Agents and contracts
  // ---------------------------------------------------------------------------

  createAgent(input: CreateAgentInput): Agent {
  const name = this.requiredText(input.name, "Agent name", 120);
  const surname = this.requiredText(input.surname, "Agent surname", 120);
  const username = this.requiredText(input.username, "Username", 120);
  const passwordHash = input.passwordHash ?? null;
  const status = input.status ?? "pending";
  this.assertAgentStatus(status);
  const now = this.nowIso();
  const result = this.connection.prepare(
    `INSERT INTO agents (name, surname, username, password_hash, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(name, surname, username, passwordHash, status, now, now);
  return this.getAgentById(Number(result.lastInsertRowid))!;
  }

  getAgentById(id: number): Agent | null {
  const row = this.connection.prepare(
    "SELECT id, name, surname, username, status, created_at FROM agents WHERE id = ?",
  ).get(id) as RawRow | undefined;
  return row ? this.mapAgent(row) : null;
  }

  getAgentCredentialsByUsername(username: string): AgentCredentials | null {
  const row = this.connection.prepare(
    "SELECT id, name, surname, username, password_hash, status, created_at FROM agents WHERE username = ? COLLATE NOCASE",
  ).get(username.trim()) as RawRow | undefined;
  return row ? this.mapAgentCredentials(row) : null;
  }

  listAgentsForCompany(companyId: number): Agent[] {
  const rows = this.connection.prepare(
    `SELECT DISTINCT a.id, a.name, a.surname, a.username, a.password_hash, a.status, a.created_at
     FROM agents a JOIN contracts c ON c.agent_id = a.id
     WHERE c.company_id = ? ORDER BY a.surname COLLATE NOCASE, a.name COLLATE NOCASE`,
  ).all(companyId) as RawRow[];
  return rows.map((row) => this.mapAgent(row));
  }

  /** Search existing agents (any company) using only fields appropriate for an administrator. */
  searchAgents(query: string, limit = 20): Array<Pick<Agent, "id" | "name" | "surname" | "username">> {
  const cleanQuery = this.requiredText(query, "Search query", 120);
  this.assertInteger(limit, "Limit", 1);
  if (limit > 100) throw new Error("Limit cannot exceed 100");
  const pattern = `%${cleanQuery.replace(/[\\%_]/g, "\\$&")}%`;
  const rows = this.connection.prepare(
    `SELECT id, name, surname, username FROM agents
     WHERE name LIKE ? ESCAPE '\\' OR surname LIKE ? ESCAPE '\\' OR username LIKE ? ESCAPE '\\'
     ORDER BY surname COLLATE NOCASE, name COLLATE NOCASE LIMIT ?`,
  ).all(pattern, pattern, pattern, limit) as RawRow[];
  return rows.map((row) => ({
    id: Number(row.id), name: String(row.name), surname: String(row.surname), username: String(row.username),
  }));
  }

  updateAgentProfile(id: number, input: { name: string; surname: string; username: string }): Agent {
  this.connection.prepare(
    "UPDATE agents SET name = ?, surname = ?, username = ?, updated_at = ? WHERE id = ?",
  ).run(
    this.requiredText(input.name, "Agent name", 120),
    this.requiredText(input.surname, "Agent surname", 120),
    this.requiredText(input.username, "Username", 120),
    this.nowIso(),
    id,
  );
  const agent = this.getAgentById(id);
  if (!agent) throw new Error("Agent not found");
  return agent;
  }

  setAgentPasswordHash(id: number, passwordHash: string | null): void {
  this.connection.prepare("UPDATE agents SET password_hash = ?, updated_at = ? WHERE id = ?")
    .run(passwordHash, this.nowIso(), id);
  if (!this.getAgentById(id)) throw new Error("Agent not found");
  }

  setAgentStatus(id: number, status: AgentStatus): Agent {
  this.assertAgentStatus(status);
  this.connection.prepare("UPDATE agents SET status = ?, updated_at = ? WHERE id = ?")
    .run(status, this.nowIso(), id);
  const agent = this.getAgentById(id);
  if (!agent) throw new Error("Agent not found");
  return agent;
  }

  createContract(agentId: number, companyId: number): Contract {
  const result = this.connection.prepare(
    "INSERT INTO contracts (agent_id, company_id, created_at) VALUES (?, ?, ?)",
  ).run(agentId, companyId, this.nowIso());
  return this.getContractById(Number(result.lastInsertRowid))!;
  }

  getContractById(id: number): Contract | null {
  const row = this.connection.prepare(
    "SELECT id, agent_id, company_id, created_at FROM contracts WHERE id = ?",
  ).get(id) as RawRow | undefined;
  return row ? this.mapContract(row) : null;
  }

  listContractsForAgent(agentId: number): Contract[] {
  const rows = this.connection.prepare(
    "SELECT id, agent_id, company_id, created_at FROM contracts WHERE agent_id = ? ORDER BY company_id",
  ).all(agentId) as RawRow[];
  return rows.map((row) => this.mapContract(row));
  }

  listContractsForCompany(companyId: number): Contract[] {
  const rows = this.connection.prepare(
    "SELECT id, agent_id, company_id, created_at FROM contracts WHERE company_id = ? ORDER BY agent_id",
  ).all(companyId) as RawRow[];
  return rows.map((row) => this.mapContract(row));
  }

  deleteContract(contractId: number): void {
  this.connection.prepare("DELETE FROM contracts WHERE id = ?").run(contractId);
  }

  // ---------------------------------------------------------------------------
  // Consumers, fidelities, and assignations
  // ---------------------------------------------------------------------------

  createConsumer(input: CreateConsumerInput): Consumer {
  const name = this.requiredText(input.name, "Consumer name", 120);
  const surname = this.requiredText(input.surname, "Consumer surname", 120);
  const username = this.requiredText(input.username, "Username", 120);
  const passwordHash = input.passwordHash ?? null;
  return this.withTransaction(() => {
    const key = this.generateUniqueKey();
    const now = this.nowIso();
    const result = this.connection.prepare(
    `INSERT INTO consumers (key, name, surname, username, password_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(key, name, surname, username, passwordHash, now, now);
    return this.getConsumerById(Number(result.lastInsertRowid))!;
  });
  }

  getConsumerById(id: number): Consumer | null {
  const row = this.connection.prepare(
    "SELECT id, name, surname, username, created_at FROM consumers WHERE id = ?",
  ).get(id) as RawRow | undefined;
  return row ? this.mapConsumer(row) : null;
  }

  getConsumerCredentialsByUsername(username: string): ConsumerCredentials | null {
  const row = this.connection.prepare(
    "SELECT id, key, name, surname, username, password_hash, created_at FROM consumers WHERE username = ? COLLATE NOCASE",
  ).get(username.trim()) as RawRow | undefined;
  return row ? this.mapConsumerCredentials(row) : null;
  }

  getConsumerCredentialsById(id: number): ConsumerCredentials | null {
  const row = this.connection.prepare(
    "SELECT id, key, name, surname, username, password_hash, created_at FROM consumers WHERE id = ?",
  ).get(id) as RawRow | undefined;
  return row ? this.mapConsumerCredentials(row) : null;
  }

  getConsumerByPersonalKey(key: string): ConsumerCredentials | null {
  const row = this.connection.prepare(
    "SELECT id, key, name, surname, username, password_hash, created_at FROM consumers WHERE key = ?",
  ).get(key) as RawRow | undefined;
  return row ? this.mapConsumerCredentials(row) : null;
  }

  /** Search existing consumers using only fields appropriate for an authenticated administrator. */
  searchConsumers(query: string, limit = 20): Array<Pick<Consumer, "id" | "name" | "surname" | "username">> {
  const cleanQuery = this.requiredText(query, "Search query", 120);
  this.assertInteger(limit, "Limit", 1);
  if (limit > 100) throw new Error("Limit cannot exceed 100");
  const pattern = `%${cleanQuery.replace(/[\\%_]/g, "\\$&")}%`;
  const rows = this.connection.prepare(
    `SELECT id, name, surname, username FROM consumers
     WHERE name LIKE ? ESCAPE '\\' OR surname LIKE ? ESCAPE '\\' OR username LIKE ? ESCAPE '\\'
     ORDER BY surname COLLATE NOCASE, name COLLATE NOCASE LIMIT ?`,
  ).all(pattern, pattern, pattern, limit) as RawRow[];
  return rows.map((row) => ({
    id: Number(row.id), name: String(row.name), surname: String(row.surname), username: String(row.username),
  }));
  }

  listConsumersForCompany(companyId: number): Array<{
  consumer: Pick<Consumer, "id" | "name" | "surname" | "username">;
  fidelity: Fidelity;
  }> {
  const rows = this.connection.prepare(
    `SELECT co.id AS consumer_id, co.name AS consumer_name, co.surname AS consumer_surname,
        co.username AS consumer_username, f.id AS fidelity_id, f.key AS fidelity_key,
        f.company_id AS fidelity_company_id, f.consumer_id AS fidelity_consumer_id,
        f.active AS fidelity_active, f.default_package_id AS fidelity_default_package_id,
        f.created_at AS fidelity_created_at
     FROM consumers co JOIN fidelities f ON f.consumer_id = co.id
     WHERE f.company_id = ? ORDER BY co.surname COLLATE NOCASE, co.name COLLATE NOCASE`,
  ).all(companyId) as RawRow[];
  return rows.map((row) => ({
    consumer: {
    id: Number(row.consumer_id), name: String(row.consumer_name), surname: String(row.consumer_surname),
    username: String(row.consumer_username),
    },
    fidelity: this.mapFidelity({
    id: row.fidelity_id, key: row.fidelity_key, company_id: row.fidelity_company_id,
    consumer_id: row.fidelity_consumer_id, active: row.fidelity_active,
    default_package_id: row.fidelity_default_package_id, created_at: row.fidelity_created_at,
    }),
  }));
  }

  updateConsumerProfile(id: number, input: { name: string; surname: string; username: string }): Consumer {
  this.connection.prepare(
    "UPDATE consumers SET name = ?, surname = ?, username = ?, updated_at = ? WHERE id = ?",
  ).run(
    this.requiredText(input.name, "Consumer name", 120),
    this.requiredText(input.surname, "Consumer surname", 120),
    this.requiredText(input.username, "Username", 120),
    this.nowIso(), id,
  );
  const consumer = this.getConsumerById(id);
  if (!consumer) throw new Error("Consumer not found");
  return consumer;
  }

  setConsumerPasswordHash(id: number, passwordHash: string | null): void {
  this.connection.prepare("UPDATE consumers SET password_hash = ?, updated_at = ? WHERE id = ?")
    .run(passwordHash, this.nowIso(), id);
  if (!this.getConsumerById(id)) throw new Error("Consumer not found");
  }

  createFidelity(companyId: number, consumerId: number): Fidelity {
  return this.withTransaction(() => {
    const key = this.generateUniqueKey();
    const result = this.connection.prepare(
    "INSERT INTO fidelities (key, company_id, consumer_id, active, created_at) VALUES (?, ?, ?, 1, ?)",
    ).run(key, companyId, consumerId, this.nowIso());
    return this.getFidelityById(Number(result.lastInsertRowid))!;
  });
  }

  getFidelityById(id: number): Fidelity | null {
  const row = this.connection.prepare(
    "SELECT id, key, company_id, consumer_id, active, default_package_id, created_at FROM fidelities WHERE id = ?",
  ).get(id) as RawRow | undefined;
  return row ? this.mapFidelity(row) : null;
  }

  getFidelityByAccessKey(key: string): Fidelity | null {
  const row = this.connection.prepare(
    "SELECT id, key, company_id, consumer_id, active, default_package_id, created_at FROM fidelities WHERE key = ? AND active = 1",
  ).get(key) as RawRow | undefined;
  return row ? this.mapFidelity(row) : null;
  }

  listFidelitiesForCompany(companyId: number): Fidelity[] {
  const rows = this.connection.prepare(
    "SELECT id, key, company_id, consumer_id, active, default_package_id, created_at FROM fidelities WHERE company_id = ? ORDER BY id",
  ).all(companyId) as RawRow[];
  return rows.map((row) => this.mapFidelity(row));
  }

  setFidelityActive(id: number, active: boolean): Fidelity {
  this.connection.prepare("UPDATE fidelities SET active = ? WHERE id = ?").run(active ? 1 : 0, id);
  const fidelity = this.getFidelityById(id);
  if (!fidelity) throw new Error("Fidelity not found");
  return fidelity;
  }

  createAssignation(agentId: number, fidelityId: number): Assignation {
  const result = this.connection.prepare(
    "INSERT INTO assignations (agent_id, fidelity_id, created_at) VALUES (?, ?, ?)",
  ).run(agentId, fidelityId, this.nowIso());
  return this.getAssignationById(Number(result.lastInsertRowid))!;
  }

  getAssignationById(id: number): Assignation | null {
  const row = this.connection.prepare(
    "SELECT id, agent_id, fidelity_id, package_id, created_at FROM assignations WHERE id = ?",
  ).get(id) as RawRow | undefined;
  return row ? this.mapAssignation(row) : null;
  }

  listAssignationsForAgent(agentId: number): Assignation[] {
  const rows = this.connection.prepare(
    "SELECT id, agent_id, fidelity_id, package_id, created_at FROM assignations WHERE agent_id = ? ORDER BY id",
  ).all(agentId) as RawRow[];
  return rows.map((row) => this.mapAssignation(row));
  }

  listAssignationsForConsumer(consumerId: number): Assignation[] {
  const rows = this.connection.prepare(
    `SELECT a.id, a.agent_id, a.fidelity_id, a.package_id, a.created_at
     FROM assignations a JOIN fidelities f ON f.id = a.fidelity_id
     WHERE f.consumer_id = ? AND f.active = 1 ORDER BY a.id`,
  ).all(consumerId) as RawRow[];
  return rows.map((row) => this.mapAssignation(row));
  }

  listAssignedAgentsForConsumer(consumerId: number): Array<{
  assignationId: number;
  agent: Pick<Agent, "id" | "name" | "surname" | "username" | "status">;
  company: Company;
  }> {
  const rows = this.connection.prepare(
    `SELECT a.id AS assignation_id, ag.id AS agent_id, ag.name AS agent_name,
        ag.surname AS agent_surname, ag.username AS agent_username, ag.status AS agent_status,
        c.id AS company_id, c.name AS company_name, c.society_rate AS company_society_rate,
        c.created_at AS company_created_at, c.updated_at AS company_updated_at
     FROM assignations a
     JOIN agents ag ON ag.id = a.agent_id
     JOIN fidelities f ON f.id = a.fidelity_id
     JOIN companies c ON c.id = f.company_id
     WHERE f.consumer_id = ? AND f.active = 1 AND ag.status <> 'disabled'
     ORDER BY ag.surname COLLATE NOCASE, ag.name COLLATE NOCASE`,
  ).all(consumerId) as RawRow[];
  return rows.map((row) => ({
    assignationId: Number(row.assignation_id),
    agent: {
    id: Number(row.agent_id), name: String(row.agent_name), surname: String(row.agent_surname),
    username: String(row.agent_username), status: String(row.agent_status) as AgentStatus,
    },
    company: this.mapCompany({
    id: row.company_id, name: row.company_name, society_rate: row.company_society_rate,
    created_at: row.company_created_at, updated_at: row.company_updated_at,
    }),
  }));
  }

  /** Assignations of an agent, with the consumer and the company of each. */
  listAssignationDetailsForAgent(agentId: number): Array<{
  id: number;
  agentId: number;
  fidelityId: number;
  companyId: number;
  companyName: string;
  createdAt: string;
  consumer: Pick<Consumer, "id" | "name" | "surname" | "username">;
  }> {
  const rows = this.connection.prepare(
    `SELECT a.id, a.agent_id, a.fidelity_id, a.created_at, f.company_id, c.name AS company_name,
        co.id AS consumer_id, co.name AS consumer_name, co.surname AS consumer_surname, co.username AS consumer_username
     FROM assignations a
     JOIN fidelities f ON f.id = a.fidelity_id AND f.active = 1
     JOIN companies c ON c.id = f.company_id
     JOIN consumers co ON co.id = f.consumer_id
     WHERE a.agent_id = ?
     ORDER BY co.surname COLLATE NOCASE, co.name COLLATE NOCASE`,
  ).all(agentId) as RawRow[];
  return rows.map((row) => ({
    id: Number(row.id), agentId: Number(row.agent_id), fidelityId: Number(row.fidelity_id), createdAt: String(row.created_at),
    companyId: Number(row.company_id), companyName: String(row.company_name),
    consumer: { id: Number(row.consumer_id), name: String(row.consumer_name), surname: String(row.consumer_surname), username: String(row.consumer_username) },
  }));
  }

  /** Assignations of a company, with the agent and the consumer they link. */
  listAssignationsForCompany(companyId: number): Array<{
  id: number;
  agentId: number;
  fidelityId: number;
  packageId: number | null;
  createdAt: string;
  agent: Pick<Agent, "id" | "name" | "surname" | "username">;
  consumer: Pick<Consumer, "id" | "name" | "surname" | "username">;
  }> {
  const rows = this.connection.prepare(
    `SELECT a.id, a.agent_id, a.fidelity_id, a.package_id, a.created_at,
        ag.name AS agent_name, ag.surname AS agent_surname, ag.username AS agent_username,
        co.id AS consumer_id, co.name AS consumer_name, co.surname AS consumer_surname, co.username AS consumer_username
     FROM assignations a
     JOIN fidelities f ON f.id = a.fidelity_id
     JOIN agents ag ON ag.id = a.agent_id
     JOIN consumers co ON co.id = f.consumer_id
     WHERE f.company_id = ?
     ORDER BY ag.surname COLLATE NOCASE, ag.name COLLATE NOCASE, co.surname COLLATE NOCASE, co.name COLLATE NOCASE`,
  ).all(companyId) as RawRow[];
  return rows.map((row) => ({
    id: Number(row.id), agentId: Number(row.agent_id), fidelityId: Number(row.fidelity_id), createdAt: String(row.created_at),
    packageId: row.package_id === null || row.package_id === undefined ? null : Number(row.package_id),
    agent: { id: Number(row.agent_id), name: String(row.agent_name), surname: String(row.agent_surname), username: String(row.agent_username) },
    consumer: { id: Number(row.consumer_id), name: String(row.consumer_name), surname: String(row.consumer_surname), username: String(row.consumer_username) },
  }));
  }

  deleteAssignation(assignationId: number): void {
  this.connection.prepare("DELETE FROM assignations WHERE id = ?").run(assignationId);
  }

  // ---------------------------------------------------------------------------
  // Rooms and room-capacity queries
  // ---------------------------------------------------------------------------

  createRoom(companyId: number, name: string, limit: number): Room {
  const cleanName = this.requiredText(name, "Room name", 120);
  this.assertInteger(limit, "Room limit", -1);
  if (limit === 0 || limit < -1) throw new Error("Room limit must be -1 or a positive integer");
  const now = this.nowIso();
  this.connection.prepare(
    `INSERT INTO rooms (company_id, name, limit_count, active, position, created_at, updated_at)
     VALUES (?, ?, ?, 1, (SELECT COALESCE(MAX(position) + 1, 0) FROM rooms WHERE company_id = ?), ?, ?)`,
  ).run(companyId, cleanName, limit, companyId, now, now);
  return this.getRoom(companyId, cleanName)!;
  }

  getRoom(companyId: number, name: string): Room | null {
  const row = this.connection.prepare(
    "SELECT company_id, name, limit_count, active, position, created_at, updated_at FROM rooms WHERE company_id = ? AND name = ?",
  ).get(companyId, name) as RawRow | undefined;
  return row ? this.mapRoom(row) : null;
  }

  listRooms(companyId: number, includeInactive = false): Room[] {
  const rows = this.connection.prepare(
    `SELECT company_id, name, limit_count, active, position, created_at, updated_at FROM rooms
     WHERE company_id = ? AND (? = 1 OR active = 1) ORDER BY position, name COLLATE NOCASE`,
  ).all(companyId, includeInactive ? 1 : 0) as RawRow[];
  return rows.map((row) => this.mapRoom(row));
  }

  updateRoomLimit(companyId: number, name: string, limit: number): Room {
  this.assertInteger(limit, "Room limit", -1);
  if (limit === 0 || limit < -1) throw new Error("Room limit must be -1 or a positive integer");
  this.connection.prepare(
    "UPDATE rooms SET limit_count = ?, updated_at = ? WHERE company_id = ? AND name = ?",
  ).run(limit, this.nowIso(), companyId, name);
  const room = this.getRoom(companyId, name);
  if (!room) throw new Error("Room not found");
  return room;
  }

  renameRoom(companyId: number, oldName: string, newName: string): Room {
  const cleanNewName = this.requiredText(newName, "Room name", 120);
  this.connection.prepare(
    "UPDATE rooms SET name = ?, updated_at = ? WHERE company_id = ? AND name = ?",
  ).run(cleanNewName, this.nowIso(), companyId, oldName);
  const room = this.getRoom(companyId, cleanNewName);
  if (!room) throw new Error("Room not found");
  return room;
  }

  setRoomActive(companyId: number, name: string, active: boolean): Room {
  this.connection.prepare(
    "UPDATE rooms SET active = ?, updated_at = ? WHERE company_id = ? AND name = ?",
  ).run(active ? 1 : 0, this.nowIso(), companyId, name);
  const room = this.getRoom(companyId, name);
  if (!room) throw new Error("Room not found");
  return room;
  }

  /** Hard deletion is rejected by foreign keys while any historical meeting references the room. */
  deleteRoom(companyId: number, name: string): void {
  this.connection.prepare("DELETE FROM rooms WHERE company_id = ? AND name = ?").run(companyId, name);
  }

  /**
   * Save the whole room list in one transaction: rename, new limit and new order (the array order is the display order).
   * Either everything is saved or nothing is.
   */
  saveRooms(companyId: number, items: Array<{ name: string; newName?: string; limit: number }>): Room[] {
  return this.withTransaction(() => {
    const now = this.nowIso();
    items.forEach((item, index) => {
    let name = item.name;
    const wanted = item.newName?.trim();
    if (wanted && wanted !== name) name = this.renameRoom(companyId, name, wanted).name;
    this.updateRoomLimit(companyId, name, item.limit);
    this.connection.prepare("UPDATE rooms SET position = ?, updated_at = ? WHERE company_id = ? AND name = ?")
      .run(index, now, companyId, name);
    });
    return this.listRooms(companyId);
  });
  }

  /**
   * Automatically give a room to the pending meetings that have none, between `from` and `to`.
   * Rules:
   *  - meetings that already have a room are never changed (they still count in the room capacity);
   *  - rooms with limit -1 (unlimited) and inactive rooms are never used;
   *  - an agent keeps one single room whenever possible; otherwise the room only changes when it has to;
   *  - rooms the agent already uses (or last used) come first, then the order of the room list (admin preference).
   */
  autoAssignRooms(companyId: number, from: string | Date, to: string | Date): AutoAssignRoomsResult {
  const start = this.normalizeIsoDate(from, "Range start");
  const end = this.normalizeIsoDate(to, "Range end");
  if (Date.parse(start) >= Date.parse(end)) throw new Error("Range end must be after range start");

  return this.withTransaction(() => {
    const rooms = this.listRooms(companyId).filter((room) => room.active && room.limit !== -1);
    const keyOf = (name: string) => name.toLowerCase();

    // Meetings of the period (not cancelled) with the agent who runs them.
    const rows = this.connection.prepare(
    `SELECT m.id, m.start_at, m.duration_minutes, m.room_name, m.status, a.agent_id
     FROM meetings m
     JOIN assignations a ON a.id = m.assignation_id
     JOIN fidelities f ON f.id = a.fidelity_id
     WHERE f.company_id = ? AND m.status <> 'canceledBy'
     AND julianday(m.start_at, '+' || m.duration_minutes || ' minutes') > julianday(?)
     AND julianday(m.start_at) < julianday(?)
     ORDER BY m.start_at, m.id`,
    ).all(companyId, start, end) as RawRow[];
    const items = rows.map((row) => ({
    id: Number(row.id), agentId: Number(row.agent_id),
    s: Date.parse(String(row.start_at)), e: Date.parse(String(row.start_at)) + Number(row.duration_minutes) * 60_000,
    room: row.room_name === null || row.room_name === undefined ? null : String(row.room_name),
    pending: String(row.status) === "pending",
    }));
    const targets = items.filter((item) => item.room === null && item.pending);
    if (!targets.length || !rooms.length) return { assigned: [], unassigned: targets.map((item) => item.id) };

    // Room occupancy over the whole window covered by the targets (meetings may stick out of the period).
    const winStart = new Date(Math.min(...targets.map((item) => item.s))).toISOString();
    const winEnd = new Date(Math.max(...targets.map((item) => item.e))).toISOString();
    const occupancyRows = this.connection.prepare(
    `SELECT m.start_at, m.duration_minutes, m.room_name FROM meetings m
     WHERE m.room_company_id = ? AND m.room_name IS NOT NULL AND m.status <> 'canceledBy'
     AND julianday(m.start_at, '+' || m.duration_minutes || ' minutes') > julianday(?)
     AND julianday(m.start_at) < julianday(?)`,
    ).all(companyId, winStart, winEnd) as RawRow[];
    const occupancy = new Map<string, Array<{ s: number; e: number }>>();
    for (const row of occupancyRows) {
    const key = keyOf(String(row.room_name));
    const list = occupancy.get(key) ?? [];
    list.push({ s: Date.parse(String(row.start_at)), e: Date.parse(String(row.start_at)) + Number(row.duration_minutes) * 60_000 });
    occupancy.set(key, list);
    }
    const fits = (room: Room, s: number, e: number, extra: Array<{ s: number; e: number }> = []) =>
    this.peakOfIntervals([...(occupancy.get(keyOf(room.name)) ?? []), ...extra], s, e) < room.limit;

    // Group the targets by agent; agents with the most meetings are placed first (they are the hardest to keep in one room).
    const byAgent = new Map<number, typeof targets>();
    for (const target of targets) byAgent.set(target.agentId, [...(byAgent.get(target.agentId) ?? []), target]);
    const agentIds = [...byAgent.keys()].sort((a, b) => byAgent.get(b)!.length - byAgent.get(a)!.length || a - b);

    const lastRoomBefore = this.connection.prepare(
    `SELECT m.room_name FROM meetings m
     JOIN assignations a ON a.id = m.assignation_id
     JOIN fidelities f ON f.id = a.fidelity_id
     WHERE a.agent_id = ? AND f.company_id = ? AND m.room_name IS NOT NULL AND m.status <> 'canceledBy'
     AND julianday(m.start_at) < julianday(?)
     ORDER BY m.start_at DESC LIMIT 1`,
    );

    const decisions: Array<{ meetingId: number; room: Room }> = [];
    const unassigned: number[] = [];
    const reserve = (room: Room, item: { s: number; e: number }) => {
    const key = keyOf(room.name);
    occupancy.set(key, [...(occupancy.get(key) ?? []), { s: item.s, e: item.e }]);
    };

    for (const agentId of agentIds) {
    const mine = byAgent.get(agentId)!.sort((a, b) => a.s - b.s || a.id - b.id);

    // Rooms this agent already uses in the period, then the room used just before the period.
    const used = new Map<string, number>();
    for (const item of items) if (item.agentId === agentId && item.room) used.set(keyOf(item.room), (used.get(keyOf(item.room)) ?? 0) + 1);
    const before = lastRoomBefore.get(agentId, companyId, start) as RawRow | undefined;
    const beforeKey = before?.room_name ? keyOf(String(before.room_name)) : null;
    const ranked = rooms
      .map((room, index) => ({ room, index }))
      .sort((a, b) =>
      (used.get(keyOf(b.room.name)) ?? 0) - (used.get(keyOf(a.room.name)) ?? 0)
      || Number(keyOf(b.room.name) === beforeKey) - Number(keyOf(a.room.name) === beforeKey)
      || a.index - b.index)
      .map((entry) => entry.room);

    // 1) A single room for all the meetings of this agent: no room change at all.
    const single = ranked.find((room) => {
      const placed: Array<{ s: number; e: number }> = [];
      for (const item of mine) {
      if (!fits(room, item.s, item.e, placed)) return false;
      placed.push({ s: item.s, e: item.e });
      }
      return true;
    });
    if (single) {
      for (const item of mine) { reserve(single, item); decisions.push({ meetingId: item.id, room: single }); }
      continue;
    }

    // 2) Otherwise go chronologically and only leave the current room when it is full.
    let current: Room | null = ranked.find((room) => keyOf(room.name) === beforeKey) ?? null;
    for (const item of mine) {
      const candidates = current ? [current, ...ranked.filter((room) => room !== current)] : ranked;
      const chosen = candidates.find((room) => fits(room, item.s, item.e));
      if (!chosen) { unassigned.push(item.id); continue; }
      reserve(chosen, item);
      decisions.push({ meetingId: item.id, room: chosen });
      current = chosen;
    }
    }

    // Write the decisions; setMeetingRoom re-checks status and capacity against the database.
    const assigned: Array<{ meetingId: number; roomName: string }> = [];
    for (const decision of decisions) {
    try {
      this.setMeetingRoom(decision.meetingId, decision.room.name);
      assigned.push({ meetingId: decision.meetingId, roomName: decision.room.name });
    } catch {
      unassigned.push(decision.meetingId);
    }
    }
    return { assigned, unassigned };
  });
  }

  /** Highest number of intervals overlapping at the same time inside [windowStart, windowEnd). */
  private peakOfIntervals(intervals: Array<{ s: number; e: number }>, windowStart: number, windowEnd: number): number {
  const events: Array<{ time: number; delta: number }> = [];
  for (const interval of intervals) {
    const s = Math.max(windowStart, interval.s);
    const e = Math.min(windowEnd, interval.e);
    if (e <= s) continue;
    events.push({ time: s, delta: 1 }, { time: e, delta: -1 });
  }
  events.sort((left, right) => left.time - right.time || left.delta - right.delta);
  let current = 0;
  let peak = 0;
  for (const event of events) {
    current += event.delta;
    peak = Math.max(peak, current);
  }
  return peak;
  }

  // ---------------------------------------------------------------------------
  // Packages (hourly-rate formulas)
  // ---------------------------------------------------------------------------

  createPackage(companyId: number, name: string, hourlyRate: number): Package {
  const cleanName = this.requiredText(name, "Package name", 120);
  this.assertRate(hourlyRate);
  const result = this.connection.prepare(
    "INSERT INTO packages (company_id, name, hourly_rate, created_at) VALUES (?, ?, ?, ?)",
  ).run(companyId, cleanName, hourlyRate, this.nowIso());
  return this.getPackageById(Number(result.lastInsertRowid))!;
  }

  getPackageById(id: number): Package | null {
  const row = this.connection.prepare(
    "SELECT id, company_id, name, hourly_rate, created_at FROM packages WHERE id = ?",
  ).get(id) as RawRow | undefined;
  return row ? this.mapPackage(row) : null;
  }

  listPackages(companyId: number): Package[] {
  const rows = this.connection.prepare(
    "SELECT id, company_id, name, hourly_rate, created_at FROM packages WHERE company_id = ? ORDER BY name COLLATE NOCASE",
  ).all(companyId) as RawRow[];
  return rows.map((row) => this.mapPackage(row));
  }

  /** Rejected by foreign keys while a consumer or an assignation still uses the package. */
  deletePackage(id: number): void {
  this.connection.prepare("DELETE FROM packages WHERE id = ?").run(id);
  }

  /** Set (or clear with null) the default package of a consumer in a company. Pending meetings follow the new rate. */
  setFidelityDefaultPackage(fidelityId: number, packageId: number | null): Fidelity {
  return this.withTransaction(() => {
    const fidelity = this.getFidelityById(fidelityId);
    if (!fidelity) throw new Error("Fidelity not found");
    this.assertPackageInCompany(packageId, fidelity.companyId);
    this.connection.prepare("UPDATE fidelities SET default_package_id = ? WHERE id = ?").run(packageId, fidelityId);
    const assignations = this.connection.prepare("SELECT id FROM assignations WHERE fidelity_id = ?").all(fidelityId) as RawRow[];
    this.refreshPendingMeetingRates(assignations.map((row) => Number(row.id)));
    return this.getFidelityById(fidelityId)!;
  });
  }

  /** Choose the package of an agent/consumer pair; null means "use the consumer's default package". */
  setAssignationPackage(assignationId: number, packageId: number | null): Assignation {
  return this.withTransaction(() => {
    const assignation = this.getAssignationById(assignationId);
    if (!assignation) throw new Error("Assignation not found");
    const fidelity = this.getFidelityById(assignation.fidelityId);
    if (!fidelity) throw new Error("Fidelity not found");
    this.assertPackageInCompany(packageId, fidelity.companyId);
    this.connection.prepare("UPDATE assignations SET package_id = ? WHERE id = ?").run(packageId, assignationId);
    this.refreshPendingMeetingRates([assignationId]);
    return this.getAssignationById(assignationId)!;
  });
  }

  /** Hourly rate that applies to an assignation: its own package, else the consumer's default package, else 0. */
  resolveHourlyRate(assignationId: number): number {
  const row = this.connection.prepare(
    `SELECT COALESCE(pa.hourly_rate, pf.hourly_rate, 0) AS rate
     FROM assignations a
     JOIN fidelities f ON f.id = a.fidelity_id
     LEFT JOIN packages pa ON pa.id = a.package_id
     LEFT JOIN packages pf ON pf.id = f.default_package_id
     WHERE a.id = ?`,
  ).get(assignationId) as RawRow | undefined;
  return row ? Number(row.rate) : 0;
  }

  /** Pending meetings take the new rate; done and cancelled meetings keep the rate they were billed at. */
  private refreshPendingMeetingRates(assignationIds: number[]): void {
  const update = this.connection.prepare(
    "UPDATE meetings SET hourly_rate = ?, updated_at = ? WHERE assignation_id = ? AND status = 'pending'",
  );
  const now = this.nowIso();
  for (const assignationId of assignationIds) update.run(this.resolveHourlyRate(assignationId), now, assignationId);
  }

  private assertPackageInCompany(packageId: number | null, companyId: number): void {
  if (packageId === null) return;
  const pack = this.getPackageById(packageId);
  if (!pack || pack.companyId !== companyId) throw new Error("Package not found for this company");
  }

  private assertSocietyRate(rate: number): void {
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > MAX_SOCIETY_RATE) {
    throw new Error(`Society rate must be a number between 0 and ${MAX_SOCIETY_RATE}`);
  }
  }

  private assertRate(rate: number): void {
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0) throw new Error("Hourly rate must be a number greater than or equal to 0");
  }

  private mapPackage(row: RawRow): Package {
  return {
    id: Number(row.id), companyId: Number(row.company_id), name: String(row.name),
    hourlyRate: Number(row.hourly_rate), createdAt: String(row.created_at),
  };
  }

  isRoomAvailable(companyId: number, name: string, startAt: string | Date, durationMinutes: number, excludeMeetingId?: number): boolean {
  const room = this.getRoom(companyId, name);
  if (!room || !room.active) return false;
  if (room.limit === -1) return true;
  const peak = this.getRoomPeakOccupancy(companyId, name, startAt, durationMinutes, excludeMeetingId);
  return peak < room.limit;
  }

  getRoomPeakOccupancy(companyId: number, name: string, startAt: string | Date, durationMinutes: number, excludeMeetingId?: number): number {
  this.assertDuration(durationMinutes);
  const start = this.normalizeIsoDate(startAt, "Meeting start");
  const end = this.addMinutes(start, durationMinutes);
  const rows = this.connection.prepare(
    `SELECT m.start_at, m.duration_minutes
     FROM meetings m
     WHERE m.room_company_id = ? AND m.room_name = ? AND m.status <> 'canceledBy'
     AND julianday(m.start_at) < julianday(?)
     AND julianday(m.start_at, '+' || m.duration_minutes || ' minutes') > julianday(?)
     AND (? IS NULL OR m.id <> ?)`,
  ).all(companyId, name, end, start, excludeMeetingId ?? null, excludeMeetingId ?? null) as RawRow[];
  return this.peakOverlapCount(rows.map((row) => ({
    startAt: String(row.start_at), durationMinutes: Number(row.duration_minutes),
  })), start, end);
  }

  getRoomsAvailability(companyId: number, startAt: string | Date, durationMinutes: number): RoomAvailability[] {
  this.assertDuration(durationMinutes);
  const start = this.normalizeIsoDate(startAt, "Meeting start");
  const rooms = this.listRooms(companyId);
  return rooms.map((room) => {
    const peakOccupancy = room.limit === -1 ? 0 : this.getRoomPeakOccupancy(companyId, room.name, start, durationMinutes);
    const available = room.limit === -1 || peakOccupancy < room.limit;
    return {
    ...room,
    peakOccupancy,
    remainingCapacity: room.limit === -1 ? null : Math.max(0, room.limit - peakOccupancy),
    available,
    };
  });
  }

  // ---------------------------------------------------------------------------
  // Availability requests, consumer disponibilities, and agent suggestions
  // ---------------------------------------------------------------------------

  createAvailabilityRequest(assignationId: number, requestedHours: number): AvailabilityRequest {
  if (!Number.isFinite(requestedHours) || requestedHours <= 0 || requestedHours > 24 * 366) {
    throw new Error("Requested hours must be greater than 0 and at most 8784");
  }
  const requestedMinutes = Math.round(requestedHours * 60);
  if (requestedMinutes <= 0) throw new Error("Requested hours must equal at least one minute");
  const now = this.nowIso();
  const result = this.connection.prepare(
    `INSERT INTO availability_requests (assignation_id, requested_minutes, status, created_at, updated_at)
     VALUES (?, ?, 'open', ?, ?)`,
  ).run(assignationId, requestedMinutes, now, now);
  return this.getAvailabilityRequest(Number(result.lastInsertRowid))!;
  }

  getAvailabilityRequest(id: number): AvailabilityRequest | null {
  const row = this.connection.prepare(
    "SELECT id, assignation_id, requested_minutes, status, created_at, updated_at FROM availability_requests WHERE id = ?",
  ).get(id) as RawRow | undefined;
  return row ? this.mapAvailabilityRequest(row) : null;
  }

  getAvailabilityRequestProgress(id: number): AvailabilityRequestProgress | null {
  const row = this.connection.prepare(
    `SELECT r.id, r.assignation_id, r.requested_minutes, r.status, r.created_at, r.updated_at,
        COALESCE(SUM(CASE WHEN m.status <> 'canceledBy' THEN m.duration_minutes ELSE 0 END), 0) AS scheduled_minutes
     FROM availability_requests r
     LEFT JOIN meetings m ON m.availability_request_id = r.id
     WHERE r.id = ? GROUP BY r.id`,
  ).get(id) as RawRow | undefined;
  if (!row) return null;
  const request = this.mapAvailabilityRequest(row);
  const scheduledMinutes = Number(row.scheduled_minutes);
  return { ...request, scheduledMinutes, remainingMinutes: Math.max(0, request.requestedMinutes - scheduledMinutes) };
  }

  listAvailabilityRequestsForAssignation(assignationId: number): AvailabilityRequestProgress[] {
  const rows = this.connection.prepare(
    `SELECT r.id, r.assignation_id, r.requested_minutes, r.status, r.created_at, r.updated_at,
        COALESCE(SUM(CASE WHEN m.status <> 'canceledBy' THEN m.duration_minutes ELSE 0 END), 0) AS scheduled_minutes
     FROM availability_requests r LEFT JOIN meetings m ON m.availability_request_id = r.id
     WHERE r.assignation_id = ? GROUP BY r.id ORDER BY r.created_at DESC`,
  ).all(assignationId) as RawRow[];
  return rows.map((row) => {
    const request = this.mapAvailabilityRequest(row);
    const scheduledMinutes = Number(row.scheduled_minutes);
    return { ...request, scheduledMinutes, remainingMinutes: Math.max(0, request.requestedMinutes - scheduledMinutes) };
  });
  }

  setAvailabilityRequestStatus(id: number, status: AvailabilityRequestStatus): AvailabilityRequest {
  this.assertRequestStatus(status);
  this.connection.prepare("UPDATE availability_requests SET status = ?, updated_at = ? WHERE id = ?")
    .run(status, this.nowIso(), id);
  const request = this.getAvailabilityRequest(id);
  if (!request) throw new Error("Availability request not found");
  return request;
  }

  /**
   * Change the number of hours of a request whenever the consumer wants (a very large value means "no limit").
   * The new total can never be below the hours already scheduled; the request is reopened or marked
   * fulfilled according to the hours that remain. A closed request stays closed.
   */
  updateAvailabilityRequestHours(id: number, requestedHours: number): AvailabilityRequestProgress {
  if (!Number.isFinite(requestedHours) || requestedHours <= 0 || requestedHours > 24 * 366) {
    throw new Error("Requested hours must be greater than 0 and at most 8784");
  }
  const requestedMinutes = Math.round(requestedHours * 60);
  if (requestedMinutes <= 0) throw new Error("Requested hours must equal at least one minute");
  return this.withTransaction(() => {
    const progress = this.getAvailabilityRequestProgress(id);
    if (!progress) throw new Error("Availability request not found");
    if (requestedMinutes < progress.scheduledMinutes) {
    throw new Error(`Requested hours cannot be below the ${Math.round(progress.scheduledMinutes / 6) / 10} h already scheduled`);
    }
    const remaining = requestedMinutes - progress.scheduledMinutes;
    let status: AvailabilityRequestStatus = progress.status;
    if (status !== "closed") status = remaining > 0 ? "open" : "fulfilled";
    this.connection.prepare("UPDATE availability_requests SET requested_minutes = ?, status = ?, updated_at = ? WHERE id = ?")
    .run(requestedMinutes, status, this.nowIso(), id);
    return this.getAvailabilityRequestProgress(id)!;
  });
  }

  createDisponibility(input: CreateDisponibilityInput): Disponibility {
  this.assertDuration(input.durationMinutes);
  this.assertLove(input.love);
  const startAt = this.normalizeIsoDate(input.startAt, "Disponibility start");
  this.assertNoDisponibilityOverlap(input.assignationId, input.requestId, startAt, input.durationMinutes);
  const now = this.nowIso();
  const result = this.connection.prepare(
    `INSERT INTO disponibilities (assignation_id, request_id, start_at, duration_minutes, love, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(input.assignationId, input.requestId, startAt, input.durationMinutes, input.love, now, now);
  return this.getDisponibilityById(Number(result.lastInsertRowid))!;
  }

  getDisponibilityById(id: number): Disponibility | null {
  const row = this.connection.prepare(
    "SELECT id, assignation_id, request_id, start_at, duration_minutes, love, created_at, updated_at FROM disponibilities WHERE id = ?",
  ).get(id) as RawRow | undefined;
  return row ? this.mapDisponibility(row) : null;
  }

  listDisponibilitiesForRequest(requestId: number): Disponibility[] {
  this.cleanExpiredIntervals();
  const rows = this.connection.prepare(
    `SELECT id, assignation_id, request_id, start_at, duration_minutes, love, created_at, updated_at
     FROM disponibilities WHERE request_id = ? ORDER BY start_at`,
  ).all(requestId) as RawRow[];
  return rows.map((row) => this.mapDisponibility(row));
  }

  listDisponibilitiesForAssignation(assignationId: number, from?: string | Date, to?: string | Date): Disponibility[] {
  this.cleanExpiredIntervals();
  const start = from === undefined ? null : this.normalizeIsoDate(from, "Range start");
  const end = to === undefined ? null : this.normalizeIsoDate(to, "Range end");
  if (start && end && Date.parse(start) >= Date.parse(end)) throw new Error("Range end must be after range start");
  const rows = this.connection.prepare(
    `SELECT id, assignation_id, request_id, start_at, duration_minutes, love, created_at, updated_at
     FROM disponibilities
     WHERE assignation_id = ?
     AND (? IS NULL OR julianday(start_at, '+' || duration_minutes || ' minutes') > julianday(?))
     AND (? IS NULL OR julianday(start_at) < julianday(?))
     ORDER BY start_at`,
  ).all(assignationId, start, start, end, end) as RawRow[];
  return rows.map((row) => this.mapDisponibility(row));
  }

  updateDisponibility(id: number, input: { startAt: string | Date; durationMinutes: number; love: number }): Disponibility {
  this.assertDuration(input.durationMinutes);
  this.assertLove(input.love);
  const current = this.getDisponibilityById(id);
  if (!current) throw new Error("Disponibility not found");
  const startAt = this.normalizeIsoDate(input.startAt, "Disponibility start");
  this.assertNoDisponibilityOverlap(current.assignationId, current.requestId, startAt, input.durationMinutes, id);
  this.connection.prepare(
    "UPDATE disponibilities SET start_at = ?, duration_minutes = ?, love = ?, updated_at = ? WHERE id = ?",
  ).run(startAt, input.durationMinutes, input.love, this.nowIso(), id);
  const item = this.getDisponibilityById(id);
  if (!item) throw new Error("Disponibility not found");
  return item;
  }

  deleteDisponibility(id: number): void {
  this.connection.prepare("DELETE FROM disponibilities WHERE id = ?").run(id);
  }

  createSuggestion(input: CreateSuggestionInput): Suggestion {
  this.assertDuration(input.durationMinutes);
  this.assertLove(input.love);
  const startAt = this.normalizeIsoDate(input.startAt, "Suggestion start");
  const contract = this.getContractById(input.contractId);
  if (!contract) throw new Error("Contract not found");
  this.assertNoSuggestionOverlap(contract.agentId, startAt, input.durationMinutes);
  const now = this.nowIso();
  const result = this.connection.prepare(
    `INSERT INTO suggestions (contract_id, start_at, duration_minutes, love, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(input.contractId, startAt, input.durationMinutes, input.love, now, now);
  return this.getSuggestionById(Number(result.lastInsertRowid))!;
  }

  getSuggestionById(id: number): Suggestion | null {
  const row = this.connection.prepare(
    "SELECT id, contract_id, start_at, duration_minutes, love, created_at, updated_at FROM suggestions WHERE id = ?",
  ).get(id) as RawRow | undefined;
  return row ? this.mapSuggestion(row) : null;
  }

  listSuggestionsForContract(contractId: number, from?: string | Date, to?: string | Date): Suggestion[] {
  this.cleanExpiredIntervals();
  const start = from === undefined ? null : this.normalizeIsoDate(from, "Range start");
  const end = to === undefined ? null : this.normalizeIsoDate(to, "Range end");
  if (start && end && Date.parse(start) >= Date.parse(end)) throw new Error("Range end must be after range start");
  const rows = this.connection.prepare(
    `SELECT id, contract_id, start_at, duration_minutes, love, created_at, updated_at
     FROM suggestions
     WHERE contract_id = ?
     AND (? IS NULL OR julianday(start_at, '+' || duration_minutes || ' minutes') > julianday(?))
     AND (? IS NULL OR julianday(start_at) < julianday(?))
     ORDER BY start_at`,
  ).all(contractId, start, start, end, end) as RawRow[];
  return rows.map((row) => this.mapSuggestion(row));
  }

  updateSuggestion(id: number, input: { startAt: string | Date; durationMinutes: number; love: number }): Suggestion {
  this.assertDuration(input.durationMinutes);
  this.assertLove(input.love);
  const current = this.getSuggestionById(id);
  if (!current) throw new Error("Suggestion not found");
  const contract = this.getContractById(current.contractId);
  if (!contract) throw new Error("Contract not found");
  const startAt = this.normalizeIsoDate(input.startAt, "Suggestion start");
  this.assertNoSuggestionOverlap(contract.agentId, startAt, input.durationMinutes, id);
  this.connection.prepare(
    "UPDATE suggestions SET start_at = ?, duration_minutes = ?, love = ?, updated_at = ? WHERE id = ?",
  ).run(startAt, input.durationMinutes, input.love, this.nowIso(), id);
  const item = this.getSuggestionById(id);
  if (!item) throw new Error("Suggestion not found");
  return item;
  }

  deleteSuggestion(id: number): void {
  this.connection.prepare("DELETE FROM suggestions WHERE id = ?").run(id);
  }

  /** Trim expired intervals and remove fully expired ones as one atomic operation. */
  cleanExpiredIntervals(now: string | Date = new Date()): CleanupResult {
  const reference = this.normalizeIsoDate(now, "Cleanup time");
  return this.withTransaction(() => {
    const expiredDispos = this.connection.prepare(
    `SELECT id FROM disponibilities
     WHERE julianday(start_at, '+' || duration_minutes || ' minutes') <= julianday(?)`,
    ).all(reference) as RawRow[];
    const expiredSuggestions = this.connection.prepare(
    `SELECT id FROM suggestions
     WHERE julianday(start_at, '+' || duration_minutes || ' minutes') <= julianday(?)`,
    ).all(reference) as RawRow[];
    const partialDispos = this.connection.prepare(
    `SELECT id, start_at, duration_minutes FROM disponibilities
     WHERE julianday(start_at) < julianday(?)
       AND julianday(start_at, '+' || duration_minutes || ' minutes') > julianday(?)`,
    ).all(reference, reference) as RawRow[];
    const partialSuggestions = this.connection.prepare(
    `SELECT id, start_at, duration_minutes FROM suggestions
     WHERE julianday(start_at) < julianday(?)
       AND julianday(start_at, '+' || duration_minutes || ' minutes') > julianday(?)`,
    ).all(reference, reference) as RawRow[];
    for (const row of partialDispos) this.trimInterval("disponibilities", Number(row.id), String(row.start_at), Number(row.duration_minutes), reference);
    for (const row of partialSuggestions) this.trimInterval("suggestions", Number(row.id), String(row.start_at), Number(row.duration_minutes), reference);
    this.connection.prepare(
    `DELETE FROM disponibilities
     WHERE julianday(start_at, '+' || duration_minutes || ' minutes') <= julianday(?)`,
    ).run(reference);
    this.connection.prepare(
    `DELETE FROM suggestions
     WHERE julianday(start_at, '+' || duration_minutes || ' minutes') <= julianday(?)`,
    ).run(reference);
    return {
    deletedDisponibilities: expiredDispos.length,
    trimmedDisponibilities: partialDispos.length,
    deletedSuggestions: expiredSuggestions.length,
    trimmedSuggestions: partialSuggestions.length,
    };
  });
  }

  // ---------------------------------------------------------------------------
  // Agenda aggregation and compatible slot discovery
  // ---------------------------------------------------------------------------

  listCompatibleSlotsForConsumer(consumerId: number, from: string | Date, to: string | Date): CompatibleSlot[] {
  this.cleanExpiredIntervals();
  const rangeStart = this.normalizeIsoDate(from, "Range start");
  const rangeEnd = this.normalizeIsoDate(to, "Range end");
  if (Date.parse(rangeStart) >= Date.parse(rangeEnd)) throw new Error("Range end must be after range start");
  const rows = this.connection.prepare(
    `SELECT d.id AS disponibility_id, d.assignation_id, d.request_id,
        d.start_at AS d_start, d.duration_minutes AS d_duration, d.love AS d_love,
        s.id AS suggestion_id, s.start_at AS s_start, s.duration_minutes AS s_duration, s.love AS s_love,
        a.agent_id, ag.name AS agent_name, ag.surname AS agent_surname,
        f.consumer_id, c.company_id
     FROM disponibilities d
     JOIN assignations a ON a.id = d.assignation_id
     JOIN fidelities f ON f.id = a.fidelity_id AND f.active = 1
     JOIN agents ag ON ag.id = a.agent_id AND ag.status <> 'disabled'
     JOIN contracts c ON c.agent_id = a.agent_id AND c.company_id = f.company_id
     JOIN suggestions s ON s.contract_id = c.id
     JOIN availability_requests r ON r.id = d.request_id AND r.status = 'open'
     WHERE f.consumer_id = ?
     AND julianday(d.start_at) < julianday(?)
     AND julianday(d.start_at, '+' || d.duration_minutes || ' minutes') > julianday(?)
     AND julianday(s.start_at) < julianday(?)
     AND julianday(s.start_at, '+' || s.duration_minutes || ' minutes') > julianday(?)
     ORDER BY d.start_at, s.start_at`,
  ).all(consumerId, rangeEnd, rangeStart, rangeEnd, rangeStart) as RawRow[];
  const result: CompatibleSlot[] = [];
  for (const row of rows) {
    const dStart = Date.parse(String(row.d_start));
    const dEnd = dStart + Number(row.d_duration) * 60_000;
    const sStart = Date.parse(String(row.s_start));
    const sEnd = sStart + Number(row.s_duration) * 60_000;
    const startMs = Math.max(dStart, sStart, Date.parse(rangeStart));
    const endMs = Math.min(dEnd, sEnd, Date.parse(rangeEnd));
    if (endMs <= startMs) continue;
    result.push({
    assignationId: Number(row.assignation_id), requestId: Number(row.request_id),
    disponibilityId: Number(row.disponibility_id), suggestionId: Number(row.suggestion_id),
    agentId: Number(row.agent_id), agentName: `${String(row.agent_name)} ${String(row.agent_surname)}`.trim(),
    startAt: new Date(startMs).toISOString(), durationMinutes: Math.floor((endMs - startMs) / 60_000),
    disponibilityLove: Number(row.d_love), suggestionLove: Number(row.s_love),
    });
  }
  return result.filter((slot) => slot.durationMinutes > 0);
  }

  /**
   * All the agent's own opening hours (suggestions) visible to a consumer, one row per assignation.
   * Unlike listCompatibleSlotsForConsumer, this does not require the consumer to have an availability
   * that overlaps: the agent's hours are always returned.
   */
  listAgentSuggestionsForConsumer(consumerId: number, from: string | Date, to: string | Date): Array<Suggestion & { assignationId: number }> {
  this.cleanExpiredIntervals();
  const rangeStart = this.normalizeIsoDate(from, "Range start");
  const rangeEnd = this.normalizeIsoDate(to, "Range end");
  if (Date.parse(rangeStart) >= Date.parse(rangeEnd)) throw new Error("Range end must be after range start");
  const rows = this.connection.prepare(
    `SELECT a.id AS assignation_id, s.*
     FROM suggestions s
     JOIN contracts c ON c.id = s.contract_id
     JOIN assignations a ON a.agent_id = c.agent_id
     JOIN fidelities f ON f.company_id = c.company_id AND f.id = a.fidelity_id
     JOIN agents ag ON ag.id = a.agent_id AND ag.status <> 'disabled'
     WHERE f.consumer_id = ? AND f.active = 1
     AND julianday(s.start_at) < julianday(?)
     AND julianday(s.start_at, '+' || s.duration_minutes || ' minutes') > julianday(?)
     ORDER BY s.start_at`,
  ).all(consumerId, rangeEnd, rangeStart) as RawRow[];
  return rows.map((row) => ({ ...this.mapSuggestion(row), assignationId: Number(row.assignation_id) }));
  }

  getAgendaForConsumer(consumerId: number, from: string | Date, to: string | Date): {
  meetings: Meeting[];
  disponibilities: Disponibility[];
  suggestions: Suggestion[];
  } {
  this.cleanExpiredIntervals();
  const rangeStart = this.normalizeIsoDate(from, "Range start");
  const rangeEnd = this.normalizeIsoDate(to, "Range end");
  if (Date.parse(rangeStart) >= Date.parse(rangeEnd)) throw new Error("Range end must be after range start");
  const meetingRows = this.connection.prepare(
    `SELECT m.* FROM meetings m
     JOIN assignations a ON a.id = m.assignation_id
     JOIN fidelities f ON f.id = a.fidelity_id
     WHERE f.consumer_id = ? AND julianday(m.start_at) < julianday(?)
     AND julianday(m.start_at, '+' || m.duration_minutes || ' minutes') > julianday(?)
     ORDER BY m.start_at`,
  ).all(consumerId, rangeEnd, rangeStart) as RawRow[];
  const dispoRows = this.connection.prepare(
    `SELECT d.* FROM disponibilities d
     JOIN assignations a ON a.id = d.assignation_id JOIN fidelities f ON f.id = a.fidelity_id
     WHERE f.consumer_id = ? AND f.active = 1 AND julianday(d.start_at) < julianday(?)
     AND julianday(d.start_at, '+' || d.duration_minutes || ' minutes') > julianday(?)
     ORDER BY d.start_at`,
  ).all(consumerId, rangeEnd, rangeStart) as RawRow[];
  const suggestionRows = this.connection.prepare(
    `SELECT DISTINCT s.* FROM suggestions s
     JOIN contracts c ON c.id = s.contract_id
     JOIN assignations a ON a.agent_id = c.agent_id
     JOIN fidelities f ON f.company_id = c.company_id AND f.id = a.fidelity_id
     WHERE f.consumer_id = ? AND f.active = 1 AND julianday(s.start_at) < julianday(?)
     AND julianday(s.start_at, '+' || s.duration_minutes || ' minutes') > julianday(?)
     ORDER BY s.start_at`,
  ).all(consumerId, rangeEnd, rangeStart) as RawRow[];
  return {
    meetings: meetingRows.map((row) => this.mapMeeting(row)),
    disponibilities: dispoRows.map((row) => this.mapDisponibility(row)),
    suggestions: suggestionRows.map((row) => this.mapSuggestion(row)),
  };
  }

  getAgendaForAgent(agentId: number, from: string | Date, to: string | Date): {
  meetings: Meeting[];
  suggestions: Suggestion[];
  disponibilities: Disponibility[];
  } {
  this.cleanExpiredIntervals();
  const rangeStart = this.normalizeIsoDate(from, "Range start");
  const rangeEnd = this.normalizeIsoDate(to, "Range end");
  if (Date.parse(rangeStart) >= Date.parse(rangeEnd)) throw new Error("Range end must be after range start");
  const meetingRows = this.connection.prepare(
    `SELECT DISTINCT m.* FROM meetings m
     JOIN assignations a ON a.id = m.assignation_id
     WHERE a.agent_id = ? AND julianday(m.start_at) < julianday(?)
     AND julianday(m.start_at, '+' || m.duration_minutes || ' minutes') > julianday(?)
     ORDER BY m.start_at`,
  ).all(agentId, rangeEnd, rangeStart) as RawRow[];
  const suggestionRows = this.connection.prepare(
    `SELECT s.* FROM suggestions s JOIN contracts c ON c.id = s.contract_id
     WHERE c.agent_id = ? AND julianday(s.start_at) < julianday(?)
     AND julianday(s.start_at, '+' || s.duration_minutes || ' minutes') > julianday(?)
     ORDER BY s.start_at`,
  ).all(agentId, rangeEnd, rangeStart) as RawRow[];
  const dispoRows = this.connection.prepare(
    `SELECT d.* FROM disponibilities d JOIN assignations a ON a.id = d.assignation_id
     JOIN availability_requests r ON r.id = d.request_id
     WHERE a.agent_id = ? AND julianday(d.start_at) < julianday(?)
     AND julianday(d.start_at, '+' || d.duration_minutes || ' minutes') > julianday(?)
     ORDER BY d.start_at`,
  ).all(agentId, rangeEnd, rangeStart) as RawRow[];
  return {
    meetings: meetingRows.map((row) => this.mapMeeting(row)),
    suggestions: suggestionRows.map((row) => this.mapSuggestion(row)),
    disponibilities: dispoRows.map((row) => this.mapDisponibility(row)),
  };
  }

  // ---------------------------------------------------------------------------
  // Meetings and reservation transaction
  // ---------------------------------------------------------------------------

  createMeetingFromAvailability(input: CreateMeetingFromAvailabilityInput): MeetingCreationResult {
  this.assertDuration(input.durationMinutes);
  const startAt = this.normalizeIsoDate(input.startAt, "Meeting start");
  const endAt = this.addMinutes(startAt, input.durationMinutes);
  const now = this.normalizeIsoDate(input.now ?? new Date(), "Current time");
  const idempotencyKey = input.idempotencyKey?.trim() || null;
  const comment = input.comment ?? "";
  if (comment.length > 4000) throw new Error("Meeting comment cannot exceed 4000 characters");
  if (Date.parse(startAt) <= Date.parse(now)) throw new Error("A meeting must start in the future");
  this.cleanExpiredIntervals(now);

  return this.withTransaction(() => {
    if (idempotencyKey) {
    const existingRow = this.connection.prepare("SELECT * FROM meetings WHERE idempotency_key = ?")
      .get(idempotencyKey) as RawRow | undefined;
    if (existingRow) return { meeting: this.mapMeeting(existingRow), alreadyExisted: true };
    }

    const dispoRow = this.connection.prepare(
    `SELECT d.*, r.requested_minutes, r.status AS request_status, f.consumer_id, f.company_id,
        a.agent_id
     FROM disponibilities d
     JOIN availability_requests r ON r.id = d.request_id
     JOIN assignations a ON a.id = d.assignation_id
     JOIN fidelities f ON f.id = a.fidelity_id
     WHERE d.id = ? AND d.request_id = ? AND d.assignation_id = ? AND f.active = 1`,
    ).get(input.disponibilityId, input.requestId, input.assignationId) as RawRow | undefined;
    if (!dispoRow) throw new Error("Disponibility is no longer available for this request");
    // The stored status can lag behind (hours changed, meeting cancelled...): only a closed request refuses meetings,
    // the remaining hours are checked below from the real progress.
    if (String(dispoRow.request_status) === "closed") throw new Error("Availability request is closed");

    const suggestionRow = this.connection.prepare(
    `SELECT s.*, c.agent_id, c.company_id
     FROM suggestions s JOIN contracts c ON c.id = s.contract_id WHERE s.id = ?`,
    ).get(input.suggestionId) as RawRow | undefined;
    if (!suggestionRow) throw new Error("Suggestion is no longer available");
    if (Number(suggestionRow.agent_id) !== Number(dispoRow.agent_id) || Number(suggestionRow.company_id) !== Number(dispoRow.company_id)) {
    throw new Error("Suggestion does not belong to the assigned agent and company");
    }

    // A meeting may span adjacent availability rows belonging to the same request.
    // Walk the sorted intervals to ensure there are no gaps in the requested time range.
    const availabilityRows = this.connection.prepare(
      `SELECT * FROM disponibilities
       WHERE assignation_id = ? AND request_id = ? ORDER BY start_at`,
    ).all(input.assignationId, input.requestId) as RawRow[];
    if (!this.rowsCover(availabilityRows, startAt, endAt)) {
      throw new Error("Meeting must fit within continuous consumer availability");
    }
    // Same for the agent: adjacent suggestions (e.g. of different preferences) can jointly cover the meeting.
    const suggestionRows = this.connection.prepare(
      "SELECT * FROM suggestions WHERE contract_id = ? ORDER BY start_at",
    ).all(Number(suggestionRow.contract_id)) as RawRow[];
    if (!this.rowsCover(suggestionRows, startAt, endAt)) {
      throw new Error("Selected interval is outside the available suggestion");
    }

    const progress = this.getAvailabilityRequestProgress(input.requestId);
    if (!progress || progress.remainingMinutes < input.durationMinutes) {
    throw new Error("Meeting duration exceeds the remaining requested hours");
    }

    const conflictingMeeting = this.connection.prepare(
    `SELECT m.id FROM meetings m
     JOIN assignations ma ON ma.id = m.assignation_id
     JOIN fidelities mf ON mf.id = ma.fidelity_id
     WHERE m.status <> 'canceledBy'
       AND (ma.agent_id = ? OR mf.consumer_id = ?)
       AND julianday(m.start_at) < julianday(?)
       AND julianday(m.start_at, '+' || m.duration_minutes || ' minutes') > julianday(?)
     LIMIT 1`,
    ).get(Number(dispoRow.agent_id), Number(dispoRow.consumer_id), endAt, startAt) as RawRow | undefined;
    if (conflictingMeeting) throw new Error("The agent or consumer already has a meeting during this interval");

    let roomCompanyId: number | null = null;
    let roomName: string | null = null;
    if (input.roomName !== undefined && input.roomName !== null && input.roomName.trim() !== "") {
    roomName = this.requiredText(input.roomName, "Room name", 120);
    roomCompanyId = Number(dispoRow.company_id);
    const room = this.getRoom(roomCompanyId, roomName);
    if (!room || !room.active) throw new Error("Room does not exist or is inactive for this company");
    if (!this.isRoomAvailable(roomCompanyId, roomName, startAt, input.durationMinutes)) {
      throw new Error("Room capacity would be exceeded for the selected interval");
    }
    }

    const insert = this.connection.prepare(
    `INSERT INTO meetings (
       assignation_id, availability_request_id, source_contract_id,
       source_disponibility_love, source_suggestion_love, start_at, duration_minutes,
       status, room_company_id, room_name, comment, idempotency_key, hourly_rate, society_rate, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
    input.assignationId, input.requestId, Number(suggestionRow.contract_id), Number(dispoRow.love),
    Number(suggestionRow.love), startAt, input.durationMinutes, roomCompanyId, roomName, comment,
    idempotencyKey, this.resolveHourlyRate(input.assignationId), this.getSocietyRate(Number(dispoRow.company_id)), now, now,
    );
    const meetingId = Number(insert.lastInsertRowid);

    // Consume the booked range from every interval it intersects (adjacent rows can jointly cover a meeting).
    for (const part of this.intersections(availabilityRows, startAt, endAt)) {
      this.splitDisponibility(this.mapDisponibility(part.row), part.start, part.minutes);
    }
    for (const part of this.intersections(suggestionRows, startAt, endAt)) {
      this.splitSuggestion(this.mapSuggestion(part.row), part.start, part.minutes);
    }
    const progressAfter = this.getAvailabilityRequestProgress(input.requestId)!;
    this.connection.prepare("UPDATE availability_requests SET status = ?, updated_at = ? WHERE id = ?")
      .run(progressAfter.remainingMinutes <= 0 ? "fulfilled" : "open", now, input.requestId);
    return { meeting: this.getMeetingById(meetingId)!, alreadyExisted: false };
  });
  }

  createStandaloneMeeting(input: {
  assignationId: number;
  startAt: string | Date;
  durationMinutes: number;
  roomName?: string | null;
  comment?: string;
  status?: MeetingStatus;
  }): Meeting {
  this.assertDuration(input.durationMinutes);
  const startAt = this.normalizeIsoDate(input.startAt, "Meeting start");
  const status = input.status ?? "pending";
  this.assertMeetingStatus(status);
  const comment = input.comment ?? "";
  if (comment.length > 4000) throw new Error("Meeting comment cannot exceed 4000 characters");
  return this.withTransaction(() => {
    const context = this.connection.prepare(
    `SELECT a.agent_id, f.company_id FROM assignations a JOIN fidelities f ON f.id = a.fidelity_id
     WHERE a.id = ? AND f.active = 1`,
    ).get(input.assignationId) as RawRow | undefined;
    if (!context) throw new Error("Assignation is not active or does not exist");
    const startEnd = this.addMinutes(startAt, input.durationMinutes);
    const conflict = this.connection.prepare(
    `SELECT m.id FROM meetings m JOIN assignations ma ON ma.id = m.assignation_id
     JOIN fidelities mf ON mf.id = ma.fidelity_id
     WHERE m.status <> 'canceledBy' AND (ma.agent_id = ? OR mf.consumer_id = (
       SELECT f2.consumer_id FROM assignations a2 JOIN fidelities f2 ON f2.id = a2.fidelity_id WHERE a2.id = ?
     )) AND julianday(m.start_at) < julianday(?)
       AND julianday(m.start_at, '+' || m.duration_minutes || ' minutes') > julianday(?) LIMIT 1`,
    ).get(Number(context.agent_id), input.assignationId, startEnd, startAt) as RawRow | undefined;
    if (conflict) throw new Error("The agent or consumer already has a meeting during this interval");
    let roomCompanyId: number | null = null;
    let roomName: string | null = null;
    if (input.roomName?.trim()) {
    roomName = this.requiredText(input.roomName, "Room name", 120);
    roomCompanyId = Number(context.company_id);
    const room = this.getRoom(roomCompanyId, roomName);
    if (!room || !room.active || !this.isRoomAvailable(roomCompanyId, roomName, startAt, input.durationMinutes)) {
      throw new Error("Room does not exist, is inactive, or has insufficient capacity");
    }
    }
    const now = this.nowIso();
    const result = this.connection.prepare(
    `INSERT INTO meetings (assignation_id, start_at, duration_minutes, status, room_company_id,
      room_name, comment, hourly_rate, society_rate, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(input.assignationId, startAt, input.durationMinutes, status, roomCompanyId, roomName, comment,
      this.resolveHourlyRate(input.assignationId), this.getSocietyRate(Number(context.company_id)), now, now);
    return this.getMeetingById(Number(result.lastInsertRowid))!;
  });
  }

  getMeetingById(id: number): Meeting | null {
  const row = this.connection.prepare("SELECT * FROM meetings WHERE id = ?").get(id) as RawRow | undefined;
  return row ? this.mapMeeting(row) : null;
  }

  listMeetingsForAssignation(assignationId: number, from?: string | Date, to?: string | Date): Meeting[] {
  const start = from === undefined ? null : this.normalizeIsoDate(from, "Range start");
  const end = to === undefined ? null : this.normalizeIsoDate(to, "Range end");
  if (start && end && Date.parse(start) >= Date.parse(end)) throw new Error("Range end must be after range start");
  const rows = this.connection.prepare(
    `SELECT * FROM meetings WHERE assignation_id = ?
     AND (? IS NULL OR julianday(start_at, '+' || duration_minutes || ' minutes') > julianday(?))
     AND (? IS NULL OR julianday(start_at) < julianday(?))
     ORDER BY start_at`,
  ).all(assignationId, start, start, end, end) as RawRow[];
  return rows.map((row) => this.mapMeeting(row));
  }

  listMeetingsForCompany(companyId: number, from?: string | Date, to?: string | Date): Meeting[] {
  const start = from === undefined ? null : this.normalizeIsoDate(from, "Range start");
  const end = to === undefined ? null : this.normalizeIsoDate(to, "Range end");
  if (start && end && Date.parse(start) >= Date.parse(end)) throw new Error("Range end must be after range start");
  const rows = this.connection.prepare(
    `SELECT DISTINCT m.* FROM meetings m
     JOIN assignations a ON a.id = m.assignation_id
     JOIN fidelities f ON f.id = a.fidelity_id
     WHERE f.company_id = ?
     AND (? IS NULL OR julianday(m.start_at, '+' || m.duration_minutes || ' minutes') > julianday(?))
     AND (? IS NULL OR julianday(m.start_at) < julianday(?))
     ORDER BY m.start_at`,
  ).all(companyId, start, start, end, end) as RawRow[];
  return rows.map((row) => this.mapMeeting(row));
  }

  updateMeetingComment(id: number, comment: string): Meeting {
  if (comment.length > 4000) throw new Error("Meeting comment cannot exceed 4000 characters");
  this.connection.prepare("UPDATE meetings SET comment = ?, updated_at = ? WHERE id = ?")
    .run(comment, this.nowIso(), id);
  const meeting = this.getMeetingById(id);
  if (!meeting) throw new Error("Meeting not found");
  return meeting;
  }

  setMeetingRoom(id: number, roomName: string | null): Meeting {
  return this.withTransaction(() => {
    const meeting = this.getMeetingById(id);
    if (!meeting) throw new Error("Meeting not found");
    if (meeting.status !== "pending") throw new Error("Only pending meetings can change rooms");
    let roomCompanyId: number | null = null;
    let cleanRoomName: string | null = null;
    if (roomName?.trim()) {
    cleanRoomName = this.requiredText(roomName, "Room name", 120);
    const companyRow = this.connection.prepare(
      `SELECT f.company_id FROM assignations a JOIN fidelities f ON f.id = a.fidelity_id WHERE a.id = ?`,
    ).get(meeting.assignationId) as RawRow | undefined;
    if (!companyRow) throw new Error("Assignation not found");
    roomCompanyId = Number(companyRow.company_id);
    const room = this.getRoom(roomCompanyId, cleanRoomName);
    if (!room || !room.active || !this.isRoomAvailable(roomCompanyId, cleanRoomName, meeting.startAt, meeting.durationMinutes, meeting.id)) {
      throw new Error("Room does not exist, is inactive, or has insufficient capacity");
    }
    }
    this.connection.prepare(
    "UPDATE meetings SET room_company_id = ?, room_name = ?, updated_at = ? WHERE id = ?",
    ).run(roomCompanyId, cleanRoomName, this.nowIso(), id);
    return this.getMeetingById(id)!;
  });
  }

  markMeetingDone(id: number): Meeting {
  this.connection.prepare(
    "UPDATE meetings SET status = 'done', updated_at = ? WHERE id = ? AND status = 'pending'",
  ).run(this.nowIso(), id);
  const meeting = this.getMeetingById(id);
  if (!meeting) throw new Error("Meeting not found");
  if (meeting.status !== "done") throw new Error("Only pending meetings can be marked as done");
  return meeting;
  }

  /** Cancel a meeting and restore its future availability only when restoration cannot overlap existing intervals. */
  cancelMeeting(id: number, actorRole: Role, actorId: number, now: string | Date = new Date()): Meeting {
  this.assertRole(actorRole);
  this.assertInteger(actorId, "Actor id", 1);
  const reference = this.normalizeIsoDate(now, "Cancellation time");
  return this.withTransaction(() => {
    const meeting = this.getMeetingById(id);
    if (!meeting) throw new Error("Meeting not found");
    if (meeting.status === "canceledBy") return meeting;
    if (meeting.status !== "pending") throw new Error("Only pending meetings can be canceled");
    this.connection.prepare(
    `UPDATE meetings SET status = 'canceledBy', canceled_by_role = ?, canceled_by_id = ?, updated_at = ? WHERE id = ?`,
    ).run(actorRole, actorId, reference, id);
    if (Date.parse(meeting.startAt) > Date.parse(reference) && meeting.availabilityRequestId !== null &&
      meeting.sourceContractId !== null && meeting.sourceDisponibilityLove !== null && meeting.sourceSuggestionLove !== null) {
    const request = this.getAvailabilityRequest(meeting.availabilityRequestId);
    if (request && request.status !== "closed") {
      const timestamp = this.nowIso();
      const endAt = this.addMinutes(meeting.startAt, meeting.durationMinutes);
      const dispoOverlap = this.connection.prepare(
      `SELECT id FROM disponibilities WHERE assignation_id = ? AND request_id = ?
       AND julianday(start_at) < julianday(?)
       AND julianday(start_at, '+' || duration_minutes || ' minutes') > julianday(?) LIMIT 1`,
      ).get(meeting.assignationId, request.id, endAt, meeting.startAt) as RawRow | undefined;
      if (!dispoOverlap) {
      const restored = this.connection.prepare(
        `INSERT INTO disponibilities (assignation_id, request_id, start_at, duration_minutes, love, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(meeting.assignationId, request.id, meeting.startAt, meeting.durationMinutes,
        meeting.sourceDisponibilityLove, timestamp, timestamp);
      // The freed slot may touch availabilities of the same preference: they become one single availability.
      this.mergeTouchingIntervals("disponibilities", Number(restored.lastInsertRowid));
      }
      const suggestionOverlap = this.connection.prepare(
      `SELECT s.id FROM suggestions s JOIN contracts c ON c.id = s.contract_id
       WHERE c.agent_id = (SELECT agent_id FROM contracts WHERE id = ?)
         AND julianday(s.start_at) < julianday(?)
         AND julianday(s.start_at, '+' || s.duration_minutes || ' minutes') > julianday(?) LIMIT 1`,
      ).get(meeting.sourceContractId, endAt, meeting.startAt) as RawRow | undefined;
      if (!suggestionOverlap) {
      const restored = this.connection.prepare(
        `INSERT INTO suggestions (contract_id, start_at, duration_minutes, love, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(meeting.sourceContractId, meeting.startAt, meeting.durationMinutes,
        meeting.sourceSuggestionLove, timestamp, timestamp);
      // Same for the agent's opening hours.
      this.mergeTouchingIntervals("suggestions", Number(restored.lastInsertRowid));
      }
      const progress = this.getAvailabilityRequestProgress(request.id)!;
      if (progress.remainingMinutes > 0 && request.status === "fulfilled") {
      this.connection.prepare("UPDATE availability_requests SET status = 'open', updated_at = ? WHERE id = ?")
        .run(timestamp, request.id);
      }
    }
    }
    return this.getMeetingById(id)!;
  });
  }

  // ---------------------------------------------------------------------------
  // Internal mapping, validation, interval, and SQL helpers
  // ---------------------------------------------------------------------------

  private ensureOpen(): void {
  if (this.closed) throw new Error("Database connection is closed");
  }

  private nowIso(): string {
  return new Date().toISOString();
  }

  private normalizeIsoDate(value: string | Date, label: string): string {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid date`);
  return new Date(parsed).toISOString();
  }

  private addMinutes(startAt: string, durationMinutes: number): string {
  return new Date(Date.parse(startAt) + durationMinutes * 60_000).toISOString();
  }

  private requiredText(value: string, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${label} must be text`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) throw new Error(`${label} must contain 1 to ${maxLength} characters`);
  return trimmed;
  }

  private assertInteger(value: number, label: string, min: number): void {
  if (!Number.isInteger(value) || value < min) throw new Error(`${label} must be an integer greater than or equal to ${min}`);
  }

  private assertDuration(durationMinutes: number): void {
  this.assertInteger(durationMinutes, "Duration", 1);
  if (durationMinutes > MAX_INTERVAL_MINUTES) throw new Error(`Duration cannot exceed ${MAX_INTERVAL_MINUTES} minutes`);
  }

  private assertLove(love: number): void {
  if (!Number.isFinite(love) || love < LOVE_MIN || love > LOVE_MAX) {
    throw new Error(`Preference (love) must be between ${LOVE_MIN} and ${LOVE_MAX}`);
  }
  }

  private assertRole(role: string): asserts role is Role {
  if (!["admin", "agent", "consumer"].includes(role)) throw new Error("Invalid actor role");
  }

  private assertAgentStatus(status: string): asserts status is AgentStatus {
  if (!["pending", "active", "disabled"].includes(status)) throw new Error("Invalid agent status");
  }

  private assertRequestStatus(status: string): asserts status is AvailabilityRequestStatus {
  if (!["open", "fulfilled", "closed"].includes(status)) throw new Error("Invalid availability request status");
  }

  private assertMeetingStatus(status: string): asserts status is MeetingStatus {
  if (!["pending", "done", "canceledBy"].includes(status)) throw new Error("Invalid meeting status");
  }

  private generateUniqueKey(): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let key = "";
    for (let index = 0; index < KEY_LENGTH; index += 1) key += KEY_ALPHABET[randomInt(KEY_ALPHABET.length)];
    const exists = this.connection.prepare(
    "SELECT 1 AS found FROM consumers WHERE key = ? UNION ALL SELECT 1 AS found FROM fidelities WHERE key = ? LIMIT 1",
    ).get(key, key);
    if (!exists) return key;
  }
  throw new Error("Could not generate a unique access key after 100 attempts");
  }

  /** True when the rows (start_at, duration_minutes, sorted by start) cover [start, end) without any gap. */
  private rowsCover(rows: RawRow[], start: string, end: string): boolean {
  const endMs = Date.parse(end);
  let coveredUntil = Date.parse(start);
  for (const row of rows) {
    const rowStart = Date.parse(String(row.start_at));
    const rowEnd = rowStart + Number(row.duration_minutes) * 60_000;
    if (rowEnd <= coveredUntil) continue;
    if (rowStart > coveredUntil) break;
    coveredUntil = rowEnd;
    if (coveredUntil >= endMs) return true;
  }
  return coveredUntil >= endMs;
  }

  /** Part of each row that intersects [start, end), as a start date and a duration in minutes. */
  private intersections(rows: RawRow[], start: string, end: string): Array<{ row: RawRow; start: string; minutes: number }> {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  const out: Array<{ row: RawRow; start: string; minutes: number }> = [];
  for (const row of rows) {
    const rowStart = Date.parse(String(row.start_at));
    const rowEnd = rowStart + Number(row.duration_minutes) * 60_000;
    const s = Math.max(rowStart, startMs);
    const e = Math.min(rowEnd, endMs);
    if (e > s) out.push({ row, start: new Date(s).toISOString(), minutes: Math.floor((e - s) / 60_000) });
  }
  return out;
  }


  private assertNoDisponibilityOverlap(
  assignationId: number,
  requestId: number,
  startAt: string,
  durationMinutes: number,
  excludeId?: number,
  ): void {
  const endAt = this.addMinutes(startAt, durationMinutes);
  const overlap = this.connection.prepare(
    `SELECT id FROM disponibilities
     WHERE assignation_id = ? AND request_id = ? AND (? IS NULL OR id <> ?)
     AND julianday(start_at) < julianday(?)
     AND julianday(start_at, '+' || duration_minutes || ' minutes') > julianday(?)
     LIMIT 1`,
  ).get(assignationId, requestId, excludeId ?? null, excludeId ?? null, endAt, startAt);
  if (overlap) throw new Error("Disponibilities in the same request cannot overlap");
  }

  private assertNoSuggestionOverlap(
  agentId: number,
  startAt: string,
  durationMinutes: number,
  excludeId?: number,
  ): void {
  const endAt = this.addMinutes(startAt, durationMinutes);
  const overlap = this.connection.prepare(
    `SELECT s.id FROM suggestions s JOIN contracts c ON c.id = s.contract_id
     WHERE c.agent_id = ? AND (? IS NULL OR s.id <> ?)
     AND julianday(s.start_at) < julianday(?)
     AND julianday(s.start_at, '+' || s.duration_minutes || ' minutes') > julianday(?)
     LIMIT 1`,
  ).get(agentId, excludeId ?? null, excludeId ?? null, endAt, startAt);
  if (overlap) throw new Error("Suggestions for the same agent cannot overlap");
  }

  private splitDisponibility(disponibility: Disponibility, consumedStart: string, consumedDuration: number): void {
  const oldStartMs = Date.parse(disponibility.startAt);
  const oldEndMs = oldStartMs + disponibility.durationMinutes * 60_000;
  const newStartMs = Date.parse(consumedStart);
  const newEndMs = newStartMs + consumedDuration * 60_000;
  this.connection.prepare("DELETE FROM disponibilities WHERE id = ?").run(disponibility.id);
  const timestamp = this.nowIso();
  if (newStartMs > oldStartMs) {
    const leftMinutes = Math.floor((newStartMs - oldStartMs) / 60_000);
    if (leftMinutes > 0) this.connection.prepare(
    `INSERT INTO disponibilities (assignation_id, request_id, start_at, duration_minutes, love, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(disponibility.assignationId, disponibility.requestId, disponibility.startAt, leftMinutes, disponibility.love, timestamp, timestamp);
  }
  if (newEndMs < oldEndMs) {
    const rightMinutes = Math.floor((oldEndMs - newEndMs) / 60_000);
    if (rightMinutes > 0) this.connection.prepare(
    `INSERT INTO disponibilities (assignation_id, request_id, start_at, duration_minutes, love, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(disponibility.assignationId, disponibility.requestId, new Date(newEndMs).toISOString(), rightMinutes, disponibility.love, timestamp, timestamp);
  }
  }

  private splitSuggestion(suggestion: Suggestion, consumedStart: string, consumedDuration: number): void {
  const oldStartMs = Date.parse(suggestion.startAt);
  const oldEndMs = oldStartMs + suggestion.durationMinutes * 60_000;
  const newStartMs = Date.parse(consumedStart);
  const newEndMs = newStartMs + consumedDuration * 60_000;
  this.connection.prepare("DELETE FROM suggestions WHERE id = ?").run(suggestion.id);
  const timestamp = this.nowIso();
  if (newStartMs > oldStartMs) {
    const leftMinutes = Math.floor((newStartMs - oldStartMs) / 60_000);
    if (leftMinutes > 0) this.connection.prepare(
    `INSERT INTO suggestions (contract_id, start_at, duration_minutes, love, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(suggestion.contractId, suggestion.startAt, leftMinutes, suggestion.love, timestamp, timestamp);
  }
  if (newEndMs < oldEndMs) {
    const rightMinutes = Math.floor((oldEndMs - newEndMs) / 60_000);
    if (rightMinutes > 0) this.connection.prepare(
    `INSERT INTO suggestions (contract_id, start_at, duration_minutes, love, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(suggestion.contractId, new Date(newEndMs).toISOString(), rightMinutes, suggestion.love, timestamp, timestamp);
  }
  }

  /**
   * Merge an interval with the intervals of the same owner that touch it (end = start) and have the same preference.
   * The interval with the given id absorbs them (before and after, repeatedly), so a restored slot sitting between
   * two slots of equal preference gives back a single long interval. Intervals of another preference are never touched,
   * and a merge that would exceed the maximum interval length is skipped.
   * Owner of a disponibility = same assignation and same request; owner of a suggestion = same contract.
   */
  private mergeTouchingIntervals(table: "disponibilities" | "suggestions", id: number): void {
  const ownerColumns = table === "disponibilities" ? ["assignation_id", "request_id"] : ["contract_id"];
  const current = this.connection.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as RawRow | undefined;
  if (!current) return;
  const owner = ownerColumns.map((column) => current[column]);
  // Normalize missing SQLite values to NULL before binding; node:sqlite does not accept undefined.
   const siblings = this.connection.prepare(
    `SELECT * FROM ${table} WHERE ${ownerColumns.map((column) => `${column} = ?`).join(" AND ")} AND id <> ?`,
  ).all(...owner.map((value) => value ?? null), id) as RawRow[];
  const love = Number(current.love);
  let start = Date.parse(String(current.start_at));
  let end = start + Number(current.duration_minutes) * 60_000;
  const absorbed = new Set<number>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const sibling of siblings) {
    const siblingId = Number(sibling.id);
    if (absorbed.has(siblingId) || Math.abs(Number(sibling.love) - love) > LOVE_EPSILON) continue;
    const siblingStart = Date.parse(String(sibling.start_at));
    const siblingEnd = siblingStart + Number(sibling.duration_minutes) * 60_000;
    if (siblingEnd !== start && siblingStart !== end) continue; // not touching
    const mergedStart = Math.min(start, siblingStart);
    const mergedEnd = Math.max(end, siblingEnd);
    if ((mergedEnd - mergedStart) / 60_000 > MAX_INTERVAL_MINUTES) continue;
    start = mergedStart; end = mergedEnd;
    absorbed.add(siblingId);
    changed = true;
    }
  }
  if (!absorbed.size) return;
  const remove = this.connection.prepare(`DELETE FROM ${table} WHERE id = ?`);
  for (const siblingId of absorbed) remove.run(siblingId);
  this.connection.prepare(`UPDATE ${table} SET start_at = ?, duration_minutes = ?, updated_at = ? WHERE id = ?`)
    .run(new Date(start).toISOString(), Math.round((end - start) / 60_000), this.nowIso(), id);
  }

  private trimInterval(table: "disponibilities" | "suggestions", id: number, oldStart: string, oldDuration: number, now: string): void {
  const oldEndMs = Date.parse(oldStart) + oldDuration * 60_000;
  const nowMs = Date.parse(now);
  const remainingMinutes = Math.floor((oldEndMs - nowMs) / 60_000);
  if (remainingMinutes <= 0) {
    this.connection.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    return;
  }
  this.connection.prepare(`UPDATE ${table} SET start_at = ?, duration_minutes = ?, updated_at = ? WHERE id = ?`)
    .run(now, remainingMinutes, now, id);
  }

  private peakOverlapCount(
  intervals: Array<{ startAt: string; durationMinutes: number }>,
  requestStart: string,
  requestEnd: string,
  ): number {
  const requestStartMs = Date.parse(requestStart);
  const requestEndMs = Date.parse(requestEnd);
  const events: Array<{ time: number; delta: number }> = [];
  for (const interval of intervals) {
    const startMs = Math.max(requestStartMs, Date.parse(interval.startAt));
    const endMs = Math.min(requestEndMs, Date.parse(interval.startAt) + interval.durationMinutes * 60_000);
    if (endMs <= startMs) continue;
    events.push({ time: startMs, delta: 1 }, { time: endMs, delta: -1 });
  }
  events.sort((left, right) => left.time - right.time || left.delta - right.delta);
  let current = 0;
  let peak = 0;
  for (const event of events) {
    current += event.delta;
    peak = Math.max(peak, current);
  }
  return peak;
  }

  private mapCompany(row: RawRow): Company {
  return {
    id: Number(row.id), name: String(row.name),
    societyRate: row.society_rate === null || row.society_rate === undefined ? DEFAULT_SOCIETY_RATE : Number(row.society_rate),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
  }

  private mapAdmin(row: RawRow): Admin {
  return {
    id: Number(row.id), username: String(row.username), displayName: String(row.display_name), createdAt: String(row.created_at),
  };
  }

  private mapPrivilege(row: RawRow): Privilege {
  return { id: Number(row.id), adminId: Number(row.admin_id), companyId: Number(row.company_id), level: Number(row.level) };
  }

  private mapAgent(row: RawRow): Agent {
  return {
    id: Number(row.id), name: String(row.name), surname: String(row.surname), username: String(row.username),
    status: String(row.status) as AgentStatus, createdAt: String(row.created_at),
  };
  }

  private mapAgentCredentials(row: RawRow): AgentCredentials {
  return {
    ...this.mapAgent(row),
    passwordHash: row.password_hash === null || row.password_hash === undefined ? null : String(row.password_hash),
  };
  }

  private mapConsumer(row: RawRow): Consumer {
  return {
    id: Number(row.id), name: String(row.name), surname: String(row.surname),
    username: String(row.username), createdAt: String(row.created_at),
  };
  }

  private mapConsumerCredentials(row: RawRow): ConsumerCredentials {
  return {
    ...this.mapConsumer(row),
    personalKey: String(row.key),
    passwordHash: row.password_hash === null || row.password_hash === undefined ? null : String(row.password_hash),
  };
  }

  private mapFidelity(row: RawRow): Fidelity {
  return {
    id: Number(row.id), key: String(row.key), companyId: Number(row.company_id), consumerId: Number(row.consumer_id),
    active: Number(row.active) === 1,
    defaultPackageId: row.default_package_id === null || row.default_package_id === undefined ? null : Number(row.default_package_id),
    createdAt: String(row.created_at),
  };
  }

  private mapContract(row: RawRow): Contract {
  return { id: Number(row.id), agentId: Number(row.agent_id), companyId: Number(row.company_id), createdAt: String(row.created_at) };
  }

  private mapAssignation(row: RawRow): Assignation {
  return {
    id: Number(row.id), agentId: Number(row.agent_id), fidelityId: Number(row.fidelity_id),
    packageId: row.package_id === null || row.package_id === undefined ? null : Number(row.package_id),
    createdAt: String(row.created_at),
  };
  }

  private mapRoom(row: RawRow): Room {
  return {
    companyId: Number(row.company_id), name: String(row.name), limit: Number(row.limit_count), active: Number(row.active) === 1,
    position: Number(row.position ?? 0), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
  }

  private mapAvailabilityRequest(row: RawRow): AvailabilityRequest {
  return {
    id: Number(row.id), assignationId: Number(row.assignation_id), requestedMinutes: Number(row.requested_minutes),
    status: String(row.status) as AvailabilityRequestStatus, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
  }

  private mapDisponibility(row: RawRow): Disponibility {
  return {
    id: Number(row.id), assignationId: Number(row.assignation_id), requestId: Number(row.request_id),
    startAt: String(row.start_at), durationMinutes: Number(row.duration_minutes), love: Number(row.love),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
  }

  private mapSuggestion(row: RawRow): Suggestion {
  return {
    id: Number(row.id), contractId: Number(row.contract_id), startAt: String(row.start_at),
    durationMinutes: Number(row.duration_minutes), love: Number(row.love),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
  }

  private mapMeeting(row: RawRow): Meeting {
  const hourlyRate = Number(row.hourly_rate ?? 0);
  const societyRate = row.society_rate === null || row.society_rate === undefined ? DEFAULT_SOCIETY_RATE : Number(row.society_rate);
  // The price already includes the company's share: price = agent amount * (1 + rate / 100).
  const agentHourlyRate = hourlyRate / (1 + societyRate / 100);
  return {
    id: Number(row.id), assignationId: Number(row.assignation_id),
    availabilityRequestId: row.availability_request_id === null || row.availability_request_id === undefined ? null : Number(row.availability_request_id),
    sourceContractId: row.source_contract_id === null || row.source_contract_id === undefined ? null : Number(row.source_contract_id),
    sourceDisponibilityLove: row.source_disponibility_love === null || row.source_disponibility_love === undefined ? null : Number(row.source_disponibility_love),
    sourceSuggestionLove: row.source_suggestion_love === null || row.source_suggestion_love === undefined ? null : Number(row.source_suggestion_love),
    startAt: String(row.start_at), durationMinutes: Number(row.duration_minutes), status: String(row.status) as MeetingStatus,
    roomCompanyId: row.room_company_id === null || row.room_company_id === undefined ? null : Number(row.room_company_id),
    roomName: row.room_name === null || row.room_name === undefined ? null : String(row.room_name),
    hourlyRate,
    societyRate,
    agentHourlyRate,
    societyHourlyRate: hourlyRate - agentHourlyRate,
    comment: String(row.comment ?? ""),
    canceledByRole: row.canceled_by_role === null || row.canceled_by_role === undefined ? null : String(row.canceled_by_role) as Role,
    canceledById: row.canceled_by_id === null || row.canceled_by_id === undefined ? null : Number(row.canceled_by_id),
    idempotencyKey: row.idempotency_key === null || row.idempotency_key === undefined ? null : String(row.idempotency_key),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
  }
}

export default Database;
