# Local Notes & Web Archive for Chrome

Local-first Chrome (Manifest V3) extension for personal notes, web page archiving,
reminders and local AI actions — no cloud services, no accounts, no telemetry.

> The complete product specification lives in **[PRD.md](./PRD.md)**.

## At a glance

| Area | Summary |
|------|---------|
| Product type | Local-first Chrome desktop extension (MV3) |
| Dashboard | Opens in a normal browser tab from the toolbar icon |
| Data | All notes, archives, reminders and settings stay in local browser storage |
| AI | Optional integration with a locally installed LM Studio API (no cloud fallback) |
| Web archive | MHTML snapshots (`chrome.pageCapture`), extracted text and full-page PNG via DevTools protocol |
| Reminders | One-time and annual reminders, browser-runtime limits clearly documented |
| Distribution | Open-source, self-contained prebuilt unpacked-extension folder |

## Status

Specification stage — see [PRD.md](./PRD.md) (v1.0, approved architecture baseline).

## License

To be defined at implementation time; all application code and bundled dependencies
must be free/open-source per the PRD constraints.
