import { ConvexHttpClient } from "convex/browser";
import { createTaskerHttpHandler } from "../../mcp/http";

export async function handleTaskerMcp(request: Request): Promise<Response> {
	const url =
		process.env.TASKER_CONVEX_URL ||
		process.env.VITE_CONVEX_URL ||
		import.meta.env.VITE_CONVEX_URL;
	if (!url) return unavailable();
	try {
		const backend = new ConvexHttpClient(url);
		const allowedOrigins = (process.env.TASKER_MCP_ALLOWED_ORIGINS ?? "")
			.split(",")
			.map((origin) => origin.trim())
			.filter(Boolean);
		return await createTaskerHttpHandler(backend, { allowedOrigins })(request);
	} catch {
		return unavailable();
	}
}

function unavailable() {
	return Response.json(
		{
			error:
				"Tasker MCP is unavailable. Check the server backend configuration.",
		},
		{
			status: 503,
			headers: { "Cache-Control": "no-store" },
		},
	);
}
