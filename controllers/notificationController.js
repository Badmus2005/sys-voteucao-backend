import NotificationService from '../services/notificationService.js';

export const notificationController = {
    /**
     * Récupérer les notifications de l'utilisateur
     */
    getNotifications: async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 20;

            const result = await NotificationService.getUserNotifications(
                req.user.id,
                page,
                limit
            );

            res.json(result);
        } catch (error) {
            console.error('Erreur récupération notifications:', error);
            res.status(500).json({
                message: 'Erreur lors de la récupération des notifications',
                code: 'NOTIFICATIONS_FETCH_ERROR'
            });
        }
    },

    /**
     * Marquer une notification comme lue
     */
    markAsRead: async (req, res) => {
        try {
            const { id } = req.params;
            const notification = await NotificationService.markAsRead(id, req.user.id);

            res.json({
                message: 'Notification marquée comme lue',
                notification
            });
        } catch (error) {
            console.error('Erreur marquage notification:', error);
            res.status(404).json({
                message: error.message || 'Notification non trouvée',
                code: 'NOTIFICATION_NOT_FOUND'
            });
        }
    },

    /**
     * Marquer toutes les notifications comme lues
     */
    markAllAsRead: async (req, res) => {
        try {
            await NotificationService.markAllAsRead(req.user.id);

            res.json({
                message: 'Toutes les notifications marquées comme lues'
            });
        } catch (error) {
            console.error('Erreur marquage toutes notifications:', error);
            res.status(500).json({
                message: 'Erreur lors du marquage des notifications',
                code: 'NOTIFICATIONS_MARK_ERROR'
            });
        }
    },

    /**
     * Supprimer une notification
     */
    deleteNotification: async (req, res) => {
        try {
            const { id } = req.params;
            await NotificationService.deleteNotification(id, req.user.id);

            res.json({
                message: 'Notification supprimée avec succès'
            });
        } catch (error) {
            console.error('Erreur suppression notification:', error);
            res.status(404).json({
                message: error.message || 'Notification non trouvée',
                code: 'NOTIFICATION_NOT_FOUND'
            });
        }
    },

    /**
     * Supprimer toutes les notifications
     */
    deleteAllNotifications: async (req, res) => {
        try {
            await NotificationService.deleteAllNotifications(req.user.id);

            res.json({
                message: 'Toutes les notifications supprimées avec succès'
            });
        } catch (error) {
            console.error('Erreur suppression toutes notifications:', error);
            res.status(500).json({
                message: 'Erreur lors de la suppression des notifications',
                code: 'NOTIFICATIONS_DELETE_ERROR'
            });
        }
    },

    /**
     * Récupérer les statistiques des notifications
     */
    getStats: async (req, res) => {
        try {
            const stats = await NotificationService.getNotificationStats(req.user.id);

            res.json(stats);
        } catch (error) {
            console.error('Erreur stats notifications:', error);
            res.status(500).json({
                message: 'Erreur lors de la récupération des statistiques',
                code: 'NOTIFICATIONS_STATS_ERROR'
            });
        }
    },

    /**
     * Récupérer les notifications pour les admins (toutes les notifications)
     */
    getAdminNotifications: async (req, res) => {
        try {
            if (req.user.role !== 'ADMIN') {
                return res.status(403).json({
                    message: 'Accès réservé aux administrateurs',
                    code: 'ADMIN_ACCESS_REQUIRED'
                });
            }

            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 50;
            const skip = (page - 1) * limit;

            // Filtres
            const where = {};
            if (req.query.type) where.type = req.query.type;
            if (req.query.read !== undefined) where.read = req.query.read === 'true';

            const [notifications, total] = await Promise.all([
                prisma.notification.findMany({
                    where,
                    include: {
                        user: {
                            select: {
                                id: true,
                                email: true,
                                role: true
                            }
                        }
                    },
                    orderBy: { createdAt: 'desc' },
                    skip,
                    take: limit
                }),
                prisma.notification.count({ where })
            ]);

            res.json({
                notifications,
                total,
                totalPages: Math.ceil(total / limit),
                currentPage: page
            });
        } catch (error) {
            console.error('Erreur récupération notifications admin:', error);
            res.status(500).json({
                message: 'Erreur lors de la récupération des notifications',
                code: 'NOTIFICATIONS_FETCH_ERROR'
            });
        }
    }
};