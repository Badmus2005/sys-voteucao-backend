import prisma from '../prisma.js';

class NotificationService {
    /**
     * Créer une notification
     */
    static async createNotification(userId, title, message, options = {}) {
        try {
            const notification = await prisma.notification.create({
                data: {
                    title,
                    message,
                    type: options.type || 'info',
                    priority: options.priority || 'medium',
                    relatedEntity: options.relatedEntity || null,
                    entityId: options.entityId || null,
                    userId: userId,
                    read: false
                }
            });

            return notification;
        } catch (error) {
            console.error('Erreur création notification:', error);
            throw error;
        }
    }

    /**
     * Notifier tous les administrateurs
     */
    static async notifyAdmins(title, message, options = {}) {
        try {
            // Récupérer tous les administrateurs
            const admins = await prisma.user.findMany({
                where: {
                    role: 'ADMIN',
                    // Exclure l'admin qui a déclenché la notification si besoin
                    id: options.excludeUserId ? { not: options.excludeUserId } : undefined
                },
                include: { admin: true }
            });

            const notifications = [];
            for (const admin of admins) {
                const notification = await this.createNotification(
                    admin.id,
                    title,
                    message,
                    options
                );
                notifications.push(notification);
            }

            return notifications;
        } catch (error) {
            console.error('Erreur notification admins:', error);
            throw error;
        }
    }

    /**
     * Récupérer les notifications d'un utilisateur
     */
    static async getUserNotifications(userId, page = 1, limit = 20) {
        try {
            const skip = (page - 1) * limit;

            const [notifications, total] = await Promise.all([
                prisma.notification.findMany({
                    where: { userId },
                    orderBy: { createdAt: 'desc' },
                    skip,
                    take: limit
                }),
                prisma.notification.count({
                    where: { userId }
                })
            ]);

            const unreadCount = await prisma.notification.count({
                where: {
                    userId,
                    read: false
                }
            });

            return {
                notifications,
                total,
                unreadCount,
                totalPages: Math.ceil(total / limit),
                currentPage: page
            };
        } catch (error) {
            console.error('Erreur récupération notifications:', error);
            throw error;
        }
    }

    /**
     * Marquer une notification comme lue
     */
    static async markAsRead(notificationId, userId) {
        try {
            const notification = await prisma.notification.findFirst({
                where: {
                    id: notificationId,
                    userId
                }
            });

            if (!notification) {
                throw new Error('Notification non trouvée');
            }

            const updatedNotification = await prisma.notification.update({
                where: { id: notificationId },
                data: { read: true }
            });

            return updatedNotification;
        } catch (error) {
            console.error('Erreur marquage notification:', error);
            throw error;
        }
    }

    /**
     * Marquer toutes les notifications comme lues
     */
    static async markAllAsRead(userId) {
        try {
            await prisma.notification.updateMany({
                where: {
                    userId,
                    read: false
                },
                data: { read: true }
            });

            return { success: true };
        } catch (error) {
            console.error('Erreur marquage toutes notifications:', error);
            throw error;
        }
    }

    /**
     * Supprimer une notification
     */
    static async deleteNotification(notificationId, userId) {
        try {
            const notification = await prisma.notification.findFirst({
                where: {
                    id: notificationId,
                    userId
                }
            });

            if (!notification) {
                throw new Error('Notification non trouvée');
            }

            await prisma.notification.delete({
                where: { id: notificationId }
            });

            return { success: true };
        } catch (error) {
            console.error('Erreur suppression notification:', error);
            throw error;
        }
    }

    /**
     * Supprimer toutes les notifications
     */
    static async deleteAllNotifications(userId) {
        try {
            await prisma.notification.deleteMany({
                where: { userId }
            });

            return { success: true };
        } catch (error) {
            console.error('Erreur suppression toutes notifications:', error);
            throw error;
        }
    }

    /**
     * Récupérer les statistiques des notifications
     */
    static async getNotificationStats(userId) {
        try {
            const stats = await prisma.notification.groupBy({
                by: ['read'],
                where: { userId },
                _count: true
            });

            const typeStats = await prisma.notification.groupBy({
                by: ['type'],
                where: { userId },
                _count: true
            });

            const total = await prisma.notification.count({ where: { userId } });
            const unread = stats.find(stat => !stat.read)?._count || 0;
            const read = stats.find(stat => stat.read)?._count || 0;

            return {
                total,
                unread,
                read,
                byType: typeStats
            };
        } catch (error) {
            console.error('Erreur stats notifications:', error);
            throw error;
        }
    }

    // Méthodes utilitaires pour des types spécifiques de notifications
    static async notifyElectionEvent(userId, election, eventType) {
        const messages = {
            created: `Une nouvelle élection "${election.titre}" a été créée`,
            updated: `L'élection "${election.titre}" a été modifiée`,
            started: `L'élection "${election.titre}" a commencé`,
            ended: `L'élection "${election.titre}" est terminée`,
            deleted: `L'élection "${election.titre}" a été supprimée`
        };

        return this.createNotification(
            userId,
            `Élection ${eventType}`,
            messages[eventType] || `Événement sur l'élection "${election.titre}"`,
            {
                type: 'info',
                relatedEntity: 'election',
                entityId: election.id
            }
        );
    }

    static async notifyVoteEvent(userId, election, eventType) {
        const messages = {
            voted: `Vous avez voté pour l'élection "${election.titre}"`,
            result: `Les résultats de l'élection "${election.titre}" sont disponibles`
        };

        return this.createNotification(
            userId,
            `Vote ${eventType}`,
            messages[eventType] || `Événement vote "${election.titre}"`,
            {
                type: 'success',
                relatedEntity: 'election',
                entityId: election.id
            }
        );
    }
}

export default NotificationService;