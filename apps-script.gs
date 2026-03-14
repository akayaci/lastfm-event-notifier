const CONFIG = {
  CONFIG_SHEET: 'Config',
  SENT_ALERTS_SHEET: 'SentAlerts',
  MATCHES_SHEET: 'Matches',
  LASTFM_BASE_URL: 'https://ws.audioscrobbler.com/2.0/',
  TM_BASE_URL: 'https://app.ticketmaster.com/discovery/v2/events.json',
  LOOKBACK_YEARS: 2,
  LASTFM_PAGE_SIZE: 200,
  MAX_LASTFM_PAGES: 25,
  TM_SIZE: 10,
  MAX_ARTISTS_TO_SEARCH: 20,
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

  if (!settings.lastfm_username || !settings.city || !settings.email) {
    throw new Error('Missing required config values: lastfm_username, city, or email');
  }

  const minListens = Number(settings.min_listens || 50);

  Logger.log(`Running alerts for ${settings.lastfm_username} in ${settings.city}`);

  const qualifiedArtists = getQualifiedArtists_(settings.lastfm_username, minListens);
  Logger.log(`Qualified artists found: ${qualifiedArtists.length}`);

  if (!qualifiedArtists.length) {
    clearMatches_();
    Logger.log('No qualified artists found.');
    return;
  }

  const events = findTicketmasterEvents_(settings.city, qualifiedArtists);
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
  const minListens = Number(settings.min_listens || 50);

  const artists = getQualifiedArtists_(settings.lastfm_username, minListens);
  Logger.log(JSON.stringify(artists.slice(0, 20), null, 2));
}

function testEvents() {
  ensureSheets_();
  const settings = getConfig_();
  const minListens = Number(settings.min_listens || 50);

  const artists = getQualifiedArtists_(settings.lastfm_username, minListens);
  const events = findTicketmasterEvents_(settings.city, artists.slice(0, 5));

  Logger.log(JSON.stringify(events, null, 2));
}

function testEmail() {
  ensureSheets_();
  const settings = getConfig_();

  const fakeEvents = [{
    event_key: 'test artist|2026-05-01|test venue|ticketmaster',
    artist_name: 'Test Artist',
    playcount: 99,
    event_date: '2026-05-01',
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

  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - CONFIG.LOOKBACK_YEARS);
  const cutoffUnix = Math.floor(cutoffDate.getTime() / 1000);

  let page = 1;
  let done = false;
  const counts = {};

  while (!done && page <= CONFIG.MAX_LASTFM_PAGES) {
    const params = {
      method: 'user.getrecenttracks',
      user: username,
      api_key: apiKey,
      format: 'json',
      limit: CONFIG.LASTFM_PAGE_SIZE,
      page: page,
    };

    const data = fetchJson_(CONFIG.LASTFM_BASE_URL, params);

    if (data.error) {
      throw new Error(`Last.fm error: ${data.message}`);
    }

    const tracks = (((data || {}).recenttracks || {}).track) || [];
    if (!tracks.length) break;

    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];

      const uts = track.date && track.date.uts ? Number(track.date.uts) : null;
      if (!uts) continue;

      if (uts < cutoffUnix) {
        done = true;
        break;
      }

      const artistName = normalizeArtistName_(
        track.artist && (track.artist['#text'] || track.artist.name || '')
      );

      if (!artistName) continue;

      counts[artistName] = (counts[artistName] || 0) + 1;
    }

    page += 1;
    Utilities.sleep(200);
  }

  return Object.keys(counts)
    .map(name => ({
      artist_name: name,
      playcount: counts[name],
    }))
    .filter(a => a.playcount >= minListens)
    .sort((a, b) => b.playcount - a.playcount);
}

function findTicketmasterEvents_(city, qualifiedArtists) {
  const apiKey = getScriptProperty_('TM_API_KEY');
  const allEvents = [];
  const seen = {};

  qualifiedArtists.slice(0, CONFIG.MAX_ARTISTS_TO_SEARCH).forEach(artist => {
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
      const venue = ((((ev._embedded || {}).venues || [])[0] || {}).name) || '';
      const ticketUrl = ev.url || '';

      if (!eventDate || !venue) return;

      const eventKey = buildEventKey_(artist.artist_name, eventDate, venue, 'ticketmaster');

      if (seen[eventKey]) return;
      seen[eventKey] = true;

      allEvents.push({
        checked_at: new Date(),
        artist_name: artist.artist_name,
        playcount: artist.playcount,
        event_date: eventDate,
        venue: venue,
        source: 'ticketmaster',
        ticket_url: ticketUrl,
        event_key: eventKey,
      });
    });

    Utilities.sleep(200);
  });

  allEvents.sort((a, b) => {
    if (a.event_date < b.event_date) return -1;
    if (a.event_date > b.event_date) return 1;
    return b.playcount - a.playcount;
  });

  return allEvents;
}

function sendAlertEmail_(settings, events) {
  let body = '';
  body += 'Hi,\n\n';
  body += 'We found new concert matches for your Last.fm profile.\n\n';
  body += `Last.fm username: ${settings.lastfm_username}\n`;
  body += `City: ${settings.city}\n`;
  body += `Minimum listens: ${settings.min_listens}\n\n`;

  events.forEach((event, index) => {
    body += `${index + 1}. ${titleCase_(event.artist_name)}\n`;
    body += `Listens: ${event.playcount}\n`;
    body += `Date: ${event.event_date}\n`;
    body += `Venue: ${event.venue}\n`;
    body += `Source: ${event.source}\n`;
    body += `Ticket: ${event.ticket_url}\n\n`;
  });

  body += 'To stop alerts, open your Google Sheet and set alerts_active to FALSE in the Config tab.\n';

  MailApp.sendEmail({
    to: settings.email,
    subject: `Concert alerts: ${events.length} new match${events.length > 1 ? 'es' : ''} in ${settings.city}`,
    body: body,
  });
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

  return {
    lastfm_username: String(config.lastfm_username || '').trim(),
    city: String(config.city || '').trim(),
    email: String(config.email || '').trim(),
    min_listens: Number(config.min_listens || 50),
    alerts_active: toBoolean_(config.alerts_active),
  };
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
    configSheet.appendRow(['min_listens', 50]);
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

  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    headers: {
      Accept: 'application/json',
    },
  });

  const code = response.getResponseCode();
  const text = response.getContentText();

  if (code < 200 || code >= 300) {
    throw new Error(`HTTP ${code}: ${text}`);
  }

  return JSON.parse(text);
}

function buildEventKey_(artistName, eventDate, venue, source) {
  return [
    normalizeArtistName_(artistName),
    String(eventDate || '').trim(),
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
