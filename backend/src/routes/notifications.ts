import { Router } from 'express';
import { asyncRoute } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { listNotifications } from '../controllers/notificationController';

const router = Router();
router.use(requireAuth);
router.get('/', asyncRoute(listNotifications));

export default router;
