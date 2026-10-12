import { createFileRoute } from "@tanstack/react-router";
import { handleTaskerMcp } from "#/server/taskerMcp";

export const Route = createFileRoute("/mcp")({
	server: {
		handlers: {
			ANY: ({ request }) => handleTaskerMcp(request),
		},
	},
});
