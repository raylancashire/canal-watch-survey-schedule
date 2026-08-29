import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRole) {
    return json({ error: "Server configuration is incomplete." }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Authentication required." }, 401);
  }

  const admin = createClient(supabaseUrl, serviceRole, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  const token = authHeader.slice("Bearer ".length);
  const { data: userData, error: userError } = await admin.auth.getUser(token);

  if (userError || !userData.user) {
    return json({ error: "Invalid or expired session." }, 401);
  }

  const callerId = userData.user.id;

  const { data: caller, error: callerError } = await admin
    .from("admin_profiles")
    .select("id,can_manage,can_manage_admins,active")
    .eq("id", callerId)
    .single();

  if (
    callerError ||
    !caller?.active ||
    !caller?.can_manage ||
    !caller?.can_manage_admins
  ) {
    return json({ error: "You do not have permission to manage administrators." }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const action = String(body.action || "");

  if (action === "invite") {
    const email = String(body.email || "").trim().toLowerCase();
    const displayName = String(body.display_name || "").trim();
    const canManageAdmins = Boolean(body.can_manage_admins);
    const redirectTo = String(body.redirect_to || "").trim();

    if (!email || !email.includes("@")) {
      return json({ error: "Enter a valid email address." }, 400);
    }

    const options: {
      data?: Record<string, unknown>;
      redirectTo?: string;
    } = {
      data: { display_name: displayName || email.split("@")[0] },
    };

    if (redirectTo) options.redirectTo = redirectTo;

    const { data, error } = await admin.auth.admin.inviteUserByEmail(
      email,
      options,
    );

    if (error || !data.user) {
      return json({ error: error?.message || "Unable to invite administrator." }, 400);
    }

    const { error: profileError } = await admin
      .from("admin_profiles")
      .upsert({
        id: data.user.id,
        display_name: displayName || email.split("@")[0],
        email,
        can_manage: true,
        can_manage_admins: canManageAdmins,
        active: true,
      });

    if (profileError) {
      return json({ error: profileError.message }, 500);
    }

    return json({
      ok: true,
      message: "Administrator invitation sent.",
      user_id: data.user.id,
    });
  }

  if (action === "update") {
    const targetId = String(body.user_id || "");
    const canManage = Boolean(body.can_manage);
    const canManageAdmins = Boolean(body.can_manage_admins);
    const active = Boolean(body.active);

    if (!targetId) {
      return json({ error: "Administrator ID is required." }, 400);
    }

    if (targetId === callerId && (!active || !canManage || !canManageAdmins)) {
      return json({
        error:
          "You cannot remove your own Admin Manager access. Another Admin Manager must change your permissions.",
      }, 400);
    }

    const { error } = await admin
      .from("admin_profiles")
      .update({
        can_manage: canManage,
        can_manage_admins: canManage && canManageAdmins,
        active,
      })
      .eq("id", targetId);

    if (error) return json({ error: error.message }, 500);

    return json({ ok: true, message: "Administrator permissions updated." });
  }

  if (action === "resend_invite") {
    const email = String(body.email || "").trim().toLowerCase();
    const redirectTo = String(body.redirect_to || "").trim();

    if (!email) return json({ error: "Email address is required." }, 400);

    // Supabase's invite API returns an error if the user is already confirmed.
    const options: { redirectTo?: string } = {};
    if (redirectTo) options.redirectTo = redirectTo;

    const { error } = await admin.auth.admin.inviteUserByEmail(email, options);

    if (error) return json({ error: error.message }, 400);
    return json({ ok: true, message: "Invitation sent again." });
  }

  return json({ error: "Unknown action." }, 400);
});
