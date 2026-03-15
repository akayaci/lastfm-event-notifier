# Last.fm Concert Alerts

A small tool that finds upcoming concerts from artists you listen to on Last.fm and sends you an email when they play in your city.

The script:

1. Reads your listening history from Last.fm
2. Selects artists you listen to frequently
3. Searches Ticketmaster for upcoming events in your city
4. Sends you an email alert if a new concert is found

Runs automatically once per day using Google Apps Script.

---

# How it works

```
Last.fm listening history
        ↓
top artists (last 2 years)
        ↓
Ticketmaster event search
        ↓
new concerts detected
        ↓
email notification
```

Duplicate events are prevented using a history table inside the sheet.

---

# Requirements

You need:

* A **Last.fm account**
* A **Last.fm API key**
* A **Ticketmaster API key**
* A **Google account**

---

# Setup

## 1. Copy the Google Sheet template

Create a new Google Sheet.

Create the following tabs:

### Config

| key             | value                |
| --------------- | -------------------- |
| lastfm_username | your_lastfm_username |
| city            | Berlin               |
| email           | your_email           |
| min_listens     | 25                   |
| alerts_active   | TRUE                 |

---

### SentAlerts

Header row:

```
event_key | artist_name | event_date | venue | source | sent_at
```

---

### Matches

Header row:

```
checked_at | artist_name | playcount | event_date | venue | source | ticket_url | event_key
```

---

# 2. Open Google Apps Script

Inside the sheet:

```
Extensions → Apps Script
```

Paste the script into `Code.gs`.

Save the project.

---

# 3. Add API keys

Open:

```
Project Settings → Script Properties
```

Add:

```
LASTFM_API_KEY = your_lastfm_api_key
TM_API_KEY = your_ticketmaster_api_key
```

---

# 4. Initialize the sheet

Run:

```
setup
```

This ensures the required sheets exist.

---

# 5. Test the system

Run the following functions once.

### Test Last.fm connection

```
testLastfm
```

You should see a list of artists in the logs.

---

### Test event search

```
testEvents
```

You should see detected concerts in the logs.

---

### Test email

```
testEmail
```

You should receive a test email.

---

# 6. Enable automatic alerts

Run:

```
createDailyTrigger
```

This schedules the script to run once per day.

When a new concert is detected, you will receive an email.

---

# Example email

Subject:

```
🎵 Fred Again, Four Tet live soon 🎤
```

Body:

```
Good news — we found upcoming concerts from artists you listen to.

1. Fred Again
Date: 2026-06-12
Venue: Uber Eats Music Hall
Tickets: https://...

2. Four Tet
Date: 2026-07-03
Venue: Berghain
```

---

# Configuration options

| Setting         | Description                              |
| --------------- | ---------------------------------------- |
| lastfm_username | Your Last.fm username                    |
| city            | City to search events in                 |
| email           | Email to send alerts to                  |
| min_listens     | Minimum listens for an artist to qualify |
| alerts_active   | Set FALSE to stop alerts                 |

---

# Notes

* Only **new concerts** trigger emails.
* Events already sent will not be repeated.
* Event coverage depends on Ticketmaster listings.

---

# Future improvements

Possible upgrades:

* additional event sources (Resident Advisor, Dice, Eventim)
* multi-city support
* HTML email formatting
* venue-based event scanning
* new artist detection

---

# License

MIT License.

---

