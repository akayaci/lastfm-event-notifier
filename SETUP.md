# Setup Guide

This project is a self-serve Google Sheets + Apps Script template.

Each person sets it up in their own Google account.

## Step 1 — Create your Google Sheet

Create a new Google Sheet.

Suggested name:

`Last.fm Concert Alerts`

## Step 2 — Add the required tabs

Create these tabs:

- `Config`
- `SentAlerts`
- `Matches`

See `GOOGLE-SHEET-TEMPLATE.md` for the exact layout.

## Step 3 — Open Apps Script

From your Google Sheet:

`Extensions → Apps Script`

A new Apps Script project will open.

## Step 4 — Paste the script

Copy the contents of `apps-script.gs` from this repository.

Paste it into `Code.gs` in Apps Script.

Remove any default code first.

## Step 5 — Add Script Properties

In Apps Script:

`Project Settings → Script Properties`

Add the following keys:

- `LASTFM_API_KEY`
- `TM_API_KEY`

Set each value using your own API keys.

## Step 6 — Fill the Config tab

In your `Config` tab, add your own values:

- `lastfm_username`
- `city`
- `email`
- `min_listens`
- `alerts_active`

Example:

| key | value |
|---|---|
| lastfm_username | your_lastfm_username |
| city | Berlin |
| email | your@email.com |
| min_listens | 50 |
| alerts_active | TRUE |

## Step 7 — Run setup and tests

Run the setup/test functions from Apps Script one by one.

Recommended order:
1. setup
2. testLastfm
3. testEvents
4. testEmail

You will be asked to grant permissions the first time.

## Step 8 — Create the daily trigger

In Apps Script:
- open Triggers
- add a new trigger
- choose the main alert function
- choose time-driven
- run daily

## Step 9 — Stop alerts anytime

To stop alerts, go to the `Config` tab and set:

`alerts_active = FALSE`

## Notes

- each person must use their own sheet
- each person must use their own API keys
- alerts are only sent for newly found matching events
- already sent events are stored in `SentAlerts`
