import { Router } from 'express';
import { asyncRoute } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/roleGuard';
import { sendMessage } from '../controllers/whatsappController';

const router = Router();
router.use(requireAuth);
router.use(requireRole('Admin', 'Manager'));
router.post('/send', asyncRoute(sendMessage));

export default router;
