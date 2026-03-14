# Last.fm Concert Alerts for Google Sheets

A self-serve Google Sheets + Apps Script template that sends you email alerts for upcoming concerts by artists you listen to on Last.fm.

This project is designed for personal use.

Each person uses:
- their own Google Sheet
- their own Apps Script project
- their own API keys
- their own email address

No shared database or central app is required.

## What it does

The script:
1. reads your Last.fm username, city, email, and minimum listen threshold from your personal Google Sheet
2. checks your listening history from the last 2 years
3. finds artists you listen to frequently
4. looks for matching upcoming events in your selected city
5. sends you email alerts for newly found events
6. prevents duplicate alerts for the same event

## Current version

Version 1 is designed as a self-serve personal template.

It includes:
- Google Sheet template
- Google Apps Script automation
- email alerts
- duplicate prevention
- manual on/off control from the sheet

## Sheet structure

Your personal sheet should contain these tabs:
- `Config`
- `SentAlerts`
- `Matches`

See `GOOGLE-SHEET-TEMPLATE.md` for the exact structure.

## Required API keys

You need your own:
- Last.fm API key
- Ticketmaster API key

These are added in Apps Script using Script Properties.

## How to set it up

See:
- `SETUP.md` for full installation steps
- `GOOGLE-SHEET-TEMPLATE.md` for the required sheet structure

## How alerts are stopped

This version does not use a public unsubscribe page.

To stop alerts, simply set:

`alerts_active = FALSE`

in the `Config` tab of your personal sheet.

## Notes

- This is a personal Google Sheets template
- Each user must configure their own copy
