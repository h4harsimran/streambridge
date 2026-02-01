<div align="center">

# 🎬 StreamBridge

### Bridge Your Emby Server to Stremio

![Version](https://img.shields.io/badge/version-1.2.2-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Node.js](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen.svg)
![Status](https://img.shields.io/badge/status-active-success.svg)

**Stream media from your personal or shared Emby server directly in Stremio using IMDb, TMDb, Tvdb, or Anidb IDs.**

[Quick Start](#-quick-install) • [Features](#-features) • [Requirements](#-requirements) • [FAQ](#-faq) • [Deployment](#-addon-deployment-guide)

</div>

---

## 📖 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [Requirements](#-requirements)
- [Quick Install](#-quick-install)
- [How It Works](#-how-it-works)
- [FAQ](#-faq)
- [Deployment Guide](#-addon-deployment-guide)
- [Tech Stack](#-tech-stack)
- [Disclaimer](#-disclaimer)
- [License](#-license)

---

## 🌟 Overview

**StreamBridge** is an unofficial Stremio addon that acts as a **stream resolver** for your Emby server. When you browse titles in Stremio using catalog addons like **Cinemeta**, StreamBridge automatically checks if the content exists in your server library and returns direct play links for instant streaming.

**Note:** Jellyfin support will be added once its API for providerID is fixed by the Jellyfin team.

### Key Benefits

- ✅ **Seamless Integration**: Works with existing Stremio catalog addons
- ✅ **Direct Play**: No transcoding required, streams directly from your server
- ✅ **Multi-Quality Support**: Automatically handles different quality options
- ✅ **Subtitle Support**: Automatic subtitle loading from your server
- ✅ **Universal ID Support**: Works with IMDb, TMDb, Tvdb, and Anidb IDs

---

## 🔧 Features

| Feature | Description |
|---------|-------------|
| **🎯 One-Page Setup** | Custom configuration page to get your **User ID** + **Access Token** and build a ready-to-install link |
| **🔍 Multi-ID Matching** | Supports IMDb (`tt1234567`), TMDb (`tmdb:98765`), Tvdb, and Anidb IDs |
| **📺 Direct-Play Multi-Quality** | Direct play URLs with support for different quality options (4K, 1080p, 720p, etc.) |
| **📝 Subtitle Support** | Automatic subtitle loading from your server library |
| **🔄 Emby Support** | Works with Emby servers |
| **⚙️ Configurable** | Customizable stream names and server display options |

---

## ⚠️ Requirements

Before installing StreamBridge, ensure you have:

- ✅ **Server URL**: Your Emby server can now use either of **HTTP or HTTPS**. But HTTP works only in **Stremio apps** (tested with desktop, iOS, Android TV). HTTP does **not** work in the  **browser** because browsers block mixed content (HTTPS page connecting to HTTP). HTTPS urls  works in all stremio variants.
- ✅ **Public Access**: Your server must be accessible from the internet (private/local IPs like localhost or 192.168.x.x does not work).
- ✅ **Server Credentials**: Your server username and password (not Emby Connect credentials)

## 📦 Quick Install

### Option 1: Direct Install (Recommended)

1. **Click the configure link**:

   [https://39427cdac546-streambridge.baby-beamup.club/configure](https://39427cdac546-streambridge.baby-beamup.club/configure)

2. **Configure your server**:
   - Enter your **Server URL** (You can use either of http or https now)
   - Enter your **Username** and **Password**
   - Click **Get Access Info**
   - Your **User ID** and **Access Token** will auto-fill

3. **Install the addon**:
   - Click **Create & Install Add-on**
   - Confirm the install prompt in Stremio
   - The addon is now ready to use!

### Option 2: Manual Install

1. **Open Stremio** and go to Addons

2. **Install using the manifest link**:

   [https://39427cdac546-streambridge.baby-beamup.club/manifest.json](https://39427cdac546-streambridge.baby-beamup.club/manifest.json)


3. **Configure the addon**:
   - Click the **Configure** button on the addon
   - Follow the configuration steps in Option 1

### After Installation

Once installed, StreamBridge will automatically return streams for matching titles in your server when you click on them in Stremio. No additional configuration needed!

---

## 🔄 How It Works

1. **Browse in Stremio**: Use catalog addons like Cinemeta to browse movies and TV shows
2. **Click a Title**: When you click on a movie or episode in Stremio
3. **StreamBridge Checks**: StreamBridge queries your Emby server using the title's ID (IMDb, TMDb, etc.)
4. **Stream Returned**: If found, StreamBridge returns direct play links to stream from your server
5. **Instant Playback**: Stremio plays the content directly from your server

```
Stremio Catalog Addon → StreamBridge → Your Emby Server → Direct Play
```

---

## ❓ FAQ

### Getting "Load failure" or authentication errors?

**Common causes and solutions:**

#### 1. HTTP vs HTTPS

- **Stremio apps (desktop, iOS, Android TV):** Both **http** and **https** server URLs work. Use whichever your Emby server uses.
- **Stremio in the browser:** Only **https** url works. Browsers block mixed content (an HTTPS page cannot connect to an HTTP server), so HTTP will not work there.

#### 2. Using Server Credentials (Not Connect Credentials)

- ❌ **Wrong**: Your Emby Connect email/password
- ✅ **Correct**: Your server username/password (the ones you use to log into your server web interface)
- **Where to get them?** Go to your server web interface → Users → Your username → Edit → Set a password if you haven't already
- **Note:** These are the same credentials you use when logging into your server directly in a browser.

#### 3. Using Localhost or Private IPs

- ❌ **Wrong**: `localhost:8096`, `127.0.0.1:8096`, or `192.168.1.5:8096`
- ✅ **Correct**: Your public URL (e.g., `https://your-domain.com:8096` or `http://your-domain.com:8096`or `http://24.X.XX.X:XXXX`)
- **Why?** The addon runs on the internet and only allows public IPs. Private/local addresses do not work.

#### 4. Server Not Accessible from Internet

- Make sure your server is accessible (http or https) from outside your local network
- **Setup needed:** Configure your router/firewall to forward traffic to your server
- **Alternative:** Use a reverse proxy (nginx, Caddy) or VPN solution to expose your server

### Can I use this with multiple servers?

Yes! You can install the addon multiple times with different configurations to connect to multiple Emby servers.

### Does this work with local servers?

No. Your server must be reachable from the internet with a **public** IP or hostname. Localhost and private network addresses (e.g. 192.168.x.x) do not work.

### What IDs are supported?

StreamBridge supports:
- **IMDb IDs**: `tt1234567`
- **TMDb IDs**: `tmdb:98765`
- **Tvdb IDs**: `tvdb:123456`
- **Anidb IDs**: `anidb:12345`

### Can I filter stream qualities?

Yes! The configuration page allows you to filter out specific stream types (4K, 1080p, HDR, Dolby Vision) if needed.

---

## 🚀 Addon Deployment Guide

> **Note:** This section is only for developers who want to deploy their own version. If you're here to just use the addon, the [Quick Install](#-quick-install) guide above should suffice.

### Deploy with BeamUp

[BeamUp](https://beamup.com) is a free hosting service built specifically for Stremio addons.

#### Prerequisites

- Node.js installed on your system
- Git repository with your code


#### Deployment Steps

1. **Install BeamUp CLI**:
   ```bash
   npm install -g beamup-cli
   ```

2. **Initialize and deploy**:
   ```bash
   beamup
   ```

3. **Follow the prompts** and push with:
   ```bash
   git push beamup main:master 
   ```

4. **Your addon is live at**:
   ```
   https://<addon-id>.baby-beamup.club/manifest.json
   ```

#### Local Development

To run the addon locally:

```bash
# Install dependencies
npm install

# Start the server
npm start

# Server will be available at
# http://localhost:7000/manifest.json
```
---
## 🛠 Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **SDK**: [stremio-addon-sdk](https://github.com/Stremio/stremio-addon-sdk)
- **APIs**: Emby REST API
- **HTTP Client**: Axios
- **Middleware**: CORS

---

## ⚠️ Disclaimer

This addon is for **educational and personal use only**. It is not affiliated with or endorsed by Emby or Stremio.

- This is an unofficial addon
- Use at your own risk
- Respect copyright laws and terms of service
- The developers are not responsible for any misuse

---

## 📄 License

This project is licensed under the MIT License.

Copyright (c) 2025 StreamBridge



---

<div align="center">

**Made with ❤️ for the Stremio community**

[Report Bug](https://github.com/yourusername/esaddon/issues) • [Request Feature](https://github.com/yourusername/esaddon/issues) • [Contributing](https://github.com/yourusername/esaddon/pulls)

</div>