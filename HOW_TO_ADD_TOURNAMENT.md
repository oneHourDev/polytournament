# How to Add a New Tournament

This project uses a shared codebase for all tournaments. All common styles and logic are in:
- `tournament-common.css` - Shared styles
- `tournament-common.js` - Shared JavaScript logic

## Adding Tournament 3 (or any new tournament)

### Step 1: Copy the Template

Copy `index.html` to `index3.html`:

```bash
cp index.html index3.html
```

### Step 2: Edit the Configuration

Open `index3.html` and modify **only** the configuration section at the bottom:

```javascript
const TOURNAMENT_CONFIG = {
  id: 'tournament3',  // ← Change this (must be unique!)

  // Tournament Settings
  title: 'Polytopia Tournament 3',  // ← Change the title
  subtitle: 'Game Mode: 1v1 · Drylands · Kickoo',  // ← Change game mode if needed

  // Players List - Add/remove/modify players
  players: [
    { name: "Player1", avatar: "resources/img/Player1.jpeg" },
    { name: "Player2", avatar: "resources/img/Player2.jpeg" },
    // Add more players here...
  ],

  // Firebase Configuration (same for all tournaments)
  firebase: {
    apiKey: "AIzaSyBZtsslw-R17toTXbKBoikhc0vyOdAeDe0",
    authDomain: "polytournament-87d5b.firebaseapp.com",
    databaseURL: "https://polytournament-87d5b-default-rtdb.firebaseio.com",
    projectId: "polytournament-87d5b",
    storageBucket: "polytournament-87d5b.firebasestorage.app",
    messagingSenderId: "428892548438",
    appId: "1:428892548438:web:8c7a105e25fedd868b7af7"
  }
};
```

### Step 3: Update Navigation Menu

In the `<div class="tournament-nav">` section, add the new tournament link:

```html
<div class="tournament-nav">
  <a href="index.html">Tournament 1</a>
  <a href="index2.html">Tournament 2</a>
  <a href="index3.html" class="active">Tournament 3</a>  <!-- Add this -->
</div>
```

Also update the `class="active"` to mark which tournament page you're on.

### Step 4: Update Page Title

Change the `<title>` tag in the `<head>` section:

```html
<title>Polytopia Tournament 3</title>
```

### Step 5: Update Header

Change the header text in the HTML body:

```html
<div class="title-eyebrow">⚔ Tournament 3 ⚔</div>
<h1>Polytopia Tournament 3</h1>
```

### Step 6: Add Player Images

If you have new players, add their images to:
```
resources/img/PlayerName.jpeg
```

### Step 7: Update All Existing Tournament Pages

Don't forget to add the new tournament link to the navigation menu in ALL tournament pages:
- `index.html`
- `index2.html`
- Any other tournament pages

## Important Notes

1. **Tournament ID must be unique** - Each tournament needs a unique `id` in the config
2. **Don't modify shared files** - Never edit `tournament-common.css` or `tournament-common.js` unless you want to change ALL tournaments
3. **Data is stored separately** - Each tournament stores its data in Firebase under its unique ID
4. **Player avatars are shared** - All tournaments can use the same `resources/img/` folder

## What You Can Customize Per Tournament

✅ Tournament ID
✅ Tournament title and subtitle
✅ Players list
✅ Number of players (can be different for each tournament)

## What Is Shared

🔒 All styling (colors, fonts, layout)
🔒 All game logic (ranking, head-to-head tiebreakers)
🔒 All UI components (matrix, scoreboard, popups)
🔒 Firebase configuration

## Testing

After creating a new tournament, open it in your browser and verify:
- [ ] Navigation menu works and shows correct active state
- [ ] Player names and avatars display correctly
- [ ] Results can be entered and saved
- [ ] Rankings update properly
- [ ] Winner celebration triggers when tournament completes