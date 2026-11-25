// Win Go Demo — Worker entry / router
// Step 2: health + Google auth + /api/me

import { corsHeaders, json } from "./http.js";
import { handleGoogleLogin, handleMe } from "./auth.js";

export { GameRoom } from "./game.js";

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    try {
      // Health check — D1 ချိတ်မိ/မမိ စမ်းဖို့
      if (pathname === "/api/health" && method === "GET") {
        const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM settings").first();
        return json(
          {
            ok: true,
            settings_rows: row.n,
            demo: true,
            google_client_id_set: Boolean(env.GOOGLE_CLIENT_ID),
            jwt_secret_set: Boolean(env.JWT_SECRET),
          },
          200,
          request,
          env
        );
      }

      // Auth
      if (pathname === "/api/auth/google" && method === "POST") return handleGoogleLogin(request, env);
      if (pathname === "/api/me" && method === "GET") return handleMe(request, env);

      return json({ error: "Not found" }, 404, request, env);
    } catch (e) {
      console.error(e);
      return json({ error: "Server error" }, 500, request, env);
    }
  },
};
