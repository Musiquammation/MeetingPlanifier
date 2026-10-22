// Entry point. The server address is read lazily by Fetcher, at request time.
import { dom } from "./domHandler";

window.SERVER_ADDRESS = "http://localhost:8020";

void dom.start();
