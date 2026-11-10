# Userscript API

An agent can attach a JavaScript **userscript** to their account (agent menu → **Script**).
The server runs it on every meeting event of the agent's agenda, so the agent can push
their meetings to their own tools: invoicing, calendar, CRM, chat notifications, and so on.

```js
async function userscript(env, args) {
	// env:  sandbox API (secrets, HTTP requests, logs)
	// args: a description of the event, as seen by the agent
}
```

The script must define a global function named `userscript`. It may be `async`
and may return a value (the value is serialized to JSON and shown in the execution history).

---

## Events

| `args.event.type` | When                                                                           | Triggered by                   |
| ----------------- | ------------------------------------------------------------------------------ | ------------------------------ |
| `new-meeting`     | The agent books a meeting.                                                     | agent                          |
| `update-meeting`  | The room or the comment of a meeting changes (`event.changes` says what changed). | agent or admin (also the admin's automatic room assignment) |
| `cancel-meeting`  | A pending meeting is cancelled.                                                | agent, consumer or admin       |
| `valid-meeting`   | A meeting is marked as done (validated), with the time really spent.           | agent or admin                 |

`args.event.actor.role` says who triggered the event. The events of one agent are run one after the
other, in the order they happened, so a script never sees an `update-meeting` before the `new-meeting`
of the same meeting. The script runs only while it is
**enabled**. The **Test** button runs the code that is currently in the editor, even
if the script is disabled or the code is not saved.

---

## `env`

`env` is frozen. It is the only way to reach the outside world: `secrets`, HTTP methods,
`google` and `log`.

### `env.secrets`

`{ [name: string]: string }`. These are the secrets defined in the Script menu, so keys and
tokens stay out of the code. Names match `[A-Za-z_][A-Za-z0-9_]*` (64 characters max).
There are 50 secrets at most, of 4096 characters each.

- Secret values are write-only. The UI and the REST API never send them back, they only list the names.
- Any secret value of 4 or more characters that appears in logs, errors or the returned value is replaced by `***` before it is stored.

```js
const headers = { Authorization: `Bearer ${env.secrets.API_KEY}` };
```

### HTTP requests

Every method returns a `Promise<Response>`. A promise rejects only for network errors or
rules that are not respected (see Limits). HTTP error statuses such as 404 or 500 still
resolve: check `response.ok`.

| Method                                    | Description                                           |
| ----------------------------------------- | ----------------------------------------------------- |
| `env.get(url, options?)`                  | `GET` request.                                         |
| `env.head(url, options?)`                 | `HEAD` request.                                        |
| `env.delete(url, options?)`               | `DELETE` request.                                      |
| `env.post(url, data?, options?)`          | `POST` request with a body.                            |
| `env.put(url, data?, options?)`           | `PUT` request with a body.                             |
| `env.patch(url, data?, options?)`         | `PATCH` request with a body.                           |
| `env.request({ method, url, headers?, body? })` | Generic form of all of the above.                |

- `options.headers`: an object of header names to string values.
- `data` / `body`:
  - a **string** is sent as is. The default `Content-Type` is `text/plain; charset=utf-8`.
  - any other value is sent as **JSON**. The default `Content-Type` is `application/json`.
  - a `Content-Type` header you set always wins. For a form, use a string together with
    `"Content-Type": "application/x-www-form-urlencoded"`.

#### `Response`

```ts
{
	ok: boolean;              // status between 200 and 299
	status: number;           // e.g. 200
	statusText: string;
	headers: { [lowercaseName: string]: string };
	url: string;
	body: string;             // decoded as UTF-8
	truncated: boolean;       // true if the body was cut at the size limit
	text(): string;           // same as body
	json(): any;              // JSON.parse(body); throws if the body is not valid JSON
}
```

Redirects are **not** followed. A `3xx` response is returned as is, and the target is
in `headers.location`.

### `env.google`: Google APIs

Calls Google APIs (Sheets, Calendar, Drive…) with the credentials of a **service account**.
The OAuth token is obtained by the server, outside the sandbox, and is only ever sent to
`https://*.googleapis.com`. Each token request and each API call counts as one HTTP request
(the token is reused within a run).

**Setup**: in Google Cloud, create a service account, enable the API you need (e.g. Google Sheets API),
create a JSON key, and save the whole JSON as a secret (e.g. `GOOGLE_SERVICE_ACCOUNT`). Then share the
sheet (or calendar, file…) with the service account's `client_email`, as an editor.

`credentials` is that JSON (string or object), or `{ accessToken: "ya29…" }` for an OAuth token you got elsewhere.

#### `env.google.sheets(credentials)`

Returns a Sheets client. `sheet` is the sheet's link (`https://docs.google.com/spreadsheets/d/<id>/edit#gid=<tab>`)
or its id. A `range` without a tab name (`"A1:C3"`) targets the tab of the link's `gid`, or the first tab when
the link has none. `"Tab name!A1:C3"` targets a tab explicitly.

| Method                                         | Returns                                                         |
| ---------------------------------------------- | --------------------------------------------------------------- |
| `get(sheet, range = "A:Z")`                    | `Promise<any[][]>`: the cell values, `[]` when the range is empty. |
| `append(sheet, rows, { range?, valueInputOption? })` | Adds rows after the last row of the table (`range` default `"A1"`). Returns the Sheets API answer (`updates.updatedRange`…). |
| `update(sheet, range, rows, { valueInputOption? })` | Overwrites the range.                                     |
| `clear(sheet, range = "A:Z")`                  | Clears the values of the range.                                 |
| `info(sheet)`                                  | `{ id, title, tabs: [{ gid, title, index }] }`                  |

- `rows` is one row (`[a, b, c]`) or several (`[[a, b], [c, d]]`). `null`/`undefined` cells are written empty, objects as JSON.
- `valueInputOption` is `"RAW"` by default: values are stored as is, so a consumer name or a comment starting
  with `=` is never run as a formula. Use `"USER_ENTERED"` to have Sheets parse numbers, dates and formulas.
- A Google error rejects the promise with `Google Sheets error <status>: <message>`.

#### `env.google.request({ credentials, url, method?, headers?, body?, scopes? })`

Generic authenticated call, for any other Google API. Same body rules and same `Response` as `env.request`.
`scopes` defaults to `["https://www.googleapis.com/auth/cloud-platform"]`; every scope must start with
`https://www.googleapis.com/auth/`. The `Authorization` header is always set by the server.

```js
const res = await env.google.request({
	credentials: env.secrets.GOOGLE_SERVICE_ACCOUNT,
	scopes: ["https://www.googleapis.com/auth/calendar.events"],
	method: "POST",
	url: "https://www.googleapis.com/calendar/v3/calendars/primary/events",
	body: { summary: "Meeting", start: { dateTime: m.startAt }, end: { dateTime: m.endAt } },
});
```

`env.google.spreadsheetId(link)` extracts the id from a sheet link.

### `env.log(...values)`

Adds one line to the execution log. Strings are written as is, `Error` objects as their
stack, and other values as JSON. The log is shown in the Script menu: in the test result
and in the execution history.

---

## `args`

`args` is a frozen deep copy, built for each run. Changing it has no effect on the
application. It only contains data about the event: the consumer and the pricing of the
meeting, never the agent's other consumers.

```ts
{
	event: {
		type: "new-meeting" | "update-meeting" | "cancel-meeting" | "valid-meeting";
		meeting: Meeting;
		actor: { role: "agent" | "consumer" | "admin" } | null;
		triggeredAt: string;      // ISO date of the event
		test: boolean;            // true when run from the Test button
		changes: {                // update-meeting only (null otherwise): the fields that changed
			room?:    { from: string | null; to: string | null };
			comment?: { from: string; to: string };
		} | null;
	};
	agent:   { id: number; name: string; surname: string; username: string };
	company: { id: number; name: string };   // company of the meeting
	consumers: {                              // only the consumer of the meeting, keyed by username
		[username: string]: {
			id: number;
			username: string;
			name: string;
			surname: string;
			key: string;                      // consumer access key in this company (link: #consumer-welcome?key=…)
			pricing: string | null;           // name of the pricing (package) that applies, null if none
			intercourseMinutes: number;       // time the agent needs before/after this consumer's meetings
			company: { id: number; name: string };
		};
	};
	pricings: { [name: string]: number };     // hourly price of the meeting's pricing, e.g. { standard: 32 }
	societyCommission: number;                // company commission as a ratio, e.g. 0.28 for 28 %
}
```

### `Meeting`

```ts
{
	id: number;
	status: "pending" | "done" | "canceledBy";
	startAt: string;            // ISO 8601, UTC
	endAt: string;              // ISO 8601, UTC: startAt + durationMinutes
	durationMinutes: number;    // actual duration once validated with one, else the booked duration
	durationHours: number;      // durationMinutes / 60, rounded to 2 decimals
	plannedEndAt: string;       // ISO 8601, UTC: end of the booked slot
	plannedDurationMinutes: number;      // duration booked
	actualDurationMinutes: number | null; // duration really spent, given when validating (null before, or when not given)
	consumer: string;           // username: key of args.consumers
	company: { id: number; name: string };
	room: string | null;
	comment: string;
	pricing: string | null;     // key of args.pricings
	hourlyRate: number;         // hourly price paid by the consumer (company share included)
	agentHourlyRate: number;    // hourlyRate / (1 + societyCommission)
	societyHourlyRate: number;  // hourlyRate - agentHourlyRate
	price: number;              // hourlyRate × durationHours (so the actual duration once validated)
	agentAmount: number;        // what the agent earns for this meeting
	societyAmount: number;      // what the company keeps
	societyCommission: number;  // ratio applied to THIS meeting (can differ from args.societyCommission once the meeting is done)
	availabilityRequestId: number | null;
	consumerLove: number | null; // consumer's preference (0..1) for the booked slot
	agentLove: number | null;    // agent's preference (0..1) for the booked slot
	canceledBy: "agent" | "consumer" | "admin" | null;
	createdAt: string;
	updatedAt: string;
}
```

When a meeting is validated, the agent (or the admin) can change the duration really spent: a 60-minute
booking validated with 45 minutes gives `durationMinutes: 45`, `plannedDurationMinutes: 60`,
`actualDurationMinutes: 45`, and `price`, `agentAmount` and `societyAmount` are computed on 45 minutes.

All amounts are in euros, rounded to cents. The price includes the company's share:
`price = agentAmount × (1 + societyCommission)`. For example, 32 € paid gives
25 € to the agent and 7 € to the company with a commission of 0.28.

When the test runs on the **sample event** (no meeting selected), `meeting.id` is `0` and
the consumer, company and pricing are made up (a sample `valid-meeting` has a 60-minute booking done in 45 minutes).

---

## Sandbox and limits

The agent's code is treated as hostile.

- **Isolation.** Each run happens in a fresh child process, inside a separate V8 isolate
  ([isolated-vm](https://github.com/laverdet/isolated-vm)). The only globals are the
  standard JavaScript built-ins (`Object`, `Array`, `JSON`, `Math`, `Date`, `Promise`,
  `RegExp`, `Map`, …) and your `userscript` function. There is no `require`, `import`,
  `process`, `fetch`, `console`, `setTimeout` or file system. Everything crosses the
  boundary as a copy, and nothing is kept between two runs.
- **Child process.** The process starts with an empty environment and with Node's
  permission model turned on. It cannot write files, start processes or workers, and it can
  only read its own runner file and the isolated-vm binary.

| Limit                              | Value                                    |
| ---------------------------------- | ---------------------------------------- |
| CPU time (whole run, including after `await`) | 1000 ms                        |
| Total duration (HTTP included)     | 10 s (the process is then killed)        |
| Memory                             | 32 MB heap                               |
| HTTP requests per run              | 10                                       |
| Timeout per HTTP request           | 5 s                                      |
| Request body                       | 256 KB                                   |
| Response body                      | 1 MB (larger bodies are cut, `truncated: true`) |
| Log                                | 200 lines, 64 KB                         |
| Returned value                     | 16 KB of JSON                            |
| Code size                          | 100 000 characters                       |
| Concurrency                        | 2 runs at a time on the server; the runs of one agent are sequential, 50 waiting runs per agent at most (more are `skipped`) |

**Network rules**

- Only `http:` and `https:` URLs are allowed.
- Internal addresses are refused, even when a public name resolves to them (the check runs
  on the IP the request actually connects to):
  - loopback, `localhost`, `*.local` and `*.internal`;
  - private ranges (10/8, 172.16/12, 192.168/16, fc00::/7…), link-local and cloud metadata
    (169.254/16), CGNAT, multicast, and reserved ranges, IPv4-mapped IPv6 included.
- The `Host`, `Content-Length`, `Transfer-Encoding`, `Connection` and proxy headers are set
  by the server and cannot be overridden. The default `User-Agent` is
  `MeetingPlanifier-Userscript/1.0`.
- For **local development only**, start the server with
  `USERSCRIPT_ALLOW_PRIVATE_NETWORK=1` to let scripts reach localhost and private networks.

**Execution status** (history of the last 30 runs)

| Status    | Meaning                                                               |
| --------- | --------------------------------------------------------------------- |
| `ok`      | `userscript` finished; its return value is stored.                    |
| `error`   | The script threw, a promise was rejected, or the memory limit was hit. |
| `timeout` | The CPU or total time limit was hit.                                  |
| `skipped` | Too many runs were already waiting for this agent.                    |

A failing script never blocks or cancels the meeting action. Events are processed in the
background, after the response has been sent to the user.

---

## Examples

### Send every event to a webhook

```js
async function userscript(env, args) {
	const { event } = args;
	const res = await env.post("https://hooks.example.com/meetings", {
		type: event.type,
		meeting: event.meeting,
		consumer: args.consumers[event.meeting.consumer],
	}, {
		headers: { Authorization: `Bearer ${env.secrets.WEBHOOK_TOKEN}` },
	});
	if (!res.ok) throw new Error(`Webhook answered ${res.status}: ${res.body.slice(0, 200)}`);
	return { delivered: true };
}
```

### Create an invoice line when a meeting is validated

```js
async function userscript(env, { event, consumers, pricings }) {
	if (event.type !== "valid-meeting") return;
	const m = event.meeting;
	const c = consumers[m.consumer];
	await env.post("https://api.invoices.example/v1/lines", {
		customer: `${c.name} ${c.surname}`,
		label: `${m.pricing ?? "Session"}: ${m.durationHours} h on ${m.startAt.slice(0, 10)}`,
		unitPrice: m.pricing ? pricings[m.pricing] : m.hourlyRate,
		quantity: m.durationHours,
		total: m.price,
	}, { headers: { "X-Api-Key": env.secrets.INVOICE_KEY } });
}
```

### Keep a Google Sheet of the meetings

The full version is [`server/userscript/examples/google-sheet-meetings.js`](server/userscript/examples/google-sheet-meetings.js):
one row per meeting, found by its id in column A, with a status column (`à venir`, `fait`, `annulé`).
`new-meeting` adds the row, and `update-meeting`, `cancel-meeting` and `valid-meeting` rewrite it.
The shorter version below only adds a row per booking:

```js
async function userscript(env, { event, consumers }) {
	if (event.type !== "new-meeting") return;
	const m = event.meeting;
	const c = consumers[m.consumer];
	const sheets = env.google.sheets(env.secrets.GOOGLE_SERVICE_ACCOUNT);
	await sheets.append(env.secrets.SHEET_URL, [m.startAt, m.endAt, `${c.name} ${c.surname}`, m.durationHours, m.price]);
}
```

### Post a chat message (form-encoded body)

```js
async function userscript(env, { event }) {
	const m = event.meeting;
	const text = event.type === "cancel-meeting"
		? `Cancelled by ${m.canceledBy}: ${m.consumer}, ${m.startAt}`
		: `${event.type}: ${m.consumer}, ${m.startAt} (${m.durationMinutes} min)`;
	await env.post(`https://chat.example.com/api/send?token=${encodeURIComponent(env.secrets.CHAT_TOKEN)}`,
		"text=" + encodeURIComponent(text),
		{ headers: { "Content-Type": "application/x-www-form-urlencoded" } });
}
```

---

## REST endpoints (agent session)

These are what the Script menu uses. All of them need `Authorization: Bearer <agent token>`.

| Method & path                    | Body                                                       | Answer                         |
| -------------------------------- | ---------------------------------------------------------- | ------------------------------ |
| `GET /api/agent/script`          | —                                                          | `{ code, enabled, updatedAt, secretNames, eventTypes, limits }` |
| `PUT /api/agent/script`          | `{ code?: string, enabled?: boolean }`                     | same as `GET`                  |
| `PATCH /api/agent/script/secrets`| `{ secrets: [{ name, value: string \| null }] }` (`null` deletes; secrets not listed are kept) | same as `GET` |
| `POST /api/agent/script/test`    | `{ type?, code?, meetingId? }`: `code` defaults to the saved code; with no `meetingId`, the sample event is used | the run record |
| `GET /api/agent/script/runs`     | —                                                          | last 30 runs: `{ id, trigger, eventType, meetingId, status, durationMs, logs, result, error, createdAt }` |

---

## Test data

`npm run seed` (idempotent) creates, in `dist/database.sqlite`:

- the company **Société X**, its rooms `Salle A` and `Salle B`, and its administrator `X-admin` / `x`;
- the agent **`X` / `x`**, whose script is the Google Sheets example above, enabled;
- the consumers **A** and **B**, access keys `AAAAAA` and `BBBBBB` (keys are 6 characters), assigned to X
  with the package `standard` (32 €/h), plus availabilities and suggestions from 9:00 to 17:00 UTC for the
  next 7 days, so X can book right away.

Running the seed again keeps X's secrets but puts the example code back. The secrets belong to the agent:
log in as X and set them in **Script → Secrets**:

- `SHEET_URL`: the link of the sheet;
- `GOOGLE_SERVICE_ACCOUNT`: the whole JSON key of the service account (paste the file's content).
