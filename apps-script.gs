const CONFIG = {
  CONFIG_SHEET: 'Config',
  SENT_ALERTS_SHEET: 'SentAlerts',
  MATCHES_SHEET: 'Matches',
  LASTFM_BASE_URL: 'https://ws.audioscrobbler.com/2.0/',
  TM_BASE_URL: 'https://app.ticketmaster.com/discovery/v2/events.json',
  LOOKBACK_YEARS: 2,
  TM_SIZE: 10,
  MAX_WEEKLY_CHARTS: 110, // ~2 years + buffer
};

function setup() {
  ensureSheets_();
  Logger.log('Setup complete.');
}

function runAlerts() {
  ensureSheets_();

  const settings = getConfig_();

  if (!settings.alerts_active) {
    Logger.log('Alerts are turned off.');
    return;
  }

if (!settings.lastfm_username || !settings.cities.length || !settings.email) {
  throw new Error('Missing required config values: lastfm_username, city, or email');
}

const minListens = settings.min_listens;

Logger.log(`Running alerts for ${settings.lastfm_username} in ${settings.cities.join(', ')}`);

const qualifiedArtists = getQualifiedArtists_(settings.lastfm_username, minListens);
Logger.log(`Qualified artists found: ${qualifiedArtists.length}`);

if (!qualifiedArtists.length) {
  clearMatches_();
  Logger.log('No qualified artists found.');
  return;
}

const events = findAllEvents_(settings.cities, qualifiedArtists);
  Logger.log(`Events found: ${events.length}`);

  writeMatches_(events);

  if (!events.length) {
    Logger.log('No events found.');
    return;
  }

  const sentKeys = getSentEventKeys_();
  const newEvents = events.filter(e => !sentKeys[e.event_key]);

  Logger.log(`New events to email: ${newEvents.length}`);

  if (!newEvents.length) {
    Logger.log('No new events to send.');
    return;
  }

  sendAlertEmail_(settings, newEvents);
  recordSentAlerts_(newEvents);
}

function testLastfm() {
  ensureSheets_();
  const settings = getConfig_();
  const minListens = settings.min_listens;

  const artists = getQualifiedArtists_(settings.lastfm_username, minListens);
  Logger.log(`Total qualified artists: ${artists.length}`);
  Logger.log(JSON.stringify(artists, null, 2));
}

function testEvents() {
  ensureSheets_();
  const settings = getConfig_();
  const minListens = settings.min_listens;

  Logger.log(`Using min_listens: ${minListens}`);
  Logger.log(`Spreadsheet name: ${SpreadsheetApp.getActiveSpreadsheet().getName()}`);
  Logger.log(`Spreadsheet URL: ${SpreadsheetApp.getActiveSpreadsheet().getUrl()}`);

  const artists = getQualifiedArtists_(settings.lastfm_username, minListens);
  const events = findAllEvents_(settings.cities, artists);

  Logger.log(`Artists checked: ${artists.length}`);
  Logger.log(`Events found: ${events.length}`);
  Logger.log(JSON.stringify(events, null, 2));
}

function testEmail() {
  ensureSheets_();
  const settings = getConfig_();

  const fakeEvents = [{
  event_key: 'test artist|2026-05-01|test city|test venue|ticketmaster',
  artist_name: 'Test Artist',
  playcount: 99,
  event_date: '2026-05-01',
  city: 'Berlin',
  venue: 'Test Venue',
  source: 'ticketmaster',
  ticket_url: 'https://example.com'
  }];

  sendAlertEmail_(settings, fakeEvents);
}

function createDailyTrigger() {
  const triggers = ScriptApp.getProjectTriggers();

  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'runAlerts') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger('runAlerts')
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .create();

  Logger.log('Daily trigger created.');
}

function getQualifiedArtists_(username, minListens) {
  const apiKey = getScriptProperty_('LASTFM_API_KEY');
  const charts = getRelevantWeeklyCharts_(username, apiKey);

  if (!charts.length) {
    return [];
  }

  const counts = {};

  charts.forEach(chart => {
    try {
      const weeklyArtists = getWeeklyArtistChart_(username, apiKey, chart.from, chart.to);

      weeklyArtists.forEach(artist => {
        const artistName = normalizeArtistName_(artist.name || '');
        const playcount = Number(artist.playcount || 0);

        if (!artistName || !playcount) return;

        counts[artistName] = (counts[artistName] || 0) + playcount;
      });

    } catch (error) {
      Logger.log(`Skipping weekly chart ${chart.from}-${chart.to}: ${error.message}`);
    }

    Utilities.sleep(150);
  });

  return Object.keys(counts)
    .map(name => ({
      artist_name: name,
      playcount: counts[name],
    }))
    .filter(artist => artist.artist_name && artist.playcount >= minListens)
    .sort((a, b) => b.playcount - a.playcount);
}

