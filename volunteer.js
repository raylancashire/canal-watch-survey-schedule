import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));

const fmtDate = (value) =>
  new Date(value + 'T12:00:00Z').toLocaleDateString(
    'en-GB',
    {
      weekday: 'short',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC'
    }
  );

let volunteer = null;
let rounds = [];
let sites = [];
let roundSites = [];
let assignments = [];
let myAssignments = [];

function setMessage(target, text, error = false) {
  target.innerHTML = text
    ? `<div class="notice-box${error ? ' error' : ''}">${escapeHtml(text)}</div>`
    : '';
}

async function sendMagicLink(email) {
  const redirectTo =
    'https://raylancashire.github.io/canal-watch-survey-schedule/volunteer.html';

  return supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectTo,
      shouldCreateUser: true
    }
  });
}

async function claimVolunteerProfile() {
  const { data, error } = await supabase.rpc('claim_volunteer_profile');

  if (error) {
    throw error;
  }

  if (!data || !data.length) {
    throw new Error(
      'No active Canal Watch volunteer record was found for this email address.'
    );
  }

  volunteer = data[0];
}

async function loadSchedule() {
  const [
    roundsResult,
    sitesResult,
    roundSitesResult,
    assignmentsResult,
    mineResult
  ] = await Promise.all([
    supabase
      .from('survey_rounds')
      .select('id,name,survey_date,status')
      .neq('status', 'inactive')
      .gte('survey_date', new Date().toISOString().slice(0, 10))
      .order('survey_date'),

    supabase
      .from('survey_sites')
      .select('id,name,address,active')
      .eq('active', true),

    supabase
      .from('survey_round_sites')
      .select('survey_round_id,survey_site_id'),

    supabase
      .from('site_assignments')
      .select('id,survey_round_id,survey_site_id,status')
      .neq('status', 'cancelled'),

    supabase.rpc('my_volunteer_assignments')
  ]);

  const problem = [
    roundsResult,
    sitesResult,
    roundSitesResult,
    assignmentsResult,
    mineResult
  ].find((result) => result.error);

  if (problem) {
    throw problem.error;
  }

  rounds = roundsResult.data || [];
  sites = sitesResult.data || [];
  roundSites = roundSitesResult.data || [];
  assignments = assignmentsResult.data || [];
  myAssignments = mineResult.data || [];

  renderSchedule();
}

function siteName(siteId) {
  return sites.find((site) => site.id === siteId)?.name || 'Unknown site';
}

function siteAddress(siteId) {
  return sites.find((site) => site.id === siteId)?.address || '';
}

function assignmentFor(roundId, siteId) {
  return assignments.find(
    (a) =>
      a.survey_round_id === roundId &&
      a.survey_site_id === siteId
  );
}

function isMine(assignmentId) {
  return myAssignments.some(
    (item) => item.assignment_id === assignmentId
  );
}

function renderSchedule() {
  const list = $('surveyList');

  const entries = [];

  rounds.forEach((round) => {
    const roundSiteIds = roundSites
      .filter((row) => row.survey_round_id === round.id)
      .map((row) => row.survey_site_id);

    roundSiteIds.forEach((siteId) => {
      const assignment = assignmentFor(round.id, siteId);
      const mine = assignment ? isMine(assignment.id) : false;

      entries.push({
        round,
        siteId,
        assignment,
        mine
      });
    });
  });

  if (!entries.length) {
    list.innerHTML = '<p>No upcoming survey sites are currently scheduled.</p>';
    return;
  }

  list.innerHTML = entries.map(({ round, siteId, assignment, mine }) => {
    const address = siteAddress(siteId);

    return `
      <article class="survey-option${mine ? ' assigned-to-me' : ''}">
        <div>
          <h3>${escapeHtml(siteName(siteId))}</h3>

          <p class="survey-meta">
            ${escapeHtml(round.name)} • ${escapeHtml(fmtDate(round.survey_date))}
          </p>

          ${address
            ? `<p class="survey-meta">${escapeHtml(address)}</p>`
            : ''}

          ${mine
            ? '<span class="my-badge">Assigned to you</span>'
            : ''}
        </div>

        <div>
          ${mine
            ? `<button
                 class="volunteer-button danger"
                 type="button"
                 data-unassign="${assignment.id}">
                 Remove me
               </button>`
            : `<button
                 class="volunteer-button"
                 type="button"
                 data-assign-round="${round.id}"
                 data-assign-site="${siteId}">
                 Assign me
               </button>`}
        </div>
      </article>
    `;
  }).join('');
}

