# Authentication setup

FlowSense supports email and password authentication plus Google OAuth through Supabase Auth. The
application uses Supabase's PKCE flow and exchanges the one-time callback code at
`/auth/callback`. OAuth provider secrets belong in Google and Supabase configuration. They are not
application environment variables and must never be committed or exposed to the browser.

## Google OAuth configuration

1. In Google Auth Platform, configure the consent screen (branding, audience, and required policy
   URLs). While the app is in testing, add the accounts that will perform the manual checks as test
   users. Create a Web application OAuth client. Add the exact application
   origins you use, including `https://flowsense-web.vercel.app` for Production and
   `http://localhost:3000` for local development when needed.
2. Add the Supabase project callback URL shown on **Authentication → Providers → Google** as an
   authorized Google redirect URI. This is the Supabase `/auth/v1/callback` URL, not FlowSense's
   `/auth/callback` route.
3. In Supabase **Authentication → Providers → Google**, enable Google and enter the Google client
   ID and client secret.
4. In Supabase **Authentication → URL Configuration**, set the Site URL to
   `https://flowsense-web.vercel.app`. Add these exact application redirect URLs:
   - `https://flowsense-web.vercel.app/auth/callback`
   - `http://localhost:3000/auth/callback` for local development
     Add an exact Preview callback only when OAuth must be tested on that Preview. Avoid a broad
     wildcard for Production authentication.
5. Test a new Google account and an existing verified email/password account before release.

Application-side support is implemented, but this repository cannot verify that the external client,
consent screen, or Supabase provider is configured. Google sign-in is not release-verified until those
steps and the manual account tests succeed. No provider configuration was changed by this work.

The setup follows Supabase's
[Google OAuth](https://supabase.com/docs/guides/auth/social-login/auth-google),
[server-side authentication](https://supabase.com/docs/guides/auth/server-side), and
[redirect allow-list](https://supabase.com/docs/guides/auth/redirect-urls) guidance.

Facebook is not enabled in this release. It adds another provider configuration and privacy surface
without a current product requirement. It can use the same callback architecture if the product
later needs it.

## Security behavior

- The browser receives only the Supabase URL and publishable key. Google and Supabase secrets are
  never read by client code.
- The callback accepts exactly one bounded authorization code, exchanges it with Supabase, ignores
  caller-provided destinations, and emits only a generic login error.
- Successful callbacks redirect to `/`. The session proxy then sends new users to onboarding and
  returning users to Home from verified Supabase user metadata.
- Supabase manages OAuth state, PKCE verification, session cookies, and automatic linking of a
  verified OAuth identity to an existing user with the same email. FlowSense does not implement
  custom account linking. See Supabase's
  [identity-linking guidance](https://supabase.com/docs/guides/auth/auth-identity-linking).
- Logout waits for Supabase sign-out before returning to the public landing page. A failed sign-out
  leaves the user on Settings with a retry action.
- Authentication diagnostics contain only bounded operation metadata. Provider messages, tokens,
  email addresses, and raw callback errors are not shown or logged.

## Account and release checks

- With the same verified email, Supabase's supported automatic identity linking keeps the existing
  user and its FlowSense history. Do not add a custom email-based account merge.
- Different email addresses can produce separate Supabase users and separate practice histories.
  FlowSense does not offer manual identity linking or cross-account history merging.
- Verify behavior for existing verified email/password users, new Google users, unconfirmed signup
  emails, provider denial, revoked consent, and a canceled callback. Linking and confirmation behavior
  depend on the deployed Supabase configuration; local fake-service tests cannot certify them.
- Test logout, browser Back, and a fresh protected-page request on deployed HTTPS in supported
  browsers. The local Chromium suite covers that route/session behavior without a real provider.
- This change does not add password-reset or email-change flows. Existing signup confirmation
  guidance remains intact; separately validate any dashboard-managed email templates before release.