function getRelevantWeeklyCharts_(username, apiKey) {
  const params = {
    method: 'user.getweeklychartlist',
    user: username,
    api_key: apiKey,
    format: 'json',
  };

  const data = fetchJson_(CONFIG.LASTFM_BASE_URL, params);

  if (data.error) {
    throw new Error(`Last.fm error: ${data.message}`);
  }

  const allCharts = (((data || {}).weeklychartlist || {}).chart) || [];
  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - CONFIG.LOOKBACK_YEARS);
  const cutoffUnix = Math.floor(cutoffDate.getTime() / 1000);

  return allCharts
    .map(chart => ({
      from: Number(chart.from),
      to: Number(chart.to),
    }))
    .filter(chart => chart.to >= cutoffUnix)
    .slice(-CONFIG.MAX_WEEKLY_CHARTS);
}

function getWeeklyArtistChart_(username, apiKey, fromTs, toTs) {
  const params = {
    method: 'user.getweeklyartistchart',
    user: username,
    api_key: apiKey,
    from: fromTs,
    to: toTs,
    format: 'json',
  };

  const data = fetchJson_(CONFIG.LASTFM_BASE_URL, params);

  if (data.error) {
    throw new Error(`Last.fm error: ${data.message}`);
  }

  return (((data || {}).weeklyartistchart || {}).artist) || [];
}

function findTicketmasterEvents_(cities, qualifiedArtists) {
  const apiKey = getScriptProperty_('TM_API_KEY');
  const allEvents = [];
  const seen = {};

  cities.forEach(city => {
    qualifiedArtists.forEach(artist => {
      const params = {
        apikey: apiKey,
        keyword: artist.artist_name,
        city: city,
        size: CONFIG.TM_SIZE,
        sort: 'date,asc',
      };

      const data = fetchJson_(CONFIG.TM_BASE_URL, params);
      const events = (((data || {})._embedded || {}).events) || [];

      events.forEach(ev => {
        const eventDate = (((ev.dates || {}).start || {}).localDate) || '';
        const venueObj = ((((ev._embedded || {}).venues || [])[0] || {}));
        const venue = venueObj.name || '';
        const eventCity = (((venueObj.city || {}).name) || city || '');
        const ticketUrl = ev.url || '';
        const eventName = ev.name || '';
        const attractionNames = getAttractionNames_(ev);

        if (!eventDate || !venue) return;
        if (!isStrongArtistMatch_(artist.artist_name, eventName, attractionNames)) return;

        const eventKey = buildEventKey_(artist.artist_name, eventDate, venue, eventCity, 'ticketmaster');

        if (seen[eventKey]) return;
        seen[eventKey] = true;

        allEvents.push({
          checked_at: new Date(),
          artist_name: artist.artist_name,
          playcount: artist.playcount,
          event_date: eventDate,
          city: eventCity,
          venue: venue,
          source: 'ticketmaster',
          ticket_url: ticketUrl,
          event_key: eventKey,
        });
      });

      Utilities.sleep(200);
    });
  });

  allEvents.sort((a, b) => {
    if (a.event_date < b.event_date) return -1;
    if (a.event_date > b.event_date) return 1;
    return b.playcount - a.playcount;
  });

  return allEvents;
}

function findAllEvents_(cities, qualifiedArtists) {
  const events = findTicketmasterEvents_(cities, qualifiedArtists);

  events.sort((a, b) => {
    if (a.event_date < b.event_date) return -1;
    if (a.event_date > b.event_date) return 1;
    return b.playcount - a.playcount;
  });

  return events;
}

function findAllEvents_(city, qualifiedArtists) {
  const events = findTicketmasterEvents_(city, qualifiedArtists);

  events.sort((a, b) => {
    if (a.event_date < b.event_date) return -1;
    if (a.event_date > b.event_date) return 1;
    return b.playcount - a.playcount;
  });

  return events;
}



function getAttractionNames_(eventObj) {
  const attractions = (((eventObj || {})._embedded || {}).attractions) || [];
  return attractions.map(a => a.name).filter(Boolean);
}

