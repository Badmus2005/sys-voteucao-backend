import express from 'express';
import prisma from '../prisma.js';
import { authenticateToken } from '../middlewares/auth.js';

const router = express.Router();

/**
 * GET /stats
 * Récupère les statistiques pour le dashboard admin
 */
router.get('/', authenticateToken, async (req, res) => {
    try {
        const [totalUsers, totalVotes, todayVotes, totalCandidates] = await Promise.all([
            prisma.user.count(),
            prisma.vote.count(),
            prisma.vote.count({
                where: {
                    createdAt: {
                        gte: new Date(new Date().setHours(0, 0, 0, 0))
                    }
                }
            }),
            prisma.candidate.count()
        ]);

        // Calcul des pourcentages
        const userGrowth = await calculateGrowth('user');
        const voteGrowth = await calculateGrowth('vote');

        res.json({
            users: {
                total: totalUsers,
                percent: userGrowth
            },
            votes: {
                total: totalVotes,
                percent: voteGrowth,
                today: todayVotes
            },
            candidates: {
                total: totalCandidates
            }
        });
    } catch (err) {
        console.error("Erreur stats:", err);
        res.status(500).json({ message: "Erreur serveur" });
    }
});

// Helper function
async function calculateGrowth(entity) {
    try {
        const now = new Date();
        const lastMonth = new Date(now.setMonth(now.getMonth() - 1));

        const currentCount = await prisma[entity].count();
        const previousCount = await prisma[entity].count({
            where: {
                createdAt: { lt: lastMonth }
            }
        });

        if (previousCount === 0) return 100;
        return Math.round(((currentCount - previousCount) / previousCount) * 100);
    } catch {
        return 0;
    }
}

export default router;