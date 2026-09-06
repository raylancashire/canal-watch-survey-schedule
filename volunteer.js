import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const fmtDate = (value) => new Date(value + 'T12:00:00Z').toLocaleDateString('en-GB', {
  weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
});

let volunteer = null;
let rounds = [];
let sites = [];
let roundSites = [];
let assignments = [];
let myAssignments = [];
let activeTab = 'available';
let leafletPromise = null;
let openMapSiteId = null;
const mapInstances = new Map();

function setMessage(target, text, error = false) {
  target.innerHTML = text
    ? `<div class="notice-box${error ? ' error' : ''}">${escapeHtml(text)}</div>`
    : '';
}

async function sendMagicLink(email) {
  const redirectTo = 'https://raylancashire.github.io/canal-watch-survey-schedule/volunteer.html';
  return supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo, shouldCreateUser: true }
  });
}

async function claimVolunteerProfile() {
  const { data, error } = await supabase.rpc('claim_volunteer_profile');
  if (error) throw error;
  if (!data || !data.length) {
    throw new Error('No active Canal Watch volunteer record was found for this email address.');
  }
  volunteer = data[0];
}

async function loadSchedule() {
  const [roundsResult, sitesResult, roundSitesResult, assignmentsResult, mineResult] = await Promise.all([
    supabase.from('survey_rounds')
      .select('id,name,survey_date,status')
      .eq('status', 'planned')
      .gte('survey_date', new Date().toISOString().slice(0, 10))
      .order('survey_date'),

    supabase.from('survey_sites')
      .select('id,name,address,latitude,longitude,three_word_location,active')
      .eq('active', true),

    supabase.from('survey_round_sites')
      .select('survey_round_id,survey_site_id'),

    supabase.from('site_assignments')
      .select('id,survey_round_id,survey_site_id,status')
      .neq('status', 'cancelled'),

    supabase.rpc('my_volunteer_assignments')
  ]);

  const problem = [roundsResult, sitesResult, roundSitesResult, assignmentsResult, mineResult]
    .find((result) => result.error);
  if (problem) throw problem.error;

  rounds = roundsResult.data || [];
  sites = sitesResult.data || [];
  roundSites = roundSitesResult.data || [];
  assignments = assignmentsResult.data || [];
  myAssignments = mineResult.data || [];
  renderSchedule();
}

function siteFor(siteId) { return sites.find((site) => site.id === siteId); }
function assignmentFor(roundId, siteId) {
  return assignments.find((a) => a.survey_round_id === roundId && a.survey_site_id === siteId);
}
function isMine(assignmentId) {
  return myAssignments.some((item) => item.assignment_id === assignmentId);
}

function entries() {
  const result = [];
  rounds.forEach((round) => {
    roundSites
      .filter((row) => row.survey_round_id === round.id)
      .forEach((row) => {
        const assignment = assignmentFor(round.id, row.survey_site_id);
        result.push({
          round,
          siteId: row.survey_site_id,
          assignment,
          mine: assignment ? isMine(assignment.id) : false
        });
      });
  });
  return result;
}

function mapButton(site) {
  const lat = Number(site?.latitude);
  const lon = Number(site?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';

  const words = site.three_word_location
    ? `///${escapeHtml(String(site.three_word_location).replace(/^\/+/, ''))}`
    : '';

  return `
    <div class="site-map-disclosure">
      <button type="button" class="site-map-toggle" data-site-map-toggle="${site.id}" aria-expanded="false">
        View map ＋
      </button>
      <div class="site-map-panel hidden" data-site-map-panel="${site.id}">
        ${(site.address || words) ? `<div class="site-map-meta">${site.address ? escapeHtml(site.address) : ''}${site.address && words ? ' • ' : ''}${words}</div>` : ''}
        <div id="volunteerSiteMap-${site.id}" class="site-map-canvas"></div>
        <a class="site-map-open-link" target="_blank" rel="noopener"
          href="https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}">
          Open larger map
        </a>
      </div>
    </div>`;
}

function renderSchedule() {
  const all = entries();
  const mine = all.filter((x) => x.mine);
  const available = all.filter((x) => !x.mine);

  $('availableCount').textContent = available.length;
  $('myCount').textContent = mine.length;

  document.querySelectorAll('[data-volunteer-tab]').forEach((button) => {
    const on = button.dataset.volunteerTab === activeTab;
    button.classList.toggle('active', on);
    button.setAttribute('aria-selected', String(on));
  });

  $('tabHelp').innerHTML = activeTab === 'mine'
    ? 'These are the surveys you are currently covering. Use <strong>Remove me</strong> if you can no longer attend.'
    : 'Choose <strong>Assign me</strong> beside a survey site you can cover.';

  const shown = activeTab === 'mine' ? mine : available;

  if (!shown.length) {
    $('surveyList').innerHTML = `<div class="survey-empty">${
      activeTab === 'mine'
        ? 'You are not currently assigned to any upcoming surveys.'
        : 'There are no other upcoming survey sites available.'
    }</div>`;
    return;
  }

  $('surveyList').innerHTML = shown.map(({ round, siteId, assignment, mine }) => {
    const site = siteFor(siteId) || {};
    return `
      <article class="survey-option${mine ? ' assigned-to-me' : ''}">
        <div>
          <h3>${escapeHtml(site.name || 'Unknown site')}</h3>
          <p class="survey-meta">${escapeHtml(round.name)}</p>
          <span class="survey-date-badge">${escapeHtml(fmtDate(round.survey_date))}</span>
          ${site.address ? `<p class="survey-meta" style="margin-top:7px">${escapeHtml(site.address)}</p>` : ''}
          ${mine ? '<span class="my-badge">Assigned to you</span>' : ''}
          ${mapButton(site)}
        </div>
        <div>
          ${mine
            ? `<button class="volunteer-button danger" type="button" data-unassign="${assignment.id}">Remove me</button>`
            : `<button class="volunteer-button" type="button" data-assign-round="${round.id}" data-assign-site="${siteId}">Assign me</button>`}
        </div>
      </article>`;
  }).join('');
}

async function assignSelf(roundId, siteId, button) {
  button.disabled = true;
  button.textContent = 'Assigning…';

  const { error } = await supabase.rpc('volunteer_self_assign', {
    p_round_id: Number(roundId), p_site_id: Number(siteId)
  });

  if (error) {
    setMessage($('portalMessage'), error.message || 'Unable to assign you to this survey.', true);
    button.disabled = false;
    button.textContent = 'Assign me';
    return;
  }

  setMessage($('portalMessage'), 'You have been assigned to the survey site.');
  activeTab = 'mine';
  await loadSchedule();
}

async function unassignSelf(assignmentId, button) {
  button.disabled = true;
  button.textContent = 'Removing…';

  const { error } = await supabase.rpc('volunteer_self_unassign', {
    p_assignment_id: Number(assignmentId)
  });

  if (error) {
    setMessage($('portalMessage'), error.message || 'Unable to remove your assignment.', true);
    button.disabled = false;
    button.textContent = 'Remove me';
    return;
  }

  setMessage($('portalMessage'), 'Your assignment has been removed.');
  await loadSchedule();
}

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;

  leafletPromise = new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => resolve(window.L);
    script.onerror = reject;
    document.head.appendChild(script);
  });

  return leafletPromise;
}

