import type { AuthConfig } from 'convex/server'

export default {
	providers: [
		{
			domain: "https://diverse-osprey-50.clerk.accounts.dev",
			applicationID: "convex",
		},
		{
			type: "customJwt",
			issuer: "https://diverse-osprey-50.clerk.accounts.dev",
			jwks: "https://diverse-osprey-50.clerk.accounts.dev/.well-known/jwks.json",
			algorithm: "RS256",
		},
	],
} satisfies AuthConfig
