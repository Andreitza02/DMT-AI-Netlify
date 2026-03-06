# ChatKit Local Drawer App (Express + Static Frontend)

This project runs a local Node.js + Express server and a static HTML/CSS/JS frontend that mounts OpenAI ChatKit in a right-side drawer with a floating launcher.

## Features

- Secure server-side session creation with `OPENAI_API_KEY` from `.env`
- Floating launcher button (bottom-right) that hides while chat is open
- Right-side drawer with backdrop, smooth animation, and ESC close
- ChatKit web component integration via CDN
- Composer attachments enabled (hosted upload strategy)
- Composer tools explicitly removed (`tools: []`) to avoid "State variables" chip
- Inline loading/error state with retry

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy env template:

```bash
cp .env.example .env
```

3. Set your API key in `.env`:

```env
OPENAI_API_KEY=your_api_key_here
PORT=3000
```

4. Start server:

```bash
npm start
```

5. Open:

`http://localhost:3000`

## API Endpoint

`POST /api/chatkit/session`

Request body:

```json
{
  "userId": "optional-user-id"
}
```

Response:

```json
{
  "client_secret": "..."
}
```

## Troubleshooting

- Invalid workflow/version:
  - Confirm `WORKFLOW_ID` and `WORKFLOW_VERSION` in `server.js` are exactly:
    - `wf_68e4cfa8a674819081622f5d73083e5b0874867723c55c75`
    - `27`
- Missing API key:
  - Ensure `.env` exists and contains `OPENAI_API_KEY`.
  - Restart the server after editing `.env`.
- Chat stuck loading:
  - Check browser devtools network for blocked CDN script:
    - `https://cdn.platform.openai.com/deployments/chatkit/chatkit.js`
  - Click Retry in the panel.
- File upload disabled due session config mismatch:
  - Ensure backend session payload includes:
    - `chatkit_configuration.file_upload.enabled: true`
    - `max_files: 3`
    - `max_file_size: 20`
  - Ensure frontend composer attachments config matches the backend limits.

## Security Notes

- `OPENAI_API_KEY` is only read on the server from `process.env.OPENAI_API_KEY`.
- The frontend never receives or prints the API key.
- The session endpoint returns only `client_secret`.