function isStrongArtistMatch_(targetArtist, eventName, attractionNames) {
  const target = normalizeArtistName_(targetArtist);
  const title = normalizeArtistName_(eventName || '');
  const attrs = (attractionNames || []).map(a => normalizeArtistName_(a));

  if (attrs.includes(target)) return true;
  if (title === target) return true;
  if (title.startsWith(target + ' ')) return true;
  if (title.endsWith(' ' + target)) return true;
  if (title.startsWith(target + ':')) return true;
  if (title.startsWith(target + ' -')) return true;

  return false;
}

function sendAlertEmail_(settings, events) {
  const groupedEvents = groupEventsByArtist_(events);
  const uniqueArtists = groupedEvents.map(group => titleCase_(group.artist_name));

  const artistNames = uniqueArtists
    .slice(0, 3)
    .join(', ');

  const subject =
    `🎵 ${artistNames}${uniqueArtists.length > 3 ? ' +' + (uniqueArtists.length - 3) : ''} live in ${settings.city} 🎤`;

  let htmlBody = '';
  htmlBody += `<div style="font-family: Arial, sans-serif; color: #222; line-height: 1.5; max-width: 680px; margin: 0 auto;">`;
  htmlBody += `<h2 style="margin-bottom: 8px;">🎶 Concert alert</h2>`;
  htmlBody += `<p style="margin-top: 0; font-size: 15px;">We found <strong>${events.length}</strong> upcoming concert${events.length > 1 ? 's' : ''} in <strong>${escapeHtml_(settings.city)}</strong> from artists you listen to.</p>`;

  groupedEvents.forEach(group => {
    const artistTitle = titleCase_(group.artist_name);
    const totalPlaycount = group.events[0].playcount;

    htmlBody += `<div style="border: 1px solid #e6e6e6; border-radius: 12px; padding: 16px; margin: 14px 0; background: #fafafa;">`;
    htmlBody += `<div style="font-size: 18px; font-weight: 700; margin-bottom: 6px;">🎤 ${escapeHtml_(artistTitle)}</div>`;
    htmlBody += `<div style="margin: 0 0 12px 0; color: #555;"><strong>🎧 Your listens:</strong> ${totalPlaycount}</div>`;

    group.events.forEach(event => {
      htmlBody += `<div style="padding: 12px 0; border-top: 1px solid #ececec;">`;
      htmlBody += `<div style="margin: 0 0 4px 0;"><strong>📅 Date:</strong> ${escapeHtml_(formatEventDate_(event.event_date))}</div>`;
      htmlBody += `<div style="margin: 0 0 8px 0;"><strong>📍 Location:</strong> ${escapeHtml_(event.city)} — ${escapeHtml_(event.venue)}</div>`;

     htmlBody += `<div style="margin-top: 10px;">`;

      if (event.ticket_url) {
       htmlBody += `<a href="${escapeHtml_(event.ticket_url)}" style="display: inline-block; padding: 10px 14px; background: #111; color: #fff; text-decoration: none; border-radius: 8px; margin-right: 8px;">View tickets</a>`;
       } else {
      htmlBody += `<div style="margin: 0 0 8px 0; font-size: 13px; color: #777;">Ticket info not found yet.</div>`;
}

htmlBody += `<a href="${escapeHtml_(buildGoogleCalendarUrl_(event))}" style="display: inline-block; padding: 10px 14px; background: #f1f1f1; color: #111; text-decoration: none; border-radius: 8px;">Add to calendar</a>`;
htmlBody += `</div>`;

      htmlBody += `</div>`;
    });

    htmlBody += `</div>`;
  });

  htmlBody += `<p style="margin-top: 24px;">Hope there’s something good in here for you ✨</p>`;
  htmlBody += `<p style="font-size: 12px; color: #666; margin-top: 24px;">To stop alerts, set <strong>alerts_active = FALSE</strong> in your Google Sheet Config tab.</p>`;
  htmlBody += `</div>`;

  let plainBody = '';
  plainBody += `Concert alert\n\n`;
  plainBody += `We found ${events.length} upcoming concert${events.length > 1 ? 's' : ''} in ${settings.city} from artists you listen to.\n\n`;

  groupedEvents.forEach(group => {
    plainBody += `${titleCase_(group.artist_name)}\n`;
    plainBody += `Your listens: ${group.events[0].playcount}\n`;

    group.events.forEach(event => {
      plainBody += `- ${formatEventDate_(event.event_date)} — ${event.city} — ${event.venue}\n`;

if (event.ticket_url) {
  plainBody += `  Tickets: ${event.ticket_url}\n`;
} else {
  plainBody += `  Ticket info not found yet.\n`;
}

plainBody += `  Add to calendar: ${buildGoogleCalendarUrl_(event)}\n`;
    });

    plainBody += `\n`;
  });

  plainBody += `Hope there’s something good in here for you.\n`;

  MailApp.sendEmail({
    to: settings.email,
    subject: subject,
    body: plainBody,
    htmlBody: htmlBody,
  });
}

