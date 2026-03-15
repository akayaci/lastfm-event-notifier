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

  if (!settings.lastfm_username || !settings.city || !settings.email) {
    throw new Error('Missing required config values: lastfm_username, city, or email');
  }

  const minListens = Number(settings.min_listens ||25);

  Logger.log(`Running alerts for ${settings.lastfm_username} in ${settings.city}`);

  const qualifiedArtists = getQualifiedArtists_(settings.lastfm_username, minListens);
  Logger.log(`Qualified artists found: ${qualifiedArtists.length}`);

  if (!qualifiedArtists.length) {
    clearMatches_();
    Logger.log('No qualified artists found.');
    return;
  }

const events = findAllEvents_(settings.city, qualifiedArtists);
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
  const minListens = Number(settings.min_listens || 25);

  const artists = getQualifiedArtists_(settings.lastfm_username, minListens);
  Logger.log(`Total qualified artists: ${artists.length}`);
  Logger.log(JSON.stringify(artists, null, 2));
}

function testEvents() {
  ensureSheets_();
  const settings = getConfig_();
  const minListens = Number(settings.min_listens || 50);

  const artists = getQualifiedArtists_(settings.lastfm_username, minListens);
  const events = findAllEvents_(settings.city, artists);

  Logger.log(`Artists checked: ${artists.length}`);
  Logger.log(`Events found: ${events.length}`);
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

function findTicketmasterEvents_(city, qualifiedArtists) {
  const apiKey = getScriptProperty_('TM_API_KEY');
  const allEvents = [];
  const seen = {};

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
      const venue = ((((ev._embedded || {}).venues || [])[0] || {}).name) || '';
      const ticketUrl = ev.url || '';
      const eventName = ev.name || '';
      const attractionNames = getAttractionNames_(ev);

      if (!eventDate || !venue) return;
      if (!isStrongArtistMatch_(artist.artist_name, eventName, attractionNames)) return;

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

  const artistNames = events
    .map(e => titleCase_(e.artist_name))
    .slice(0, 3)
    .join(', ');

  const subject =
    `🎵 ${artistNames}${events.length > 3 ? ' +' + (events.length - 3) : ''} live in ${settings.city} 🎤`;

  let body = '';

  body += `🎶 Good news!\n\n`;
  body += `We found ${events.length} upcoming concert${events.length > 1 ? 's' : ''} in ${settings.city} from artists you listen to.\n\n`;

  events.forEach((event, index) => {

    body += `🎤 ${index + 1}. ${titleCase_(event.artist_name)}\n`;
    body += `📅 Date: ${event.event_date}\n`;
    body += `📍 Venue: ${event.venue}\n`;

    if (event.ticket_url) {
      body += `🎟 Tickets: ${event.ticket_url}\n`;
    }

    body += `\n`;
  });

  body += `Enjoy the show 🎧\n\n`;
  body += `---\n`;
  body += `To stop alerts, set alerts_active = FALSE in your Google Sheet Config tab.\n`;

  MailApp.sendEmail({
    to: settings.email,
    subject: subject,
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
    min_listens: Number(config.min_listens || 25),
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
