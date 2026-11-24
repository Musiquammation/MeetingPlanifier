import "dotenv/config";
import fs from "fs";
import http from "http";
import https from "https";
import express from "express";
import cors from "cors";
import { getLogger, flushLogs } from "./logger";
import { Database } from "./Database";
import { initApi } from "./api";
import { VERSION_NUMBER } from "./VERSION_NUMBER";

const log = getLogger("server");

process.on("uncaughtException", (error) => {
	log.critical("Uncaught exception, the server stops:", error);
	void flushLogs().finally(() => process.exit(1));
});
process.on("unhandledRejection", (reason) => {
	log.error("Unhandled promise rejection:", reason);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.once(signal, () => {
		log.info(`${signal} received, stopping`);
		void flushLogs().finally(() => process.exit(0));
	});
}

log.info(`Starting (node ${process.version}, database schema v${VERSION_NUMBER}, pid ${process.pid})`);

const app = express();
const port = Number(process.env.PORT ?? 8020);
const database = new Database();

app.use(cors({
	origin: "*",
	methods: "*",
	allowedHeaders: "*"
}));

app.use(express.json());

initApi(app, database);

let server: http.Server | https.Server;

if (Number(process.env.USE_HTTPS)) {
	if (process.env.SSL_KEY_PATH === undefined || process.env.SSL_CERT_PATH === undefined) {
		log.critical("USE_HTTPS=1 but SSL_KEY_PATH and/or SSL_CERT_PATH are not defined");
		throw new Error("SSL_KEY_PATH and/or SSL_CERT_PATH are not defined");
	}

	const options = {
		key: fs.readFileSync(process.env.SSL_KEY_PATH),
		cert: fs.readFileSync(process.env.SSL_CERT_PATH)
	};
	log.info(`HTTPS enabled (key: ${process.env.SSL_KEY_PATH}, cert: ${process.env.SSL_CERT_PATH})`);

	server = https.createServer(options, app);
} else {
	server = http.createServer(app);
}

server.on("error", (error) => log.critical("HTTP server error:", error));

server.listen(port, process.env.HOSTNAME, () => {
	const protocol = server instanceof https.Server ? "https" : "http";
	log.info(`Server listening on ${protocol}://${process.env.HOSTNAME || "localhost"}:${port}`);
});
