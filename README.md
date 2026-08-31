# TCGBinder

TCGBinder is an iOS trading-card collection app built with React Native and TypeScript. It uses Apple Vision OCR to scan Pokémon cards, identifies the corresponding card and printing through external card-data APIs, stores collections locally, and tracks estimated values for ungraded and graded copies.

## Demo
https://github.com/user-attachments/assets/dba412a3-ff2e-4149-a839-8798995a51a9

## Screenshots

| Binder | Scan | Match |
|---|---|---|
| <img width="1170" height="2532" alt="IMG_4646" src="https://github.com/user-attachments/assets/e4fd9c40-d39a-43b7-a584-35b68689b38a" /> | <img width="1170" height="2532" alt="IMG_4647" src="https://github.com/user-attachments/assets/7242f5ee-8096-489d-b5dd-a5ffa076c047" /> | <img width="1170" height="2532" alt="IMG_4648" src="https://github.com/user-attachments/assets/1161291a-99bc-4513-b3dc-707e91802933" /> |

| Manual correction | Ungraded values | Graded values |
|---|---|---|
| <img width="1170" height="2532" alt="IMG_4649" src="https://github.com/user-attachments/assets/ae794687-9c7c-447f-8944-a9e74be287d2" /> | <img width="1170" height="2532" alt="IMG_4709" src="https://github.com/user-attachments/assets/93503fd0-e265-4ca8-b152-0248ca840e0f" /> | <img width="1170" height="2532" alt="IMG_4652" src="https://github.com/user-attachments/assets/e8e748ff-9a9e-4a5d-bfdd-ec234479a61a" /> |

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

## Architecture

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
