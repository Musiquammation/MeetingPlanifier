import "dotenv/config";
import fs from "fs";
import http from "http";
import https from "https";
import express from "express";
import cors from "cors";
import { Database } from "./Database";
import { initApi } from "./api";

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
		throw new Error("SSL_KEY_PATH and/or SSL_CERT_PATH are not defined");
	}

	const options = {
		key: fs.readFileSync(process.env.SSL_KEY_PATH),
		cert: fs.readFileSync(process.env.SSL_CERT_PATH)
	};

	server = https.createServer(options, app);
} else {
	server = http.createServer(app);
}

server.listen(port, () => {
	const protocol = server instanceof https.Server ? "https" : "http";
	console.log(`Server listening on ${protocol}://localhost:${port}`);
});