async function assignSelf(roundId, siteId, button) {
  button.disabled = true;
  button.textContent = 'Assigning…';

  const { data, error } = await supabase.rpc(
    'volunteer_self_assign',
    {
      p_round_id: Number(roundId),
      p_site_id: Number(siteId)
    }
  );

  if (error) {
    setMessage(
      $('portalMessage'),
      error.message || 'Unable to assign you to this survey.',
      true
    );
    button.disabled = false;
    button.textContent = 'Assign me';
    return;
  }

  setMessage($('portalMessage'), 'You have been assigned to the survey site.');
  await loadSchedule();
}

async function unassignSelf(assignmentId, button) {
  button.disabled = true;
  button.textContent = 'Removing…';

  const { error } = await supabase.rpc(
    'volunteer_self_unassign',
    {
      p_assignment_id: Number(assignmentId)
    }
  );

  if (error) {
    setMessage(
      $('portalMessage'),
      error.message || 'Unable to remove your assignment.',
      true
    );
    button.disabled = false;
    button.textContent = 'Remove me';
    return;
  }

  setMessage($('portalMessage'), 'Your assignment has been removed.');
  await loadSchedule();
}

async function showPortal() {
  try {
    await claimVolunteerProfile();

    $('signedInAs').textContent =
      `Signed in as ${volunteer.name}`;

    $('loginCard').classList.add('hidden');
    $('portalCard').classList.remove('hidden');

    await loadSchedule();
  } catch (error) {
    $('portalCard').classList.add('hidden');
    $('loginCard').classList.remove('hidden');

    setMessage(
      $('loginMessage'),
      error.message || 'Unable to open the volunteer portal.',
      true
    );
  }
}

$('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  const email = $('emailInput').value.trim();
  const button = $('loginButton');

  button.disabled = true;
  button.textContent = 'Sending…';
  setMessage($('loginMessage'), '');

  const { error } = await sendMagicLink(email);

  if (error) {
    setMessage(
      $('loginMessage'),
      error.message || 'Unable to send the sign-in link.',
      true
    );
  } else {
    setMessage(
      $('loginMessage'),
      'Check your email and click the secure sign-in link.'
    );
  }

  button.disabled = false;
  button.textContent = 'Email sign-in link';
});

$('signOutButton').addEventListener('click', async () => {
  await supabase.auth.signOut();
  volunteer = null;
  $('portalCard').classList.add('hidden');
  $('loginCard').classList.remove('hidden');
  $('emailInput').value = '';
  setMessage($('loginMessage'), 'You have been signed out.');
});

document.addEventListener('click', async (event) => {
  const assignButton = event.target.closest('[data-assign-round]');
  if (assignButton) {
    await assignSelf(
      assignButton.dataset.assignRound,
      assignButton.dataset.assignSite,
      assignButton
    );
    return;
  }

  const removeButton = event.target.closest('[data-unassign]');
  if (removeButton) {
    await unassignSelf(
      removeButton.dataset.unassign,
      removeButton
    );
  }
});

supabase.auth.onAuthStateChange(async (_event, session) => {
  if (session?.user) {
    await showPortal();
  }
});

const { data: sessionData } = await supabase.auth.getSession();

if (sessionData.session?.user) {
  await showPortal();
}
