import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clean(value: unknown, max = 5000) {
  return String(value ?? "").trim().slice(0, max);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("CONTACT_FROM_EMAIL");

  if (!supabaseUrl || !serviceRole) {
    return reply({ error: "Server configuration is incomplete." }, 500);
  }

  if (!resendApiKey || !fromEmail) {
    return reply({ error: "Coordinator email sending has not yet been configured." }, 503);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return reply({ error: "Invalid request." }, 400); }

  const teamId = Number(body.team_id);
  const senderName = clean(body.sender_name, 120);
  const senderEmail = clean(body.sender_email, 254);
  const subject = clean(body.subject, 180);
  const message = clean(body.message, 6000);

  if (!Number.isInteger(teamId) || teamId <= 0) return reply({ error: "Invalid project team." }, 400);
  if (!senderName || !senderEmail.includes("@") || !subject || !message) {
    return reply({ error: "Complete all contact fields." }, 400);
  }

  const db = createClient(supabaseUrl, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { data: team, error: teamError } = await db
    .from("project_teams")
    .select("id,name,coordinator_id,active")
    .eq("id", teamId)
    .eq("active", true)
    .single();

  if (teamError || !team) return reply({ error: "Project team not found." }, 404);

  const { data: coordinator, error: coordinatorError } = await db
    .from("volunteers")
    .select("name,email,active")
    .eq("id", team.coordinator_id)
    .eq("active", true)
    .single();

  if (coordinatorError || !coordinator) return reply({ error: "Coordinator not found." }, 404);
  if (!coordinator.email) return reply({ error: "This coordinator does not currently have an email address." }, 400);

  const text = [
    "Canal Watch survey enquiry",
    "",
    `Project team: ${team.name}`,
    `Coordinator: ${coordinator.name}`,
    "",
    `From: ${senderName} <${senderEmail}>`,
    "",
    message
  ].join("\n");

  const mail = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [coordinator.email],
      reply_to: senderEmail,
      subject: `[Canal Watch] ${subject}`,
      text
    })
  });

  if (!mail.ok) {
    console.error(await mail.text());
    return reply({ error: "The email service could not send this message." }, 502);
  }

  return reply({ ok: true });
});
