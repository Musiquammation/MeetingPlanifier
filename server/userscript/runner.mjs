// Userscript runner: executed in its own child process (one process per execution, see UserscriptService.ts).
//
// The agent's code is considered hostile. It runs inside a separate V8 isolate (isolated-vm):
//  - the isolate has its own heap (memory limit) and no Node.js API at all: no require, process, fetch, timers...
//  - the only link with this process is three ivm.Reference (HTTP bridge, Google bridge, log bridge) captured in a closure;
//    every value crossing the boundary is a copy (strings / structured clones), never a live object;
//  - CPU time is limited by the isolate timeout, the total duration by a deadline here and a SIGKILL in the parent.
// HTTP requests are made here, by trusted code, with strict limits and a guard against internal addresses (SSRF).
// Google APIs: the OAuth token of a service account is obtained here (JWT signed with node:crypto) and never enters
// the isolate; only *.googleapis.com URLs can receive it.

import { createRequire } from "node:module";
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";
import crypto from "node:crypto";

// The parent gives the path of isolated-vm's native binary: under the permission model this process may only read
// that file and this directory, so the package resolution (which walks package.json files) is skipped.
const ivm = createRequire(import.meta.url)(process.argv[2]).ivm;

const send = (message) => new Promise((resolve) => {
	if (!process.connected) return resolve();
	process.send(message, () => resolve());
});

// ---------------------------------------------------------------------------
// Network guard
// ---------------------------------------------------------------------------

const blockList = new net.BlockList();
for (const [address, prefix] of [
	["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
	["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
	["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
]) blockList.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
	["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32], ["100::", 64],
]) blockList.addSubnet(address, prefix, "ipv6");

/** IPv4 hidden in an IPv6 address (mapped ::ffff:a.b.c.d, NAT64 64:ff9b::/96, 6to4 2002::/16), else null. */
function embeddedIpv4(address) {
	const lower = address.toLowerCase();
	const mapped = lower.match(/^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/) ?? lower.match(/^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/);
	if (mapped) return mapped[1];
	const hex = (a, b) => [parseInt(a, 16) >> 8, parseInt(a, 16) & 255, parseInt(b, 16) >> 8, parseInt(b, 16) & 255].join(".");
	const mappedHex = lower.match(/^(?:0*:)*:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/) ?? lower.match(/^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
	if (mappedHex) return hex(mappedHex[1], mappedHex[2]);
	const sixToFour = lower.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4}):/);
	if (sixToFour) return hex(sixToFour[1], sixToFour[2]);
	return null;
}

function isForbiddenAddress(address) {
	const family = net.isIP(address);
	if (family === 4) return blockList.check(address, "ipv4");
	if (family === 6) {
		const v4 = embeddedIpv4(address);
		if (v4) return blockList.check(v4, "ipv4");
		return blockList.check(address, "ipv6");
	}
	return true;
}

/** dns.lookup replacement used by the HTTP agent: the address that is checked is the one that is connected to. */
function guardedLookup(allowPrivate) {
	return (hostname, options, callback) => {
		dns.lookup(hostname, { ...options, all: true, verbatim: true }, (error, addresses) => {
			if (error) return callback(error);
			const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options.family || 4 }];
			if (!list.length) return callback(new Error(`No address for ${hostname}`));
			if (!allowPrivate && list.some((a) => isForbiddenAddress(a.address))) {
				return callback(new Error(`Access to internal address of ${hostname} is forbidden`));
			}
			if (options.all) return callback(null, list);
			return callback(null, list[0].address, list[0].family);
		});
	};
}

// ---------------------------------------------------------------------------
// HTTP bridge (called from the isolate with a JSON string, answers a JSON string)
// ---------------------------------------------------------------------------

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);
const FORBIDDEN_HEADERS = new Set(["host", "content-length", "transfer-encoding", "connection", "upgrade", "expect", "keep-alive", "te", "trailer", "proxy-authorization", "proxy-connection"]);

/** Parses a request coming from the isolate (a JSON string), with a size check. */
function parseBridgeRequest(limits, raw) {
	if (typeof raw !== "string" || raw.length > limits.maxRequestBytes + 65536) throw new Error("Request too large");
	return JSON.parse(raw);
}

