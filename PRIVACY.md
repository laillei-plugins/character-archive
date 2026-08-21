# Privacy

Character Archive is local-first. Ordinary gallery viewing, editing, filtering, grouping, and property management read and write files in your Obsidian vault. The plugin does not add analytics or telemetry.

## When data leaves your device

Network activity is limited to features you explicitly use:

- **Hosted Web share:** pressing the hosted publish or update button creates a public HTML page containing the cards and panel sections selected in the share dialog. Selected prompts and covers are included when enabled or present.
- **Remote covers during Web share:** when a selected cover is already a remote URL, the plugin retrieves it so it can be embedded in the published page. The remote image host receives that request.
- **GitHub Pages:** after you connect GitHub and press publish, the same generated HTML is uploaded to the configured public GitHub repository.
- **Imgur:** images are uploaded only after you choose Imgur as the upload destination and perform an image upload.

No Web share upload runs merely because the plugin is enabled or a gallery is opened.

## Default hosted-share service

The default service is the maintainer-operated `https://character-archive.pages.dev`. It stores the generated public HTML in Cloudflare KV together with minimal management metadata: a random share ID, a separate management key, timestamps, retention choice, and payload size.

- The service accepts share creation without an account or plugin-specific credential. This does not grant access to another share: updating or deleting an existing page requires its separate management key.
- The default retention period is 30 days. Available choices are 7 days, 30 days, and 1 year.
- Updating a hosted link restarts its selected retention window from the update time.
- The link is not access-controlled. Anyone who has the public URL can view and copy its contents.
- Stopping a hosted share deletes its stored KV object. Short-lived HTTP caches may continue serving a previously viewed page for a few minutes.
- The plugin adds no client-side or server-side analytics or telemetry to shared pages or the hosted-share service.

You can avoid the default service by configuring your own compatible host or by using GitHub Pages.
Use HTTPS for any custom hosted-share service so credentials are encrypted in transit.

## Credentials

Hosted upload and management keys and the GitHub personal access token are stored in Obsidian's local plugin data inside your vault configuration. Treat them as secrets. They are sent only to the configured hosted-share service or GitHub API as required, and are not included in generated public share HTML. The built-in GitHub connection requests public-repository access rather than access to private repositories.

Disconnecting GitHub removes the saved token from current plugin settings. Stopping a hosted share removes its saved management record after the server confirms deletion. Existing backups or vault-sync history may retain older copies of plugin settings.

## GitHub Pages and Imgur

GitHub Pages content remains public until you remove or replace it in GitHub. Imgur uploads follow Imgur's retention and deletion rules. Cloudflare, GitHub, Imgur, and remote image hosts may process standard network metadata such as IP address and request headers under their own privacy policies.

Before publishing, minimize the selected cards and panel sections in the share dialog. Do not include secrets in public properties, prompts, note sections, or covers.

To report a privacy or security issue, use the repository's GitHub Issues page without including private vault content or credentials.
