import { createConsola } from "consola/basic";

let failed = false;
let listening = false;

// Progress is best-effort. Keep the error listener for this process's lifetime:
// a write callback can run before the stream emits its error (including EPIPE).
// Never wrap global streams or let output failures replace operation errors.
export const progress = createConsola({
	level: 3,
	throttle: 0,
	reporters: [
		{
			log({ type, tag, args }) {
				if (failed) return;
				try {
					if (!listening) {
						process.stderr.on("error", () => {
							failed = true;
						});
						listening = true;
					}
					// Callers supply only bounded milestone strings, never raw objects.
					process.stderr.write(
						`[${type}] [${tag}] ${args.join(" ")}\n`,
						(error) => {
							if (error) failed = true;
						},
					);
				} catch {
					failed = true;
				}
			},
		},
	],
});
