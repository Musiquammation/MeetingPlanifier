// 2 -> 3: context of the userscript executions, so that a failed one can be retried.
//  - event_context on agent_script_runs: JSON { actorRole, changes } of the event that triggered the run.
import type { Migration } from "./index";

const migration: Migration = {
	version: 3,
	description: "Context of userscript executions (retry of a failed one)",
	up({ addColumn }) {
		addColumn("agent_script_runs", "event_context", "TEXT");
	},
};

export default migration;
