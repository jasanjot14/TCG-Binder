# TCGBinder

TCGBinder is an iOS app for building a digital Pokémon card binder. It scans card photos, matches the correct printing, saves owned cards, and tracks estimated values for ungraded and graded copies.

## Demo


## Screenshots

| Binder | Scan | Match |
|---|---|---|
|  |  |  |

| Manual correction | Ungraded values | Graded values |
|---|---|---|
|  |  |  |

## Features

- Photo-based card scanning using Apple Vision OCR
- Match confirmation and manual correction for incorrect scan results
- Adjustable binder grid layouts
- Search, filter, and sort controls for saved cards
- Duplicate tracking across different finishes and grades
- Price tracking for ungraded finishes and graded copies
- Estimated collection value based on the cards in your binder

## Tech Stack

| Area | Technology |
|---|---|
| Mobile app | React Native, Expo SDK 54, TypeScript |
| Photo capture/import | Expo Image Picker |
| Local collection storage | AsyncStorage |
| Companion service | Node.js |
| OCR | Apple Vision through Swift |
| Card data and ungraded prices | TCGdex |
| Graded price estimates | RapidAPI Pokémon TCG API |

## How It Works

```text
iOS app
  -> photo selection
  -> scan result confirmation
  -> binder management
  -> local collection storage

macOS companion service
  -> Apple Vision OCR
  -> collector number normalization
  -> official card lookup
  -> pricing requests
```

## Getting Started

Install dependencies:

```bash
npm install
```

Start the local companion service:

```bash
npm run companion
```

Start the Expo app:

```bash
npm run start
```

Run the app with Expo Go on a physical iPhone or with the iOS Simulator. When using a physical iPhone, enter the local Wi-Fi companion service URL shown in the terminal.

## Environment Variables

Graded pricing is optional and requires a RapidAPI key.

```bash
cp server/.env.example server/.env
```

```env
RAPIDAPI_KEY=your_key_here
```

## License

This project is licensed under the MIT License.
