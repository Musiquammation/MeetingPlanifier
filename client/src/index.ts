// Entry point. window.SERVER_ADDRESS is set by index.html and read lazily by Fetcher, at request time.
import { dom } from "./domHandler";

export function init(): void {
	void dom.start();
}
