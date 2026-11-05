// Mock userscript: keeps one row per meeting in a Google Sheet.
//
// Secrets (Script menu → Secrets):
//   SHEET_URL               link of the sheet (https://docs.google.com/spreadsheets/d/<id>/edit#gid=<tab>)
//   GOOGLE_SERVICE_ACCOUNT  JSON key of a Google Cloud service account; share the sheet with its
//                           client_email as an editor.
//
// Every event writes the whole row of the meeting, found by its id (column A):
//   new-meeting     adds the row, status "à venir"
//   update-meeting  rewrites the row (room or comment changed)
//   cancel-meeting  status "annulé"
//   valid-meeting   status "fait"
// A missing row is added, so the sheet also catches up with meetings booked before the script.
// A header row is written first when the tab is empty.

const HEADER = ["Meeting", "Statut", "Date", "Début", "Fin", "Durée (h)", "Consommateur", "Identifiant", "Formule", "Prix (€)", "Part agent (€)", "Salle", "Commentaire"];
const STATUS = { pending: "à venir", done: "fait", canceledBy: "annulé" };

async function userscript(env, args) {
	const { event, consumers } = args;
	const m = event.meeting;
	const c = consumers[m.consumer];
	const time = (iso) => new Date(iso).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
	const row = [
		m.id,
		STATUS[m.status] ?? m.status,
		new Date(m.startAt).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }),
		time(m.startAt),
		time(m.endAt),
		m.durationHours,
		`${c.name} ${c.surname}`,
		c.username,
		m.pricing ?? "",
		m.price,
		m.agentAmount,
		m.room ?? "",
		m.comment,
	];

	const sheets = env.google.sheets(env.secrets.GOOGLE_SERVICE_ACCOUNT);
	const url = env.secrets.SHEET_URL;
	const ids = (await sheets.get(url, "A:A")).map((cells) => String(cells[0] ?? ""));
	const index = ids.indexOf(String(m.id), 1); // row 1 is the header

	if (index > 0) {
		const line = index + 1;
		await sheets.update(url, `A${line}:M${line}`, [row]);
		env.log(`${event.type}: row ${line} updated (meeting ${m.id}, ${row[1]})`, event.changes ?? "");
		return { row: line, action: "updated" };
	}
	const result = await sheets.append(url, ids.length ? [row] : [HEADER, row]);
	env.log(`${event.type}: row added in ${result.updates.updatedRange} (meeting ${m.id}, ${row[1]})`);
	return { range: result.updates.updatedRange, action: "added" };
}
