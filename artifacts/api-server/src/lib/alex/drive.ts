// Google Drive output via the Replit "google-drive" connector.
// Auth (OAuth token injection + refresh) is handled automatically by the
// Replit Connectors proxy — no manual access token or secret is required.
// Integration: connector ccfg_google-drive (connection conn_google-drive).
import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "../logger.js";

const CONNECTOR = "google-drive";
const DOC_MIME = "application/vnd.google-apps.document";

let connectors: ReplitConnectors | null = null;
function getConnectors(): ReplitConnectors {
  if (!connectors) {
    connectors = new ReplitConnectors();
  }
  return connectors;
}

interface DriveFile {
  id: string;
  webViewLink?: string;
}

async function createGoogleDoc(
  folderId: string | undefined,
  title: string,
  content: string
): Promise<DriveFile> {
  const boundary = `alex-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const metadata: Record<string, unknown> = {
    name: title,
    mimeType: DOC_MIME,
  };
  if (folderId) {
    metadata.parents = [folderId];
  }

  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/plain; charset=UTF-8\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--`;

  const res = await getConnectors().proxy(
    CONNECTOR,
    "/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink",
    {
      method: "POST",
      headers: {
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Drive upload failed (${res.status}): ${err}`);
  }

  return (await res.json()) as DriveFile;
}

export async function writeToDrive(
  folderId: string | undefined,
  title: string,
  content: string,
  teamId: string
): Promise<string | undefined> {
  try {
    const file = await createGoogleDoc(folderId, title, content);
    const link =
      file.webViewLink ??
      `https://docs.google.com/document/d/${file.id}/edit`;
    logger.info(
      { teamId, fileId: file.id, title, folderId: folderId ?? "root" },
      "Wrote output to Google Drive"
    );
    return link;
  } catch (err) {
    logger.error({ err, teamId, title }, "Failed to write to Google Drive");
    return undefined;
  }
}

export async function isDriveConfigured(): Promise<boolean> {
  try {
    const connections = await getConnectors().listConnections({
      connector_names: CONNECTOR,
    });
    const ok = new Set(["healthy", "active", "ACTIVE"]);
    return connections.some((c) => !c.status || ok.has(c.status));
  } catch (err) {
    logger.warn({ err }, "Failed to check Google Drive connection status");
    return false;
  }
}
