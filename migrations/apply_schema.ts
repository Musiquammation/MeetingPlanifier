// Brings a database up to the schema of the current code (server/Database.ts: initialize + migrate).
// Used by the migration scripts of this folder: tsx migrations/apply_schema.ts path/to/database.sqlite
import { Database } from "../server/Database";

const path = process.argv[2];
if (!path) {
	console.error("Usage: tsx migrations/apply_schema.ts path/to/database.sqlite");
	process.exit(1);
}
new Database(path).close();
