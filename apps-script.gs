function notifyLastFmEvents() {
  // Set the Last.fm API key
  const apiKey = 'YOUR_LASTFM_API_KEY';

  // Replace this with your own user
  const user = 'YOUR_LASTFM_USERNAME';

  // Set the URL for the Last.fm API endpoint
  const url = `https://ws.audioscrobbler.com/2.0/?method=user.getevents&user=${user}&api_key=${apiKey}&format=json`;

  // Fetch the events
  const response = UrlFetchApp.fetch(url);
  const data = JSON.parse(response.getContentText());

  // Process and log the events
  if (data.events && data.events.event) {
    data.events.event.forEach(event => {
      Logger.log(`Event: ${event.title}, Date: ${event.startDate}, Venue: ${event.venue.name}`);
    });
  } else {
    Logger.log('No events found.');
  }
}