/** Performs one checked HTTP request: { method, url, headers, body: string|null } -> plain response object. */
async function httpRequest(limits, state, req) {
			if (Date.now() > state.deadline) throw new Error("Execution time is over");
			if (state.requests >= limits.maxRequests) throw new Error(`Too many HTTP requests (maximum ${limits.maxRequests} per execution)`);
			state.requests += 1;

			const method = String(req.method ?? "GET").toUpperCase();
			if (!METHODS.has(method)) throw new Error(`HTTP method not allowed: ${method.slice(0, 16)}`);
			if (typeof req.url !== "string" || req.url.length > 4096) throw new Error("A valid URL is required");
			let url;
			try { url = new URL(req.url); } catch { throw new Error("A valid URL is required"); }
			if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http and https URLs are allowed");
			const host = url.hostname.replace(/^\[|\]$/g, "");
			if (!limits.allowPrivateNetwork && (net.isIP(host) ? isForbiddenAddress(host) : /^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host))) {
				throw new Error("Access to internal addresses is forbidden");
			}

			const headers = {};
			if (req.headers !== undefined && req.headers !== null) {
				if (typeof req.headers !== "object" || Array.isArray(req.headers)) throw new Error("headers must be an object");
				const entries = Object.entries(req.headers);
				if (entries.length > 50) throw new Error("Too many headers");
				for (const [name, value] of entries) {
					if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(name)) throw new Error(`Invalid header name: ${name.slice(0, 64)}`);
					if (FORBIDDEN_HEADERS.has(name.toLowerCase())) throw new Error(`Header not allowed: ${name}`);
					const text = String(value);
					if (text.length > 8192 || /[\r\n\0]/.test(text)) throw new Error(`Invalid value for header ${name}`);
					headers[name] = text;
				}
			}
			if (!Object.keys(headers).some((h) => h.toLowerCase() === "user-agent")) headers["User-Agent"] = "MeetingPlanifier-Userscript/1.0";

			let body = null;
			if (req.body !== undefined && req.body !== null) {
				if (method === "GET" || method === "HEAD") throw new Error(`${method} requests cannot have a body`);
				if (typeof req.body !== "string") throw new Error("body must be a string");
				body = Buffer.from(req.body, "utf8");
				if (body.length > limits.maxRequestBytes) throw new Error(`Request body too large (maximum ${limits.maxRequestBytes} bytes)`);
				headers["Content-Length"] = String(body.length);
			}

			const timeout = Math.max(100, Math.min(limits.requestTimeoutMs, state.deadline - Date.now()));
			const response = await new Promise((resolve, reject) => {
				const lib = url.protocol === "https:" ? https : http;
				const request = lib.request(url, {
					method, headers, timeout,
					lookup: guardedLookup(limits.allowPrivateNetwork),
					agent: false, // no connection reuse between requests
				}, (res) => {
					const chunks = [];
					let size = 0;
					let truncated = false;
					res.on("data", (chunk) => {
						if (truncated) return;
						size += chunk.length;
						if (size > limits.maxResponseBytes) {
							truncated = true;
							chunks.push(chunk.subarray(0, chunk.length - (size - limits.maxResponseBytes)));
							res.destroy();
							finish();
							return;
						}
						chunks.push(chunk);
					});
					let done = false;
					const finish = () => {
						if (done) return;
						done = true;
						const responseHeaders = {};
						for (const [k, v] of Object.entries(res.headers)) responseHeaders[k] = Array.isArray(v) ? v.join(", ") : String(v ?? "");
						resolve({
							status: res.statusCode ?? 0, statusText: res.statusMessage ?? "", headers: responseHeaders,
							url: url.href, body: Buffer.concat(chunks).toString("utf8"), truncated,
						});
					};
					res.on("end", finish);
					res.on("error", (e) => (truncated ? finish() : reject(e)));
				});
				request.on("timeout", () => request.destroy(new Error(`HTTP request timed out after ${timeout} ms`)));
				request.on("error", reject);
				if (body) request.write(body);
				request.end();
			});
			return response;
}

