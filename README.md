# Medical Shop Demo

This project now has a lightweight backend in addition to the frontend pages.

## What the backend does

- Serves the full website from one local server
- Exposes store data through `GET /api/store`
- Saves support and order requests through `POST /api/submissions`
- Keeps saved submissions in `data/submissions.json`

## How to run it

1. Install Node.js 18 or newer on your machine.
2. Open this project folder in a terminal.
3. Run `npm start`
4. Open `http://localhost:3000`

If `npm start` says `npm` or `node` is not recognized, Node.js is not installed yet or not added to PATH.

On Windows you can also run:

- `start-server.bat`

That file will tell you clearly if Node.js is missing.

## Where to put your real data

Update `data/store.json`

That file is the main place for:

- Store name
- Support phone
- Support email
- Store hours
- All products
- All offer codes
- All care bundles

## Product fields to fill

Each product inside `data/store.json` should include:

- `id`
- `name`
- `category`
- `pack`
- `price`
- `stock`
- `description`
- `image`
- `alt`
- `featured`

## Offer fields to fill

Each offer should include:

- `code`
- `title`
- `description`
- `type`
- `value`
- `minSubtotal`

## Bundle fields to fill

Each bundle should include:

- `id`
- `title`
- `productIds`

## Saved request data

Customer support and order requests are saved in:

- `data/submissions.json`
- customer accounts and saved locations: `data/customers.json`

## Send requests to Google Sheets

The sheet link alone is not enough for writing data directly.

The easiest setup is:

1. Open your Google Sheet
2. Go to Extensions > Apps Script
3. Paste the code from `google-sheet-webapp.gs`
4. Deploy it as a Web App
5. Copy the Web App URL
6. Paste that URL into `data/integrations.json` under `googleAppsScriptUrl`
7. Start the backend with `npm start`

Important:

- In the Web App deployment, set `Execute as` to `Me`
- In the Web App deployment, set access to `Anyone`
- After editing the Apps Script code, deploy a new version again
- The Web App URL must still end with `/exec`

After that, every support request or order request will:

- save locally in `data/submissions.json`
- also be forwarded to your Google Sheet

## Customer login and saved location

The login/profile page has been removed from this project.

Customer account data is stored in:

- `data/customers.json`

Customer profiles are also available from the backend API:

- `GET /api/customers`

Saved customer location is attached to:

- backend order submissions in `data/submissions.json`
- Google Sheets rows sent through the Apps Script web app

If you want, you can send me your real shop data next and I can place it into `data/store.json` for you, and I can also help you connect the Google Sheet once you have the Apps Script Web App URL.
