import express from 'express';
import prisma from '../prisma.js';
import { authenticateToken } from '../middlewares/auth.js';

const router = express.Router();

/**
 * GET /activity
 * Récupère les activités récentes pour le dashboard
 */
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { limit = 5 } = req.query;

        const activities = await prisma.activityLog.findMany({
            take: parseInt(limit),
            orderBy: { createdAt: 'desc' },
            include: {
                user: {
                    select: {
                        email: true,
                        admin: { select: { nom: true, prenom: true } },
                        etudiant: { select: { nom: true, prenom: true } }
                    }
                }
            }
        });

        const formattedActivities = activities.map(activity => {
            const user = activity.user;
            const name = user.admin
                ? `${user.admin.nom} ${user.admin.prenom}`
                : user.etudiant
                    ? `${user.etudiant.nom} ${user.etudiant.prenom}`
                    : user.email;

            return {
                id: activity.id,
                title: activity.action,
                content: `${name} - ${activity.details}`,
                time: formatTime(activity.createdAt),
                icon: getIconForAction(activity.actionType)
            };
        });

        res.json(formattedActivities);
    } catch (err) {
        console.error("Erreur activity:", err);
        res.status(500).json({ message: "Erreur serveur" });
    }
});

// Helpers
function formatTime(date) {
    const now = new Date();
    const diff = now - new Date(date);
    const minutes = Math.floor(diff / 60000);

    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} h`;
    return `${Math.floor(hours / 24)} j`;
}

function getIconForAction(type) {
    const icons = {
        LOGIN: 'sign-in-alt',
        VOTE: 'vote-yea',
        CREATE: 'plus-circle',
        UPDATE: 'edit',
        DELETE: 'trash-alt'
    };
    return icons[type] || 'info-circle';
}

export default router;