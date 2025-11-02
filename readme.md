# StreamBridge: Emby to Stremio

**StreamBridge** is an unofficial Stremio addon that lets you stream content from your personal or shared Emby server using IMDb or TMDb IDs. It works as a **stream resolver**: when you browse titles in Stremio using catalog addons like **Cinemeta** (or any other metadata addon), StreamBridge checks if the clicked movie or episode exists in your Emby library and, if found, returns a direct play link to stream it instantly from the emby server.

## 🔧 Features

| Features                       | Description                                                                                      |
|--------------------------------|----------------------------------------------------------------------------------------------------|
| **One-page setup**             | Custom User configuration page to help user get thier **User ID** + **Access Token** *and* builds the ready-to-install link. |
| **IMDb / TMDb / Tvdb / Anidb matching**       | Works with IDs like `tt1234567` or `tmdb:98765` etc                                                   |
| **Direct-play multi-quality**  | Direct play URLs with support for different quality options       |
| **Subtitle support**           | Automatic subtitle loading from your Emby library        |

## ⚠️ Requirements

- **HTTPS Required**: Your Emby server must be accessible via HTTPS. HTTP and localhost addresses are not supported.
- **Public Access**: The Emby server must be accessible from the internet (not just localhost).

## ❓ FAQ

### Getting "Load failure" or authentication errors?

**Common causes and solutions:**

1. **Using HTTP instead of HTTPS**
   - ❌ `http://your-server.com:8096` 
   - ✅ `https://your-server.com:8096`
   - **Why?** Modern browsers and Stremio require secure connections for security. HTTP connections are blocked by default.   

2. **Using Emby Connect credentials instead of server credentials**
   - ❌ Your Emby Connect email/password
   - ✅ Your Emby server username/password (the ones you use to log into your Emby web interface)
   - **Where to get them?** Go to your Emby server web interface → Users → Your username → Edit → Set a password if you haven't already
   - **Note:** These are the same credentials you use when logging into your Emby server directly in a browser

3. **Using localhost addresses**
   - ❌ `localhost:8096` or `127.0.0.1:8096`
   - ✅ Your public HTTPS URL (e.g., `https://your-domain.com:8096`)
   - **Why?** The addon runs on the internet and needs to reach your server from outside your network

4. **Server not accessible from internet**
   - Make sure your Emby server is accessible via HTTPS from outside your local network
   - **Setup needed:** Configure your router/firewall to forward HTTPS traffic to your Emby server
   - **Alternative:** Use a reverse proxy (nginx, Caddy) or VPN solution to expose your server securely

--
## 📦 Quick Install

To use this addon:

1. Go to the Stremio app.

2. Install addon using link. Use the following link.

   ```
   https://39427cdac546-streambridge.baby-beamup.club/manifest.json
   ```

3. Use **Configure** button to open the configure page. On the configure page:
      - In **Step 1**, enter your Emby **ServerURL**, **username** and **password**
      - Click **Get Access Info**. 
      - Your **User ID** and **Access Token** appear and auto-fill the form below.

4. Click **Create & Install Add-on**. A `stremio://…` link opens or focuses the Stremio app; confirm the install prompt.
5. The addon will return streams for matching titles in your Emby server when clicked in Stremio.

You can also use the link below and skip step 1 and 2.

```
https://39427cdac546-streambridge.baby-beamup.club/configure
```
## 🚀 Addon Deployment Guide 
***Note: This is only for Developers who want to deploy their own version, not needed to use the addon. If you are here to just use the addon, the guide above should suffice that.***

### One-Click Deploy with Beamup.

> BeamUp is a free hosting service built specifically for Stremio addons.

1. Install BeamUp CLI:

   ```bash
   npm install -g beamup-cli
   ```

2. Initialize and deploy:

   ```bash
   beamup
   ```

3. Follow prompts and push with:

   ```bash
   git push beamup main:master
   ```

4. Your addon is live at:

   ```
   https://<addon-id>.baby-beamup.club/manifest.json
   ```


## 🛠 Tech Stack

* Node.js
* [stremio-addon-sdk](https://github.com/Stremio/stremio-addon-sdk)
* Emby REST API
* Axios
* express

---

## ⚠️ Disclaimer

This addon is for **educational and personal use only**. It is not affiliated with or endorsed by Emby or Stremio.

---

## 📄 License

MIT License
