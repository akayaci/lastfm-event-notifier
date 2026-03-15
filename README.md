# Last.fm Concert Alerts

Automatically discover concerts from artists you listen to on **Last.fm** and receive a **daily email alert** when they play in your cities.

This tool runs on **Google Apps Script** and connects:

- Last.fm listening history
- Ticketmaster Discovery API
- Google Sheets
- Gmail

The script identifies artists you frequently listen to and checks Ticketmaster for upcoming concerts.

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

Concerts are grouped by artist and duplicates are prevented using a history table stored in the sheet.

---

# Features

- Uses **Last.fm listening history**
- Finds concerts via **Ticketmaster Discovery API**
- Supports **multiple cities**
- Groups concerts **by artist**
- Sends **HTML email alerts**
- Includes **ticket links**
- Includes **Add to Google Calendar links**
- Prevents duplicate alerts
- Stores matches in **Google Sheets**

---

# Requirements

You need:

- A **Last.fm account**
- A **Last.fm API key**
- A **Ticketmaster API key**
- A **Google account**

---

# Setup

## 1. Create a Google Sheet

Create a new Google Sheet and name it something like:

```
Lastfm Concert Alerts
```

Create the following tabs.

---

## Config

| key | value |
|-----|------|
| lastfm_username | your_lastfm_username |
| city | Berlin |
| email | your_email |
| min_listens | 25 |
| alerts_active | TRUE |

### Multi-city support

You can search multiple cities by separating them with commas:

```
Berlin, Hamburg, Amsterdam
```

---

## SentAlerts

Header row:

```
event_key | artist_name | event_date | venue | source | sent_at
```

This sheet prevents duplicate notifications.

---

## Matches

Header row:

```
checked_at | artist_name | playcount | event_date | city | venue | source | ticket_url | event_key
```

This sheet stores all concerts detected during each run.

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

You can obtain keys here:

Last.fm API  
https://www.last.fm/api

Ticketmaster API  
https://developer.ticketmaster.com/

---

# 4. Initialize the sheet

Run:

```
setup
```

This ensures all required sheets exist.

---

# 5. Test the system

Run these functions once.

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

Detected concerts should appear in the logs.

---

### Test email

```
testEmail
```

You should receive a sample email.

---

# 6. Enable automatic alerts

Run:

```
createDailyTrigger
```

This schedules the script to run **once per day**.

When a new concert is detected, an email notification will be sent.

---

# Example email

Subject:

```
🎵 Fred Again, Four Tet +1 live in Berlin 🎤
```

Body:

```
Fred Again
🎧 Your listens: 134

May 1, 2026 — Berlin — Uber Eats Music Hall
View tickets
Add to calendar

May 3, 2026 — Hamburg — Fabrik
Ticket info not found yet
Add to calendar
```

Concerts from the same artist are grouped together.

---

# Configuration options

| Setting | Description |
|--------|-------------|
| lastfm_username | Your Last.fm username |
| city | City or comma-separated list of cities |
| email | Email address to receive alerts |
| min_listens | Minimum listens for an artist to qualify |
| alerts_active | Set FALSE to disable alerts |

---

# Ticketmaster API limits

The script performs **one Ticketmaster search per qualifying artist**.

Ticketmaster’s Discovery API has strict rate limits (roughly **5 requests per second**).  
If too many artists are included, the script may temporarily hit the API rate limit.

To avoid this:

- keep `min_listens` reasonably high
- focus on artists you listen to frequently

Recommended range:

```
min_listens = 25–50
```

---

# Notes

- Only **new concerts** trigger email alerts
- Events already sent will not be repeated
- Event availability depends on Ticketmaster listings
- Ticketmaster coverage varies by region

---

# Future improvements

Possible upgrades:

- additional event sources (Dice, Songkick, Eventim)
- venue-based scanning

---

# License

MIT License
