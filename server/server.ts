import "dotenv/config";
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

app.listen(port, () => {
	console.log(`Server listening on port ${port}`);
});