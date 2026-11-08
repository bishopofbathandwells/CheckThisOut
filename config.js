// Public deployment configuration only. Never add API keys here.
// Authenticated Cloudflare Worker. Its model key is stored only as a server secret.
export const recommendationEndpoint='https://checkthisout-recommendations.general-zodd.workers.dev/recommend';

// Playlist metadata context approved by the user on 27 October 2026.
export const playlistContextEnabled=true;

export const cloudSyncEnabled=true;

// UI visibility only; the backend independently verifies developer identity.
export const developerSpotifyUserId='31hl4wz7lmymikmroghaxqpeel7y';
