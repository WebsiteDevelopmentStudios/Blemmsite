# Blemmsite

A purple, space-themed Blemm website with:

- Home page
- Discord community page
- Discord login entry point
- Profile page
- Animated stars and shooting stars
- Responsive mobile layout

## Discord OAuth

The frontend intentionally does not contain a Discord client secret. Discord OAuth authorization-code exchange should happen on a server/API.

Set this in `script.js`:

```js
const CONFIG = {
  OAUTH_LOGIN_URL: "https://your-backend.example.com/auth/discord",
  DISCORD_INVITE_URL: "https://discord.gg/your-server"
};
```

Your backend should:

1. Redirect the visitor to Discord's OAuth2 authorization endpoint.
2. Request the `identify` scope.
3. Receive the authorization code at the configured callback URL.
4. Exchange the code server-side using the Discord client secret.
5. Fetch the user's Discord identity.
6. Redirect back to this site with a secure session/cookie.

Do not put the Discord client secret in `script.js`, `index.html`, or any public repository file.

## Customize

Change `DISCORD_INVITE_URL` in `script.js` to the real server invite.

The visual theme, stars, shooting stars, cards, navigation, and responsive layout are all in `style.css`.
