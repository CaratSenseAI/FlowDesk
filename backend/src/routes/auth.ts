import { Router } from 'express';
import { asyncRoute } from '../middleware/errorHandler';
import { login, getMe } from '../controllers/authController';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.post('/login', asyncRoute(login));
router.get('/me', requireAuth, asyncRoute(getMe));

export default router;
