#!/usr/bin/env bash
# Migration of the database to v1.1.0.
#
# v1.1.0 adds:
#   - the tables `generators` and `generator_cancellations` (habits: weekly repetitions and cancelled weeks);
#   - the columns `generator_id` and `generator_occurrence` on `disponibilities` and `suggestions`;
#   - the column `actual_duration_minutes` on `meetings` (duration really spent, given when validating).
#
# The schema changes themselves live in server/Database.ts (initialize + migrate), which the server also runs
# at start-up: this script makes the upgrade explicit and safe. It
#   1. backs the database up (consistent copy, even if the server is running),
#   2. applies the schema of v1.1.0,
#   3. checks that every new table and column is there.
# It can be run several times: an up-to-date database is left as it is.
#
# Usage (from anywhere, dependencies installed with `npm install`):
#   migrations/migration_1_1_0.sh [path/to/database.sqlite]
# Default path: $DATABASE_PATH, else dist/database.sqlite (the path used by the server).
# Stop the server during the migration, then start the v1.1.0 server.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DB="${1:-${DATABASE_PATH:-dist/database.sqlite}}"
DB="$(echo "$DB" | xargs)" # .env values may carry spaces
case "$DB" in /*) ;; *) DB="$ROOT/$DB" ;; esac

if [ ! -f "$DB" ]; then
	echo "Base introuvable : $DB" >&2
	echo "Indiquez son chemin : $0 chemin/vers/database.sqlite" >&2
	exit 1
fi
if [ ! -x node_modules/.bin/tsx ]; then
	echo "tsx est introuvable : lancez d'abord « npm install »." >&2
	exit 1
fi

BACKUP="${DB%.sqlite}.before-1.1.0.$(date +%Y%m%d-%H%M%S).sqlite"
echo "== Migration v1.1.0 de $DB"

# 1. Backup (VACUUM INTO gives a consistent copy, WAL included)
node --no-warnings -e '
	const { DatabaseSync } = require("node:sqlite");
	const [db, backup] = process.argv.slice(1);
	const c = new DatabaseSync(db);
	c.prepare("VACUUM INTO ?").run(backup);
	c.close();
' "$DB" "$BACKUP"
echo "   Sauvegarde : $BACKUP"

# 2. Schema of v1.1.0 (idempotent: CREATE IF NOT EXISTS + ALTER TABLE only for missing columns)
node --no-warnings --import tsx migrations/apply_schema.ts "$DB"
echo "   Schéma appliqué."

# 3. Check
node --no-warnings -e '
	const { DatabaseSync } = require("node:sqlite");
	const c = new DatabaseSync(process.argv[1], { readOnly: true });
	const tables = new Set(c.prepare("SELECT name FROM sqlite_master WHERE type = ?").all("table").map((r) => r.name));
	const columns = (t) => new Set(c.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name));
	const missing = [];
	for (const t of ["generators", "generator_cancellations"]) if (!tables.has(t)) missing.push(`table ${t}`);
	for (const t of ["disponibilities", "suggestions"]) for (const col of ["generator_id", "generator_occurrence"]) if (!columns(t).has(col)) missing.push(`${t}.${col}`);
	if (!columns("meetings").has("actual_duration_minutes")) missing.push("meetings.actual_duration_minutes");
	const fk = c.prepare("PRAGMA foreign_key_check").all();
	c.close();
	if (missing.length) { console.error("   ÉCHEC, manquant : " + missing.join(", ")); process.exit(1); }
	if (fk.length) { console.error(`   ÉCHEC : ${fk.length} violation(s) de clé étrangère.`); process.exit(1); }
	console.log("   Vérification : tables et colonnes de la v1.1.0 présentes.");
' "$DB" || { echo "Restaurez la sauvegarde si besoin : cp \"$BACKUP\" \"$DB\"" >&2; exit 1; }

echo "== Migration v1.1.0 terminée. En cas de problème, restaurez : cp \"$BACKUP\" \"$DB\""
