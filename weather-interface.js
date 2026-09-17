import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import * as CONFIG from './config.js';

const SUPABASE_URL = CONFIG.SUPABASE_URL;
const SUPABASE_BROWSER_KEY = CONFIG.SUPABASE_PUBLISHABLE_KEY || CONFIG.SUPABASE_ANON_KEY;

console.log('Weather interface starting');

if (!SUPABASE_URL || !SUPABASE_BROWSER_KEY) {
  throw new Error('Weather interface could not read the Supabase browser configuration.');
}
var weatherSupabase = createClient(SUPABASE_URL, SUPABASE_BROWSER_KEY);
var weatherData = {
  rounds: [],
  sites: [],
  roundSites: [],
  weatherSites: [],
  forecasts: []
};

function weatherEscape(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

function weatherDistanceKm(lat1, lon1, lat2, lon2) {
  function rad(v) { return v * Math.PI / 180; }
  var dLat = rad(lat2 - lat1);
  var dLon = rad(lon2 - lon1);
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nearestWeatherSite(site) {
  if (!site || site.latitude == null || site.longitude == null) return null;
  var best = null;
  var bestDistance = Infinity;

  weatherData.weatherSites.forEach(function (candidate) {
    if (candidate.latitude == null || candidate.longitude == null) return;
    var d = weatherDistanceKm(
      Number(site.latitude), Number(site.longitude),
      Number(candidate.latitude), Number(candidate.longitude)
    );
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  });
  return best;
}

var londonFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

function londonParts(value) {
  var d = new Date(value);
  if (isNaN(d.getTime())) return null;
  var result = {};
  londonFormatter.formatToParts(d).forEach(function (p) {
    if (p.type !== 'literal') result[p.type] = p.value;
  });
  return result;
}

function closestForecast(round, site) {
  if (!round || !round.survey_date || !round.survey_time || !site) return null;

  var weatherSite = nearestWeatherSite(site);
  if (!weatherSite) return null;

  var timeBits = String(round.survey_time).slice(0, 5).split(':');
  var targetMinutes = Number(timeBits[0]) * 60 + Number(timeBits[1]);
  if (!isFinite(targetMinutes)) return null;

  var best = null;
  var bestDifference = Infinity;

  weatherData.forecasts.forEach(function (forecast) {
    if (Number(forecast.monitoring_site_id) !== Number(weatherSite.id)) return;
    var p = londonParts(forecast.forecast_for);
    if (!p) return;

    var forecastDate = p.year + '-' + p.month + '-' + p.day;
    if (forecastDate !== round.survey_date) return;

    var forecastMinutes = Number(p.hour) * 60 + Number(p.minute);
    var difference = Math.abs(forecastMinutes - targetMinutes);

    if (difference < bestDifference) {
      bestDifference = difference;
      best = forecast;
    }
  });

  if (!best || bestDifference > 120) return null;
  return best;
}

function weatherDescription(code) {
  var descriptions = {
    0:'Clear night',1:'Sunny',2:'Partly cloudy',3:'Partly cloudy',
    5:'Mist',6:'Fog',7:'Cloudy',8:'Overcast',
    9:'Light rain shower',10:'Light rain shower',11:'Drizzle',12:'Light rain',
    13:'Heavy rain shower',14:'Heavy rain shower',15:'Heavy rain',
    16:'Sleet shower',17:'Sleet shower',18:'Sleet',
    19:'Hail shower',20:'Hail shower',21:'Hail',
    22:'Light snow shower',23:'Light snow shower',24:'Light snow',
    25:'Heavy snow shower',26:'Heavy snow shower',27:'Heavy snow',
    28:'Thunder shower',29:'Thunder shower',30:'Thunder'
  };
  return descriptions[Number(code)] || '';
}

function shownDate(dateString) {
  return new Date(dateString + 'T12:00:00Z').toLocaleDateString(
    'en-GB',
    {day:'numeric', month:'long', year:'numeric', timeZone:'UTC'}
  );
}

function findSurveyForRow(row) {
  var cells = row.querySelectorAll('td');
  if (cells.length < 2) return null;

  var strong = cells[0].querySelector('strong');
  if (!strong) return null;

  var siteName = strong.textContent.trim();
  var dateText = cells[1].textContent.trim();
  var site = null;

  weatherData.sites.some(function (candidate) {
    if (String(candidate.name || '').trim() === siteName) {
      site = candidate;
      return true;
    }
    return false;
  });
  if (!site) return null;

  var foundRound = null;
  weatherData.rounds.some(function (round) {
    if (!round.survey_time) return false;

    var expected = shownDate(round.survey_date) + ' · ' +
      String(round.survey_time).slice(0, 5);

    if (dateText !== expected) return false;

    var linked = weatherData.roundSites.some(function (rs) {
      return Number(rs.survey_round_id) === Number(round.id) &&
        Number(rs.survey_site_id) === Number(site.id);
    });

    if (linked) {
      foundRound = round;
      return true;
    }
    return false;
  });

  if (!foundRound) return null;
  return {round: foundRound, site: site};
}

function weatherMarkup(round, site) {
  var time = String(round.survey_time || '').slice(0, 5);
  var forecast = closestForecast(round, site);

  if (!forecast) {
    return '<div class="canal-weather-interface" style="margin-top:6px">' +
      '<small><strong>Expected weather at ' + weatherEscape(time) +
      ':</strong> Forecast not yet available</small></div>';
  }

  var details = [];
  var description = weatherDescription(forecast.weather_code);
  var temp = Number(forecast.temperature_c);
  var rain = Number(forecast.precipitation_probability);

  if (description) details.push(description);
  if (isFinite(temp)) details.push(Math.round(temp) + '°C');
  if (isFinite(rain)) details.push(Math.round(rain) + '% chance of rain');

  return '<div class="canal-weather-interface" style="margin-top:6px">' +
    '<small><strong>Expected weather at ' + weatherEscape(time) +
    ':</strong> ' + weatherEscape(details.join(' · ')) + '</small></div>';
}

function applyWeatherInterface() {
  var rows = document.querySelectorAll('tr.survey-main-row');

  rows.forEach(function (row) {
    if (row.querySelector('.canal-weather-interface')) return;

    var match = findSurveyForRow(row);
    if (!match) return;

    var firstCell = row.querySelector('td:first-child');
    if (!firstCell) return;

    var surveyName = firstCell.querySelector('small');
    if (!surveyName) return;

    surveyName.insertAdjacentHTML(
      'afterend',
      weatherMarkup(match.round, match.site)
    );
  });
}

function loadWeatherInterface() {
  var today = new Date().toISOString().slice(0, 10);

  Promise.all([
    weatherSupabase.from('survey_rounds')
      .select('id,survey_date,survey_time,status')
      .eq('status','planned')
      .gte('survey_date',today),
    weatherSupabase.from('survey_sites')
      .select('id,name,latitude,longitude')
      .eq('active',true),
    weatherSupabase.from('survey_round_sites')
      .select('survey_round_id,survey_site_id'),
    weatherSupabase.from('weather_monitoring_sites')
      .select('id,site_name,latitude,longitude')
      .eq('active',true),
    weatherSupabase.from('weather_forecasts')
      .select('monitoring_site_id,forecast_for,temperature_c,weather_code,precipitation_probability')
  ]).then(function (results) {
    var failed = null;
    results.some(function (result) {
      if (result.error) {
        failed = result.error;
        return true;
      }
      return false;
    });
    if (failed) throw failed;

    weatherData.rounds = results[0].data || [];
    weatherData.sites = results[1].data || [];
    weatherData.roundSites = results[2].data || [];
    weatherData.weatherSites = results[3].data || [];
    weatherData.forecasts = results[4].data || [];

    console.log(
      'Weather interface ready: ' +
      weatherData.weatherSites.length + ' weather sites, ' +
      weatherData.forecasts.length + ' forecast periods'
    );

    applyWeatherInterface();

    var target = document.querySelector('main') || document.body;
    var timer = null;
    var observer = new MutationObserver(function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(applyWeatherInterface, 50);
    });
    observer.observe(target, {childList:true, subtree:true});
  }).catch(function (error) {
    console.error('Weather interface unavailable:', error);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadWeatherInterface);
} else {
  loadWeatherInterface();
}
