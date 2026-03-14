# SETUP.md for Last.fm Event Notifier

## Project Overview
The Last.fm Event Notifier is an application that notifies users of upcoming events based on their music preferences. It connects to the Last.fm API to retrieve event information and provides notifications in real-time.

## Prerequisites
Before you begin, ensure you have met the following requirements:
- **Node.js**: Version 14 or newer.
- **npm**: Version 6 or newer.

## Installation Instructions

1. **Clone the repository**
   ```bash
   git clone https://github.com/akayaci/lastfm-event-notifier.git
   ```
2. **Navigate into the project directory**
   ```bash
   cd lastfm-event-notifier
   ```
3. **Install dependencies**
   ```bash
   npm install
   ```

## Configuration
1. Create a `.env` file in the root of the project and add your Last.fm API key:
   ```env
   LASTFM_API_KEY=your_api_key_here
   ```
   
2. Configure any additional settings as outlined in the project's documentation.

## Running the Application
To start the application, run:
```bash
npm start
```

## Troubleshooting
If you encounter issues, consider the following:
- Ensure all dependencies are installed correctly.
- Check that your API keys are valid and configured properly.

## Contributing
If you would like to contribute to this project, please fork the repository and submit a pull request with your changes.