function escapeHtml_(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function recordSentAlerts_(events) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SENT_ALERTS_SHEET);

  const rows = events.map(event => [
    event.event_key,
    event.artist_name,
    event.event_date,
    event.venue,
    event.source,
    new Date(),
  ]);

  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  }
}

function getSentEventKeys_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SENT_ALERTS_SHEET);
  const values = sheet.getDataRange().getValues();

  if (values.length < 2) return {};

  const headers = values[0];
  const eventKeyIndex = headers.indexOf('event_key');

  const map = {};
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const key = row[eventKeyIndex];
    if (key) map[String(key)] = true;
  }

  return map;
}

function writeMatches_(events) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.MATCHES_SHEET);

  sheet.clearContents();
  sheet.appendRow([
    'checked_at',
    'artist_name',
    'playcount',
    'event_date',
    'city',
    'venue',
    'source',
    'ticket_url',
    'event_key',
  ]);

  if (!events.length) return;

  const rows = events.map(event => [
    event.checked_at,
    event.artist_name,
    event.playcount,
    event.event_date,
    event.city,
    event.venue,
    event.source,
    event.ticket_url,
    event.event_key,
  ]);

  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

function clearMatches_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.MATCHES_SHEET);

  sheet.clearContents();
  sheet.appendRow([
    'checked_at',
    'artist_name',
    'playcount',
    'event_date',
    'city',
    'venue',
    'source',
    'ticket_url',
    'event_key',
  ]);
}

function getConfig_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.CONFIG_SHEET);
  const values = sheet.getDataRange().getValues();

  if (values.length < 2) {
    throw new Error('Config sheet is empty.');
  }

  const config = {};

  for (let i = 1; i < values.length; i++) {
    const key = String(values[i][0] || '').trim();
    const value = values[i][1];

    if (!key) continue;
    config[key] = value;
  }

  const rawMinListens = config.min_listens;
  const parsedMinListens = parseNumberOrDefault_(rawMinListens, 25);

  Logger.log(`Raw min_listens from sheet: ${rawMinListens}`);
  Logger.log(`Parsed min_listens: ${parsedMinListens}`);

  const cities = parseCities_(config.city);

  return {
    lastfm_username: String(config.lastfm_username || '').trim(),
    city: String(config.city || '').trim(),
    cities: cities,
    email: String(config.email || '').trim(),
    min_listens: parsedMinListens,
    alerts_active: toBoolean_(config.alerts_active),
  };
}

function parseCities_(value) {
  return String(value || '')
    .split(',')
    .map(city => city.trim())
    .filter(Boolean);
}

function parseNumberOrDefault_(value, defaultValue) {
  if (value === null || value === undefined || value === '') {
    return defaultValue;
  }

  const normalized = String(value).trim().replace(',', '.');
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function ensureSheets_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let configSheet = ss.getSheetByName(CONFIG.CONFIG_SHEET);
  if (!configSheet) configSheet = ss.insertSheet(CONFIG.CONFIG_SHEET);

  if (configSheet.getLastRow() === 0) {
    configSheet.appendRow(['key', 'value']);
    configSheet.appendRow(['lastfm_username', '']);
    configSheet.appendRow(['city', 'Berlin']);
    configSheet.appendRow(['email', '']);
    configSheet.appendRow(['min_listens', 25]);
    configSheet.appendRow(['alerts_active', true]);
  }

  let sentAlertsSheet = ss.getSheetByName(CONFIG.SENT_ALERTS_SHEET);
  if (!sentAlertsSheet) sentAlertsSheet = ss.insertSheet(CONFIG.SENT_ALERTS_SHEET);

  if (sentAlertsSheet.getLastRow() === 0) {
    sentAlertsSheet.appendRow([
      'event_key',
      'artist_name',
      'event_date',
      'venue',
      'source',
      'sent_at',
    ]);
  }

  let matchesSheet = ss.getSheetByName(CONFIG.MATCHES_SHEET);
  if (!matchesSheet) matchesSheet = ss.insertSheet(CONFIG.MATCHES_SHEET);

  if (matchesSheet.getLastRow() === 0) {
  matchesSheet.appendRow([
    'checked_at',
    'artist_name',
    'playcount',
    'event_date',
    'city',
    'venue',
    'source',
    'ticket_url',
    'event_key',
  ]);
  }
}