async function toggleMap(siteId, button) {
  const panel = document.querySelector(`[data-site-map-panel="${siteId}"]`);
  if (!panel) return;

  const opening = panel.classList.contains('hidden');
  if (!opening) {
    panel.classList.add('hidden');
    button.setAttribute('aria-expanded', 'false');
    button.textContent = 'View map ＋';
    openMapSiteId = null;
    return;
  }

  if (openMapSiteId && openMapSiteId !== siteId) {
    const oldPanel = document.querySelector(`[data-site-map-panel="${openMapSiteId}"]`);
    const oldButton = document.querySelector(`[data-site-map-toggle="${openMapSiteId}"]`);
    oldPanel?.classList.add('hidden');
    if (oldButton) {
      oldButton.setAttribute('aria-expanded', 'false');
      oldButton.textContent = 'View map ＋';
    }
  }

  panel.classList.remove('hidden');
  button.setAttribute('aria-expanded', 'true');
  button.textContent = 'Hide map −';
  openMapSiteId = siteId;

  const site = siteFor(siteId);
  if (!site) return;
  const L = await loadLeaflet();
  const lat = Number(site.latitude), lon = Number(site.longitude);

  if (!mapInstances.has(siteId)) {
    const map = L.map(`volunteerSiteMap-${siteId}`, { scrollWheelZoom: false }).setView([lat, lon], 17);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    L.marker([lat, lon]).addTo(map).bindPopup(`<strong>${escapeHtml(site.name)}</strong>`).openPopup();
    mapInstances.set(siteId, map);
  }
  setTimeout(() => mapInstances.get(siteId)?.invalidateSize(), 80);
}

async function showPortal() {
  try {
    await claimVolunteerProfile();
    $('signedInAs').textContent = `Signed in as ${volunteer.name}`;
    $('loginCard').classList.add('hidden');
    $('portalCard').classList.remove('hidden');
    await loadSchedule();
  } catch (error) {
    $('portalCard').classList.add('hidden');
    $('loginCard').classList.remove('hidden');
    setMessage($('loginMessage'), error.message || 'Unable to open the volunteer portal.', true);
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
    setMessage($('loginMessage'), error.message || 'Unable to send the sign-in link.', true);
  } else {
    setMessage($('loginMessage'), 'Check your email and click the secure sign-in link.');
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
  const tab = event.target.closest('[data-volunteer-tab]');
  if (tab) {
    activeTab = tab.dataset.volunteerTab;
    renderSchedule();
    return;
  }

  const assignButton = event.target.closest('[data-assign-round]');
  if (assignButton) {
    await assignSelf(assignButton.dataset.assignRound, assignButton.dataset.assignSite, assignButton);
    return;
  }

  const removeButton = event.target.closest('[data-unassign]');
  if (removeButton) {
    await unassignSelf(removeButton.dataset.unassign, removeButton);
    return;
  }

  const mapButton = event.target.closest('[data-site-map-toggle]');
  if (mapButton) {
    await toggleMap(Number(mapButton.dataset.siteMapToggle), mapButton);
  }
});

supabase.auth.onAuthStateChange(async (_event, session) => {
  if (session?.user) await showPortal();
});

const { data: sessionData } = await supabase.auth.getSession();
if (sessionData.session?.user) await showPortal();
