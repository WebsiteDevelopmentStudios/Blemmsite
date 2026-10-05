# Blemmsite

Purple, space-themed Blemm community website.

## Included

- Home page
- Discord community tab
- Discord OAuth2 login
- Discord-backed profile tab
- Animated stars and shooting stars
- Responsive mobile layout
- Small Node/Express backend for secure OAuth

## Run locally

1. Install Node.js.
2. Copy `.env.example` to `.env`.
3. Create a Discord application at https://discord.com/developers/applications.
4. Add this redirect URL to the Discord application's OAuth2 settings:

```
http://localhost:3000/auth/discord/callback
```

5. Put the application's client ID and client secret into `.env`.
6. Replace `COOKIE_SECRET` with a long random value.
7. Set the real Discord invite in `script.js`.
8. Run:

```
npm install
npm start
```

Then open http://localhost:3000.

## Production

Set:

- `BASE_URL` to the public HTTPS site URL.
- `DISCORD_REDIRECT_URI` to `${BASE_URL}/auth/discord/callback`.
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `COOKIE_SECRET`
- `NODE_ENV=production`

The exact production URL must also be registered as a Discord OAuth2 redirect URI.

Never commit `.env` or expose the Discord client secret in frontend JavaScript.
