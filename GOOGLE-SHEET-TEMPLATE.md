# Google Sheet Template Structure

This project uses one personal Google Sheet per user.

## Tab 1 — Config

This tab stores personal settings.

| key | value |
|---|---|
| lastfm_username | your_lastfm_username |
| city | Berlin |
| email | your@email.com |
| min_listens | 50 |
| alerts_active | TRUE |

### Notes
- `lastfm_username`: your Last.fm username
- `city`: the city used for event search
- `email`: where alerts are sent
- `min_listens`: minimum number of listens in the last 2 years for an artist to qualify
- `alerts_active`: set to `TRUE` or `FALSE`

## Tab 2 — SentAlerts

This tab stores all previously emailed events to avoid duplicates.

| event_key | artist_name | event_date | venue | source | sent_at |

## Tab 3 — Matches

This tab stores the latest matched results for visibility and debugging.

| checked_at | artist_name | playcount | event_date | venue | source | ticket_url | event_key |
