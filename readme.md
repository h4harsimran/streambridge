# StreamBridge: Emby/Jellyfin to Stremio

**StreamBridge** is an unofficial Stremio addon that lets you stream content from your personal or shared Emby or Jellyfin server using IMDb or TMDb IDs. It works as a **stream resolver**: when you browse titles in Stremio using catalog addons like **Cinemeta** (or any other metadata addon), StreamBridge checks if the clicked movie or episode exists in your server library and, if found, returns a direct play link to stream it instantly from your server.

## 🔧 Features

| Features                       | Description                                                                                      |
|--------------------------------|----------------------------------------------------------------------------------------------------|
| **One-page setup**             | Custom User configuration page to help user get thier **User ID** + **Access Token** *and* builds the ready-to-install link. |
| **IMDb / TMDb / Tvdb / Anidb matching**       | Works with IDs like `tt1234567` or `tmdb:98765` etc                                                   |
| **Direct-play multi-quality**  | Direct play URLs with support for different quality options       |
| **Subtitle support**           | Automatic subtitle loading from your server library        |
| **Emby & Jellyfin support**   | Works with both Emby and Jellyfin servers                  |

## ⚠️ Requirements

- **HTTPS Required**: Your Emby or Jellyfin server must be accessible via HTTPS. HTTP and localhost addresses are not supported.
- **Public Access**: Your server must be accessible from the internet (not just localhost).
- **Server Type**: Select whether you're using Emby or Jellyfin in the configuration page.

## ❓ FAQ

### Getting "Load failure" or authentication errors?

**Common causes and solutions:**

1. **Using HTTP instead of HTTPS**
   - ❌ `http://your-server.com:8096` 
   - ✅ `https://your-server.com:8096`
   - **Why?** Modern browsers and Stremio require secure connections for security. HTTP connections are blocked by default.   

2. **Using wrong server type**
   - Make sure you select the correct server type (Emby or Jellyfin) in the configuration page
   - ❌ Selecting Jellyfin when using Emby (or vice versa)
   - ✅ Select the correct server type that matches your actual server
   - **Note:** The authentication headers are different between Emby and Jellyfin, so selecting the wrong type will cause authentication failures

3. **Using server credentials (not Emby Connect/Jellyfin Connect)**
   - ❌ Your Emby Connect or Jellyfin Connect email/password
   - ✅ Your server username/password (the ones you use to log into your server web interface)
   - **Where to get them?** Go to your server web interface → Users → Your username → Edit → Set a password if you haven't already
   - **Note:** These are the same credentials you use when logging into your server directly in a browser

4. **Using localhost addresses**
   - ❌ `localhost:8096` or `127.0.0.1:8096`
   - ✅ Your public HTTPS URL (e.g., `https://your-domain.com:8096`)
   - **Why?** The addon runs on the internet and needs to reach your server from outside your network

5. **Server not accessible from internet**
   - Make sure your server is accessible via HTTPS from outside your local network
   - **Setup needed:** Configure your router/firewall to forward HTTPS traffic to your server
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
      - In **Step 1**, select your **Server Type** (Emby or Jellyfin), then enter your **ServerURL**, **username** and **password**
      - Click **Get Access Info**. 
      - Your **User ID** and **Access Token** appear and auto-fill the form below.

4. Click **Create & Install Add-on**. A `stremio://…` link opens or focuses the Stremio app; confirm the install prompt.
5. The addon will return streams for matching titles in your server when clicked in Stremio.

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
* Jellyfin REST API
* Axios
* express

---

## ⚠️ Disclaimer

This addon is for **educational and personal use only**. It is not affiliated with or endorsed by Emby, Jellyfin, or Stremio.

---

## 📄 License

MIT License
