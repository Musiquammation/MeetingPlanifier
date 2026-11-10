// 1 -> 2 (v1.1.0): habits and actual duration of meetings.
//  - generator_id / generator_occurrence on disponibilities and suggestions (rows created by a habit);
//  - actual_duration_minutes on meetings (duration really spent, given when validating).
// The tables generators and generator_cancellations are new: CREATE TABLE IF NOT EXISTS (Database.SCHEMA_SQL)
// already created them before the migrations run.
import type { Migration } from "./index";

const migration: Migration = {
	version: 2,
	description: "v1.1.0 : habitudes (générateurs) et durée réelle des rendez-vous",
	up({ addColumn, exec }) {
		addColumn("meetings", "actual_duration_minutes",
			"INTEGER CHECK (actual_duration_minutes IS NULL OR (actual_duration_minutes > 0 AND actual_duration_minutes <= 44640))");
		for (const table of ["disponibilities", "suggestions"]) {
			addColumn(table, "generator_id", "INTEGER REFERENCES generators(id) ON DELETE SET NULL");
			addColumn(table, "generator_occurrence", "TEXT");
			exec(`CREATE INDEX IF NOT EXISTS idx_${table}_generator ON ${table}(generator_id, generator_occurrence)`);
		}
	},
};

export default migration;