const bridgeError = (error) => JSON.stringify({ error: String(error?.message ?? error).slice(0, 500) });

function makeHttpBridge(limits, state) {
	return async (raw) => {
		try { return JSON.stringify(await httpRequest(limits, state, parseBridgeRequest(limits, raw))); }
		catch (error) { return bridgeError(error); }
	};
}

// ---------------------------------------------------------------------------
// Google APIs bridge: same request as above, authenticated with a service account (or a given access token)
// ---------------------------------------------------------------------------

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SCOPE_PREFIX = "https://www.googleapis.com/auth/";
const b64url = (value) => Buffer.from(value).toString("base64url");

/** Access token for these credentials and scopes, cached for the execution (the token request counts as a request). */
function googleToken(limits, state, rawCredentials, scopes) {
	let credentials = rawCredentials;
	if (typeof credentials === "string") {
		try { credentials = JSON.parse(credentials); }
		catch { throw new Error("Google credentials must be a service account JSON key, or { accessToken }"); }
	}
	if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) {
		throw new Error("Google credentials must be a service account JSON key, or { accessToken }");
	}
	const direct = credentials.accessToken ?? credentials.access_token;
	if (direct !== undefined) {
		if (typeof direct !== "string" || !/^[\x21-\x7e]{1,4096}$/.test(direct)) throw new Error("Invalid Google access token");
		return Promise.resolve(direct);
	}
	const email = credentials.client_email;
	const key = credentials.private_key;
	if (typeof email !== "string" || typeof key !== "string" || email.length > 320 || key.length > 8192) {
		throw new Error("The service account key must contain client_email and private_key");
	}
	const cacheKey = `${email} ${scopes.join(" ")}`;
	const cached = state.googleTokens.get(cacheKey);
	if (cached) return cached;
	const pending = (async () => {
		const now = Math.floor(Date.now() / 1000);
		const header = { alg: "RS256", typ: "JWT" };
		if (typeof credentials.private_key_id === "string") header.kid = credentials.private_key_id.slice(0, 128);
		const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify({
			iss: email, scope: scopes.join(" "), aud: GOOGLE_TOKEN_URL, iat: now, exp: now + 3600,
		}))}`;
		let signature;
		try { signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), key); }
		catch { throw new Error("Invalid private_key in the service account key"); }
		const res = await httpRequest(limits, state, {
			method: "POST", url: GOOGLE_TOKEN_URL,
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(signature)}` }).toString(),
		});
		let data = {};
		try { data = JSON.parse(res.body); } catch { /* not JSON */ }
		if (res.status !== 200 || typeof data.access_token !== "string") {
			throw new Error(`Google authentication failed (${res.status}): ${String(data.error_description ?? data.error ?? res.statusText).slice(0, 200)}`);
		}
		return data.access_token;
	})();
	state.googleTokens.set(cacheKey, pending);
	pending.catch(() => state.googleTokens.delete(cacheKey));
	return pending;
}

function makeGoogleBridge(limits, state) {
	return async (raw) => {
		try {
			const req = parseBridgeRequest(limits, raw);
			let url;
			try { url = new URL(String(req.url)); } catch { throw new Error("A valid URL is required"); }
			if (url.protocol !== "https:" || !/^[a-z0-9-]+(\.[a-z0-9-]+)*\.googleapis\.com$/i.test(url.hostname) || url.username || url.password || url.port) {
				throw new Error("env.google only accepts https://*.googleapis.com URLs");
			}
			const scopes = req.scopes === undefined || req.scopes === null ? [`${GOOGLE_SCOPE_PREFIX}cloud-platform`] : req.scopes;
			if (!Array.isArray(scopes) || !scopes.length || scopes.length > 10
				|| !scopes.every((scope) => typeof scope === "string" && scope.startsWith(GOOGLE_SCOPE_PREFIX) && /^[\x21-\x7e]{1,200}$/.test(scope))) {
				throw new Error(`scopes must be a list of ${GOOGLE_SCOPE_PREFIX}… URLs`);
			}
			const token = await googleToken(limits, state, req.credentials, scopes);
			const headers = {};
			if (req.headers && typeof req.headers === "object" && !Array.isArray(req.headers)) {
				for (const [name, value] of Object.entries(req.headers)) if (name.toLowerCase() !== "authorization") headers[name] = value;
			}
			headers.Authorization = `Bearer ${token}`;
			return JSON.stringify(await httpRequest(limits, state, { method: req.method, url: url.href, headers, body: req.body }));
		} catch (error) { return bridgeError(error); }
	};
}

