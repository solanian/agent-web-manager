import { describe, expect, it } from "vitest";
import {
	compoundSessionId,
	providerLabel,
	sessionTitleFromText,
	splitCompoundSessionId,
} from "../src/index.js";

describe("shared helpers", () => {
	it("round-trips compound session ids", () => {
		const id = compoundSessionId("server/a", "session:b");
		expect(splitCompoundSessionId(id)).toEqual({
			serverId: "server/a",
			sessionId: "session:b",
		});
	});

	it("normalizes titles", () => {
		expect(sessionTitleFromText("  hello\nworld  ")).toBe("hello world");
	});

	it("maps provider labels", () => {
		expect(providerLabel("claude")).toBe("Claude Code");
	});
});
