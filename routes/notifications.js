import express from 'express';
import { notificationController } from '../controllers/notificationController.js';
import { authenticateToken, requireAdmin } from '../middlewares/auth.js';

const router = express.Router();

// Routes accessibles à tous les utilisateurs authentifiés
router.get('/', authenticateToken, notificationController.getNotifications);
router.put('/:id/read', authenticateToken, notificationController.markAsRead);
router.put('/read-all', authenticateToken, notificationController.markAllAsRead);
router.delete('/:id', authenticateToken, notificationController.deleteNotification);
router.delete('/', authenticateToken, notificationController.deleteAllNotifications);
router.get('/stats', authenticateToken, notificationController.getStats);

// Routes réservées aux administrateurs
router.get('/admin', authenticateToken, requireAdmin, notificationController.getAdminNotifications);

export default router;