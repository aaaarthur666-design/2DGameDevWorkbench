# Connector contract

The workbench keeps tool algorithms outside the shell. Each capability names an HTTP endpoint environment variable in `workbench/manifest.json`.

## Request

The runner and web gateway send a JSON `POST` request:

```json
{
  "taskId": "sprite-generator-20260903120000-abcd",
  "capabilityId": "sprite-generator",
  "input": {
    "prompt": "Create an eight-frame idle animation"
  }
}
```

The `input` object must match the capability's `inputSchema`. Authentication is optional; when a token environment variable is configured, the gateway sends `Authorization: Bearer <token>`.

## Response

Any `2xx` JSON response is accepted and stored as `outputs/<task-id>/result.json` by the Agent runner. An adapter should return stable output metadata where possible:

```json
{
  "outputs": [
    {
      "kind": "spriteSheet",
      "path": "outputs/example/sprite-sheet.png",
      "mimeType": "image/png"
    }
  ],
  "metadata": {
    "frameCount": 8,
    "frameWidth": 32,
    "frameHeight": 32
  }
}
```

Non-`2xx` responses are treated as failures. The workbench records status and a concise error but never stores or displays connector tokens.

## Configuration

Copy `.env.example` to an ignored local environment file and set only the connector values you use. The web gateway reads the same variable names as the Agent runner.
