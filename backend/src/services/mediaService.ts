import axios from 'axios';
import { v2 as cloudinary } from 'cloudinary';

const cloudinaryReady = !!(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

if (cloudinaryReady) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

// ─── Download ─────────────────────────────────────────────────────────────────

/**
 * Download a WhatsApp media file from Meta Graph API.
 * Returns the raw buffer AND mime type — callers can then upload to Cloudinary,
 * transcribe (voice notes), or both.
 *
 * Returns null if META_ACCESS_TOKEN is not set or any download step fails.
 */
export async function downloadWhatsAppMedia(
  mediaId: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    console.warn('[Media] META_ACCESS_TOKEN not set — skipping media download');
    return null;
  }

  try {
    // Step 1: Resolve the temporary download URL from Meta
    const { data: metaInfo } = await axios.get<{ url: string; mime_type: string }>(
      `https://graph.facebook.com/v19.0/${mediaId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    // Step 2: Download the actual file as raw bytes
    const fileResponse = await axios.get<ArrayBuffer>(metaInfo.url, {
      headers:      { Authorization: `Bearer ${token}` },
      responseType: 'arraybuffer',
    });

    return {
      buffer:   Buffer.from(fileResponse.data),
      mimeType: metaInfo.mime_type,
    };
  } catch (err) {
    console.error('[Media] Failed to download WhatsApp media:', err);
    return null;
  }
}

// ─── Upload ───────────────────────────────────────────────────────────────────

/**
 * Upload a buffer to Cloudinary and return its permanent secure URL.
 * resource_type 'auto' handles images, documents, video, and audio.
 *
 * Returns null if Cloudinary is not configured or upload fails.
 */
export async function uploadBufferToCloudinary(
  buffer:  Buffer,
  mediaId: string,
  folder = 'flowdesk/attachments',
): Promise<string | null> {
  if (!cloudinaryReady) {
    console.warn('[Media] Cloudinary env vars missing — skipping upload');
    return null;
  }

  try {
    const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'auto',
          tags: [`whatsapp_media_${mediaId}`],
        },
        (error, res) => {
          if (error || !res) reject(error ?? new Error('Cloudinary upload failed'));
          else resolve(res as { secure_url: string });
        },
      );
      stream.end(buffer);
    });

    console.log(`[Media] Uploaded ${mediaId} → ${result.secure_url}`);
    return result.secure_url;
  } catch (err) {
    console.error('[Media] Cloudinary upload failed:', err);
    return null;
  }
}

// ─── Combined helper (used for images, documents, video) ─────────────────────

/**
 * Download a WhatsApp media file from Meta Graph API and upload it to Cloudinary.
 *
 * Flow:
 *  1. GET /v19.0/{mediaId}           → temporary download URL (expires in ~5 min)
 *  2. GET {downloadUrl}              → raw file bytes
 *  3. Upload bytes to Cloudinary     → permanent public URL
 *
 * Returns null if Cloudinary is not configured or any step fails.
 */
export async function storeWhatsAppMedia(mediaId: string): Promise<string | null> {
  const downloaded = await downloadWhatsAppMedia(mediaId);
  if (!downloaded) return null;
  return uploadBufferToCloudinary(downloaded.buffer, mediaId);
}
