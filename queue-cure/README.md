# Queue Cure '26
Real-time clinic queue management — Wooble Hackathon 2026

## Run Locally
```bash
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000)

## Receptionist PIN: 2626

## Pages
- `/` &rarr; Landing page
- `/receptionist` &rarr; Receptionist dashboard (PIN protected)
- `/waiting-room` &rarr; Patient waiting room (public, no login)

## Socket Events
- **Server &rarr; clients**: `queue_update` (full state, on every change)
- **Client &rarr; server**: `request_state` (on connect)

## Key Technical Features
- **Live Queue Sync**: Instantaneous bidirectional synchronization across all terminals using real-time Socket.io channels.
- **Voice Announcements**: Uses the browser's Web Speech API (`window.speechSynthesis`) to announce pending patient turns aloud with a calm English narration rate (disabled automatically if the client's localized sound preference toggle is clicked OFF).
- **Queue Break Controls**: Receptionists can trigger pause states, block "Call Next" operations, and display synchronized notice warnings on all patients' screens globally.
- **Active Wait Recalibration**: Patient screens feature robust digital clock counters ticking minutes down, freezing at precisely `1:00` ("Almost your turn"), and automatically re-verifying countdown accuracy from server states every 30 seconds.
- **Privacy-First Design**: Lobby lists screen patient names down to their first name only (e.g., "Ravi Kumar" &rarr; "Ravi") to guarantee HIPAA-compliant anonymity.
- **Clean Responsive Styling**: Elegant, modern color tokens and buttery smooth 0.2s responsive hover states optimized across both desktop dashboards and touch mobile boundaries.
- **Zero Account Overheads**: Completely transient, memory-stored queue boards — open the clinical URL, type inside the regex-safe gate, and check in.