// ---------------------------------------------------------------------------
// Code run inside the isolate: builds `env` from the bridges, then calls userscript(env, args)
// ---------------------------------------------------------------------------

const INVOKE = String.raw`
"use strict";
const httpBridge = $0, logBridge = $1, secrets = $2, args = $3, googleBridge = $4;
const freeze = (value) => {
	if (value && typeof value === "object") { Object.freeze(value); for (const k of Object.keys(value)) freeze(value[k]); }
	return value;
};
const stringify = (value) => {
	if (typeof value === "string") return value;
	if (value instanceof Error) return value.stack || String(value);
	try { const s = JSON.stringify(value); return s === undefined ? String(value) : s; } catch (e) { return String(value); }
};
const makeResponse = (r) => {
	const body = r.body;
	return freeze({
		ok: r.status >= 200 && r.status < 300, status: r.status, statusText: r.statusText,
		headers: r.headers, url: r.url, body, truncated: r.truncated,
		text: () => body,
		json: () => JSON.parse(body),
	});
};
const encodeRequest = (options) => {
	let body = options.body;
	const headers = Object.assign({}, options.headers || {});
	const hasType = Object.keys(headers).some((h) => h.toLowerCase() === "content-type");
	if (body !== undefined && body !== null && typeof body !== "string") {
		body = JSON.stringify(body);
		if (!hasType) headers["Content-Type"] = "application/json";
	} else if (typeof body === "string" && !hasType) {
		headers["Content-Type"] = "text/plain; charset=utf-8";
	}
	return { method: options.method || "GET", url: String(options.url), headers, body: body === undefined ? null : body };
};
const callBridge = (bridge, payload) => bridge.apply(undefined, [JSON.stringify(payload)], { result: { promise: true, copy: true } }).then((raw) => {
	const r = JSON.parse(raw);
	if (r.error) throw new Error(r.error);
	return makeResponse(r);
});
const request = (options) => {
	if (!options || typeof options !== "object") return Promise.reject(new TypeError("request(options) expects an object"));
	return callBridge(httpBridge, encodeRequest(options));
};

// ---- env.google ----
const googleRequest = (options) => {
	if (!options || typeof options !== "object") return Promise.reject(new TypeError("google.request(options) expects an object"));
	const credentials = typeof options.credentials === "string" ? options.credentials : JSON.stringify(options.credentials === undefined ? null : options.credentials);
	return callBridge(googleBridge, Object.assign(encodeRequest(options), { credentials, scopes: options.scopes === undefined ? null : options.scopes }));
};
const spreadsheetId = (ref) => {
	const text = String(ref);
	const match = text.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
	if (match) return match[1];
	if (/^[A-Za-z0-9_-]{20,}$/.test(text)) return text;
	throw new TypeError("Expected a Google Sheets link or a spreadsheet id");
};
const sheetGid = (ref) => {
	const match = String(ref).match(/[#&?]gid=(\d+)/);
	return match ? Number(match[1]) : null;
};
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets/";
const SHEETS_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const INPUT_OPTIONS = ["RAW", "USER_ENTERED"];
const toRows = (rows) => {
	if (!Array.isArray(rows)) throw new TypeError("rows must be an array (one row) or an array of arrays (several rows)");
	const list = rows.length && !Array.isArray(rows[0]) ? [rows] : rows;
	return list.map((row) => {
		if (!Array.isArray(row)) throw new TypeError("every row must be an array");
		return row.map((cell) => cell === null || cell === undefined ? "" : typeof cell === "object" ? JSON.stringify(cell) : cell);
	});
};
const inputOption = (options) => {
	const value = (options && options.valueInputOption) || "RAW";
	if (!INPUT_OPTIONS.includes(value)) throw new TypeError("valueInputOption must be RAW or USER_ENTERED");
	return value;
};
const sheets = (credentials) => {
	if (credentials === undefined || credentials === null || credentials === "") throw new TypeError("google.sheets(credentials) needs a service account key (e.g. env.secrets.GOOGLE_SERVICE_ACCOUNT)");
	const titles = {};
	const call = (method, url, body) => googleRequest({ credentials, scopes: SHEETS_SCOPES, method, url, body }).then((r) => {
		let data = null;
		try { data = r.body ? JSON.parse(r.body) : null; } catch (e) { /* not JSON */ }
		if (!r.ok) throw new Error("Google Sheets error " + r.status + ": " + ((data && data.error && data.error.message) || r.statusText));
		return data;
	});
	const info = (ref) => call("GET", SHEETS_API + spreadsheetId(ref) + "?fields=" + encodeURIComponent("spreadsheetId,properties.title,sheets.properties(sheetId,title,index)"))
		.then((data) => ({
			id: data.spreadsheetId,
			title: data.properties && data.properties.title,
			tabs: (data.sheets || []).map((s) => ({ gid: s.properties.sheetId, title: s.properties.title, index: s.properties.index })),
		}));
	// A range without a tab ("A1:C3") targets the tab of the link's gid, or the first tab when the link has none.
	const fullRange = async (ref, range, fallback) => {
		const text = range === undefined || range === null || range === "" ? null : String(range);
		if (text && text.includes("!")) return text;
		const gid = sheetGid(ref);
		if (gid === null) return text || fallback;
		const key = spreadsheetId(ref) + ":" + gid;
		if (!(key in titles)) {
			const tab = (await info(ref)).tabs.find((t) => t.gid === gid);
			if (!tab) throw new Error("No tab with gid " + gid + " in this spreadsheet");
			titles[key] = tab.title;
		}
		const quoted = "'" + titles[key].replace(/'/g, "''") + "'";
		return text ? quoted + "!" + text : quoted;
	};
	const valuesUrl = (ref, range) => SHEETS_API + spreadsheetId(ref) + "/values/" + encodeURIComponent(range);
	return freeze({
		info,
		get: async (ref, range) => {
			const data = await call("GET", valuesUrl(ref, await fullRange(ref, range, "A:Z")));
			return (data && data.values) || [];
		},
		append: async (ref, rows, options) => {
			const values = toRows(rows);
			const range = await fullRange(ref, options && options.range, "A1");
			return call("POST", valuesUrl(ref, range) + ":append?insertDataOption=INSERT_ROWS&valueInputOption=" + inputOption(options), { values });
		},
		update: async (ref, range, rows, options) => {
			const values = toRows(rows);
			return call("PUT", valuesUrl(ref, await fullRange(ref, range, "A1")) + "?valueInputOption=" + inputOption(options), { values });
		},
		clear: async (ref, range) => call("POST", valuesUrl(ref, await fullRange(ref, range, "A:Z")) + ":clear", {}),
	});
};
const google = freeze({
	request: googleRequest,
	sheets,
	spreadsheetId,
});
const withBody = (method) => (url, data, options) => request(Object.assign({}, options || {}, { method, url, body: data }));
const env = freeze({
	secrets: freeze(secrets),
	request,
	get: (url, options) => request(Object.assign({}, options || {}, { method: "GET", url })),
	head: (url, options) => request(Object.assign({}, options || {}, { method: "HEAD", url })),
	delete: (url, options) => request(Object.assign({}, options || {}, { method: "DELETE", url })),
	post: withBody("POST"),
	put: withBody("PUT"),
	patch: withBody("PATCH"),
	google,
	log: (...values) => { logBridge.applyIgnored(undefined, [values.map(stringify).join(" ")]); },
});
freeze(args);
if (typeof userscript !== "function") throw new Error("The script must define: function userscript(env, args) { ... }");
return Promise.resolve().then(() => userscript(env, args)).then((value) => {
	if (value === undefined) return null;
	try { return JSON.stringify(value); } catch (e) { return JSON.stringify(String(value)); }
});
`;

