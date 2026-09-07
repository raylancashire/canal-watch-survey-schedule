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

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("CONTACT_FROM_EMAIL");
  const contactEmail = Deno.env.get("CANAL_WATCH_CONTACT_EMAIL");

  if (!supabaseUrl || !serviceRole) {
    return reply({ error: "Server configuration is incomplete." }, 500);
  }

  if (!resendApiKey || !fromEmail || !contactEmail) {
    return reply({ error: "Canal Watch contact email has not yet been configured." }, 503);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return reply({ error: "Invalid request." }, 400);
  }

  const name = clean(body.name, 120);
  const email = clean(body.email, 254);
  const message = clean(body.message, 6000);
  const roundId = body.requested_round_id ? Number(body.requested_round_id) : null;
  const siteId = body.requested_site_id ? Number(body.requested_site_id) : null;

  if (!name || !email.includes("@") || !message) {
    return reply({ error: "Complete all contact fields." }, 400);
  }

  const db = createClient(supabaseUrl, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  let context = "";

  if (roundId && siteId) {
    const [{ data: round }, { data: site }] = await Promise.all([
      db.from("survey_rounds").select("name,survey_date").eq("id", roundId).maybeSingle(),
      db.from("survey_sites").select("name").eq("id", siteId).maybeSingle()
    ]);

    context = [
      round?.name ? `Round: ${round.name}` : "",
      round?.survey_date ? `Date: ${round.survey_date}` : "",
      site?.name ? `Site: ${site.name}` : ""
    ].filter(Boolean).join("\n");
  }

  const text = [
    "Canal Watch volunteer registration enquiry",
    "",
    `Name: ${name}`,
    `Email: ${email}`,
    context ? `\nSelected survey:\n${context}` : "",
    "",
    "Message:",
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
      to: [contactEmail],
      reply_to: email,
      subject: "[Canal Watch] Volunteer registration enquiry",
      text
    })
  });

  if (!mail.ok) {
    console.error(await mail.text());
    return reply({ error: "The email service could not send this message." }, 502);
  }

  return reply({ ok: true });
});
