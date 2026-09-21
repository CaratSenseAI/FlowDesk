import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/roleGuard';
import { uploadBufferToCloudinary } from '../services/mediaService';

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/uploads — one file, multipart field "file".
//
// Stores it on Cloudinary and returns the public URL, which the client then
// sends as `attachmentUrl` on the normal JSON task endpoints. Kept separate so
// the task routes stay JSON-only and the size limit lives in exactly one place.
//
// Limits follow what WhatsApp will deliver: images ≤ 5 MB (JPEG/PNG), and a
// PDF for documents. Anything else is refused here rather than failing later
// inside Meta's API with a message the user never sees.
// ─────────────────────────────────────────────────────────────────────────────

export const IMAGE_TYPES = new Set(['image/jpeg', 'image/png']);
export const DOC_TYPES   = new Set(['application/pdf']);
export const MAX_BYTES   = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (IMAGE_TYPES.has(file.mimetype) || DOC_TYPES.has(file.mimetype)) return cb(null, true);
    cb(new Error('Only JPEG, PNG or PDF files can be attached'));
  },
});

const router = Router();
router.use(requireAuth);
router.use(requireRole('Admin', 'Manager'));

router.post('/', (req, res) => {
  upload.single('file')(req, res, async (err: unknown) => {
    if (err) {
      const code = (err as { code?: string }).code;
      const msg  = code === 'LIMIT_FILE_SIZE' ? 'File is larger than 5 MB' : (err as Error).message;
      res.status(400).json({ error: msg });
      return;
    }
    const file = req.file;
    if (!file) { res.status(400).json({ error: 'No file received' }); return; }

    const kind = IMAGE_TYPES.has(file.mimetype) ? 'image' : 'document';
    const url  = await uploadBufferToCloudinary(
      file.buffer, `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, 'flowdesk/task-images',
    );
    if (!url) { res.status(502).json({ error: 'Could not store the file. Try again.' }); return; }

    res.status(201).json({ url, kind, name: file.originalname, size: file.size });
  });
});

export default router;
