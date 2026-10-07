# P2P File Sharing System

A peer-to-peer file sharing web application that allows users to transfer files directly between browsers using WebRTC.

The backend is used only for session management and WebRTC signaling. Actual file data is transferred directly between connected devices and is not stored on the server.

## Features

- Direct peer-to-peer file transfer using WebRTC
- Multiple file selection and transfer
- Multiple receivers
- Unique session/access code
- 250 MB maximum size per file
- 64 KB file chunking
- Transfer progress tracking
- Transfer speed display
- Cancel current file transfer
- Automatic file download on receiver
- Session expiration
- Connection and error handling
- Basic input validation
- File management with remove and clear-all options
- Responsive user interface

## Tech Stack

### Frontend
- Next.js
- React
- JavaScript
- CSS

### Backend
- Node.js
- Express.js
- Socket.IO

### Communication
- WebRTC
- RTCDataChannel
- STUN

## How It Works

```text
Sender Browser
     |
     |  Session Code
     v
Socket.IO Server
     |
     |  WebRTC Signaling
     v
Receiver Browser
     |
     |  WebRTC DataChannel
     v
Direct File Transfer