// ---------------------------------------------------------------------------
// Job
// ---------------------------------------------------------------------------

async function runJob(job) {
	const limits = job.limits;
	const started = Date.now();
	const state = { deadline: started + limits.wallTimeMs, requests: 0, googleTokens: new Map() };
	const logs = [];
	let logBytes = 0;
	const log = (line) => {
		const text = String(line);
		if (logs.length >= limits.maxLogLines || logBytes >= limits.maxLogBytes) return;
		const cut = text.slice(0, Math.max(0, limits.maxLogBytes - logBytes));
		logBytes += cut.length;
		logs.push(cut);
	};

	const isolate = new ivm.Isolate({ memoryLimit: limits.memoryMb });
	let stopReason = null; // "time" | "cpu" once this process disposed the isolate
	const stop = (reason) => {
		if (stopReason) return;
		stopReason = reason;
		try { isolate.dispose(); } catch { /* already disposed */ }
	};
	const deadlineTimer = setTimeout(() => stop("time"), limits.wallTimeMs);
	// The CPU timeouts below only cover synchronous runs: code resumed after an await (HTTP response) is
	// covered by this total CPU budget, checked every 25 ms.
	const cpuBudgetNs = BigInt(limits.cpuTimeMs) * 1000000n;
	const cpuWatch = setInterval(() => {
		try { if (isolate.cpuTime > cpuBudgetNs) stop("cpu"); } catch { /* disposed */ }
	}, 25);
	try {
		const context = await isolate.createContext();
		const script = await isolate.compileScript(job.code, { filename: "userscript.js" });
		await script.run(context, { timeout: limits.cpuTimeMs });
		const result = await context.evalClosure(INVOKE, [
			new ivm.Reference(makeHttpBridge(limits, state)),
			new ivm.Reference((line) => log(line)),
			new ivm.ExternalCopy(job.secrets).copyInto(),
			new ivm.ExternalCopy(job.args).copyInto(),
			new ivm.Reference(makeGoogleBridge(limits, state)),
		], { timeout: limits.cpuTimeMs, result: { promise: true, copy: true } });
		const text = typeof result === "string" ? result : null;
		return { status: "ok", result: text && text.length > limits.maxResultBytes ? text.slice(0, limits.maxResultBytes) : text, logs, error: null, durationMs: Date.now() - started };
	} catch (error) {
		const message = String(error?.message ?? error);
		const cpu = stopReason === "cpu" || /timed out/i.test(message);
		const time = stopReason === "time";
		const memory = !cpu && !time && (isolate.isDisposed || /memory limit/i.test(message));
		let text;
		if (time) text = `Execution exceeded the time limit (${limits.wallTimeMs} ms in total)`;
		else if (cpu) text = `Execution exceeded the CPU time limit (${limits.cpuTimeMs} ms)`;
		else if (memory) text = `Execution exceeded the memory limit (${limits.memoryMb} MB)`;
		else {
			// Only the frames of the agent's code: the stack must not reveal anything about the server.
			const frames = String(error?.stack ?? "").split("\n").filter((l) => /userscript\.js/.test(l)).slice(0, 20);
			text = [`${error?.name ?? "Error"}: ${message}`, ...frames].join("\n");
		}
		return { status: time || cpu ? "timeout" : "error", result: null, logs, error: text.slice(0, 4000), durationMs: Date.now() - started };
	} finally {
		clearTimeout(deadlineTimer);
		clearInterval(cpuWatch);
		try { if (!isolate.isDisposed) isolate.dispose(); } catch { /* ignore */ }
	}
}

process.once("message", async (job) => {
	let outcome;
	try { outcome = await runJob(job); }
	catch (error) { outcome = { status: "error", result: null, logs: [], error: String(error?.message ?? error).slice(0, 4000), durationMs: 0 }; }
	await send({ type: "result", outcome });
	process.exit(0);
});
send({ type: "ready" });
