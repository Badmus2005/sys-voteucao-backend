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
        const { limit = 10 } = req.query;

        // Récupérer les activités avec les informations utilisateur de base
        const activities = await prisma.activityLog.findMany({
            take: parseInt(limit),
            orderBy: { createdAt: 'desc' },
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        role: true,
                        admin: {
                            select: {
                                nom: true,
                                prenom: true
                            }
                        },
                        etudiant: {
                            select: {
                                nom: true,
                                prenom: true
                            }
                        }
                    }
                }
            }
        });

        // Formatter les activités
        const formattedActivities = activities.map(activity => {
            let userName = activity.user?.email || 'Utilisateur inconnu';

            // Déterminer le nom selon le rôle
            if (activity.user?.role === 'ADMIN' && activity.user.admin) {
                userName = `${activity.user.admin.nom} ${activity.user.admin.prenom}`;
            } else if (activity.user?.role === 'ETUDIANT' && activity.user.etudiant) {
                userName = `${activity.user.etudiant.nom} ${activity.user.etudiant.prenom}`;
            }

            return {
                id: activity.id,
                title: activity.action,
                content: `${userName} - ${activity.details || 'Action effectuée'}`,
                time: formatTime(activity.createdAt),
                timestamp: activity.createdAt,
                icon: getIconForAction(activity.actionType)
            };
        });

        res.json(formattedActivities);
    } catch (err) {
        console.error("Erreur activity endpoint:", err);
        res.status(500).json({
            message: "Erreur serveur",
            error: err.message,
            // Ne pas envoyer les détails complets en production
            ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
        });
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