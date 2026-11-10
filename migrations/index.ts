// Versioned migrations of the database. Migration N brings the data from version N - 1 to version N
// (N is a VERSION_NUMBER, see server/VERSION_NUMBER.ts). To add one:
//   1. raise VERSION_NUMBER in server/VERSION_NUMBER.ts;
//   2. write migrations/migration_<N>.ts (an object { version: N, description, up });
//   3. list it in MIGRATIONS below;
//   4. update Database.SCHEMA_SQL too, so that a new database gets the final schema directly.
// Each migration runs in a transaction; a copy of the database is made before the first one.
import migration2 from "./migration_2";

export interface MigrationTools {
	/** Runs SQL. */
	exec(sql: string): void;
	/** Adds a column if it is not there yet (definition: everything after the column name). */
	addColumn(table: string, column: string, definition: string): void;
	hasColumn(table: string, column: string): boolean;
}

export interface Migration {
	version: number;
	description: string;
	up(tools: MigrationTools): void;
}

export const MIGRATIONS: Migration[] = [migration2];