function getScriptProperty_(key) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) {
    throw new Error(`Missing Script Property: ${key}`);
  }
  return value;
}

function fetchJson_(baseUrl, params) {
  const query = Object.keys(params)
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');

  const url = `${baseUrl}?${query}`;

  const maxRetries = 5;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
      headers: {
        Accept: 'application/json',
      },
    });

    const code = response.getResponseCode();
    const text = response.getContentText();

    if (code >= 200 && code < 300) {
      return JSON.parse(text);
    }

    if (code === 429) {
      const waitMs = attempt * 1500;
      Logger.log(`HTTP 429 received. Waiting ${waitMs}ms before retry ${attempt}/${maxRetries}. URL: ${url}`);
      Utilities.sleep(waitMs);
      continue;
    }

    throw new Error(`HTTP ${code}: ${text}`);
  }

  throw new Error(`HTTP 429: Rate limit exceeded after retries. URL: ${url}`);
}

function buildEventKey_(artistName, eventDate, venue, city, source) {
  return [
    normalizeArtistName_(artistName),
    String(eventDate || '').trim(),
    String(city || '').trim().toLowerCase(),
    String(venue || '').trim().toLowerCase(),
    String(source || '').trim().toLowerCase(),
  ].join('|');
}

function normalizeArtistName_(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function toBoolean_(value) {
  if (value === true) return true;
  if (value === false) return false;

  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'true' || normalized === 'yes' || normalized === '1';
}

function titleCase_(text) {
  return String(text || '')
    .split(' ')
    .map(part => part ? part.charAt(0).toUpperCase() + part.slice(1) : part)
    .join(' ');
}

function groupEventsByArtist_(events) {
  const grouped = {};

  events.forEach(event => {
    const artistKey = normalizeArtistName_(event.artist_name);

    if (!grouped[artistKey]) {
      grouped[artistKey] = {
        artist_name: event.artist_name,
        events: [],
      };
    }

    grouped[artistKey].events.push(event);
  });

  const groups = Object.keys(grouped).map(key => {
    const group = grouped[key];

    group.events.sort((a, b) => {
      if (a.event_date < b.event_date) return -1;
      if (a.event_date > b.event_date) return 1;
      return 0;
    });

    return group;
  });

  groups.sort((a, b) => {
    const aDate = a.events[0].event_date;
    const bDate = b.events[0].event_date;

    if (aDate < bDate) return -1;
    if (aDate > bDate) return 1;

    return b.events[0].playcount - a.events[0].playcount;
  });

  return groups;
}

function formatEventDate_(dateString) {
  if (!dateString) return '';

  const parts = String(dateString).split('-');
  if (parts.length !== 3) return dateString;

  const year = Number(parts[0]);
  const month = Number(parts[1]) - 1;
  const day = Number(parts[2]);

  const date = new Date(year, month, day);

  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'MMM d, yyyy');
}

function buildGoogleCalendarUrl_(event) {
  const startDate = formatCalendarDate_(event.event_date);
  const endDate = formatCalendarDate_(addDays_(event.event_date, 1));

  const title = `${titleCase_(event.artist_name)} live`;
  const details = event.ticket_url
    ? `Tickets: ${event.ticket_url}`
    : 'Ticket info not found yet.';
  const location = [event.city, event.venue].filter(Boolean).join(' — ');

  const params = {
    action: 'TEMPLATE',
    text: title,
    dates: `${startDate}/${endDate}`,
    details: details,
    location: location,
  };

  const query = Object.keys(params)
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');

  return `https://calendar.google.com/calendar/render?${query}`;
}

function formatCalendarDate_(dateString) {
  const parts = String(dateString || '').split('-');
  if (parts.length !== 3) return '';

  const year = parts[0];
  const month = parts[1];
  const day = parts[2];

  return `${year}${month}${day}`;
}

function addDays_(dateString, daysToAdd) {
  const parts = String(dateString || '').split('-');
  if (parts.length !== 3) return dateString;

  const year = Number(parts[0]);
  const month = Number(parts[1]) - 1;
  const day = Number(parts[2]);

  const date = new Date(year, month, day);
  date.setDate(date.getDate() + daysToAdd);

  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}
